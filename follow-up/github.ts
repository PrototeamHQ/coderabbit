// The GitHub REST calls the follow-up check makes. They read the pull request as data; the check writes only its one
// comment and, after a follow-up that found every requested change met, the dismissal of those change requests.
import type { Dismissal, Review } from "./change-requests"
import type { ChangedFile } from "./changed-files"
import type { FollowUpFile } from "./follow-up"

const api = "https://api.github.com"

// The server errors GitHub answers now and then and not again a moment later.
const transient = new Set([500, 502, 503, 504])

export type PullRequest = {
  title: string
  body: string | null
  state: string
  draft: boolean
  user: { login: string }
  // repo is null when the pull request came from a fork that was deleted since.
  head: { sha: string; repo: { full_name: string } | null }
}

// `retryPause` is the fixed wait in milliseconds before a GET that met a transient server error is sent once more.
export function gitHub(token: string, repository: string, retryPause = 2000) {
  const headers = { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" }

  // Every call goes through here. Only a GET is sent again, since it changes nothing; a second answer that is not OK
  // is the caller's to handle, as the first would have been.
  async function send(path: string, init: RequestInit) {
    const response = await fetch(`${api}${path}`, init)
    if ((init.method ?? "GET") !== "GET" || !transient.has(response.status)) return response
    await new Promise((resolve) => setTimeout(resolve, retryPause))
    return fetch(`${api}${path}`, init)
  }

  async function request(path: string, init: RequestInit = {}, accept = "application/vnd.github+json") {
    const response = await send(path, { ...init, headers: { ...headers, accept, ...init.headers } })
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${init.method ?? "GET"} ${path}`)
    return response
  }

  async function paginate<T>(path: string, maxItems: number) {
    const items: T[] = []
    for (let page = 1; items.length < maxItems; page++) {
      const batch = (await (await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)).json()) as T[]
      items.push(...batch)
      if (batch.length < 100) break
    }
    return items
  }

  // The check's own comment: the one github-actions wrote that starts with the marker.
  async function checkComment(number: number, marker: string) {
    const comments = await paginate<{ id: number; body: string; user: { login: string } }>(
      `/repos/${repository}/issues/${number}/comments`,
      Number.POSITIVE_INFINITY,
    )
    return comments.find((comment) => comment.user.login === "github-actions[bot]" && comment.body.startsWith(marker))
  }

  return {
    async pullRequest(number: number) {
      return (await (await request(`/repos/${repository}/pulls/${number}`)).json()) as PullRequest
    },

    // A user's legacy permission on the repository: admin, write, read or none. Maintain counts as write and triage as
    // read, and a custom role as the base role it extends. GitHub answers 404 for an account that is no user, such as
    // some bots, which counts as none.
    async permission(login: string) {
      const path = `/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`
      const response = await send(path, { headers: { ...headers, accept: "application/vnd.github+json" } })
      if (response.status === 404) return "none"
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for GET ${path}`)
      return ((await response.json()) as { permission: string }).permission
    },

    // A file's text at a commit, or null when it does not exist there.
    async fileAt(path: string, ref: string | null) {
      const encoded = path.split("/").map(encodeURIComponent).join("/")
      const query = ref ? `?ref=${ref}` : ""
      const response = await send(`/repos/${repository}/contents/${encoded}${query}`, {
        headers: { ...headers, accept: "application/vnd.github.raw+json" },
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path} at ${ref ?? "the default branch"}`)
      return response.text()
    },

    changedFiles(number: number, maxItems: number) {
      return paginate<ChangedFile>(`/repos/${repository}/pulls/${number}/files`, maxItems)
    },

    // The files changed from the merge base of `from` and `to` up to `to`, with their patches; GitHub lists at most 300.
    async compare(from: string, to: string) {
      const path = `/repos/${repository}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`
      return (await (await request(path)).json()) as { status: string; files: FollowUpFile[] }
    },

    // Every review of the pull request, oldest first.
    reviews(number: number) {
      return paginate<Review>(`/repos/${repository}/pulls/${number}/reviews`, Number.POSITIVE_INFINITY)
    },

    // Which review was dismissed, and the state it had before, from the review_dismissed events of the pull request's
    // timeline.
    async reviewDismissals(number: number): Promise<Dismissal[]> {
      type Event = { event: string; dismissed_review?: { review_id: number; state: string } }
      const events = await paginate<Event>(`/repos/${repository}/issues/${number}/timeline`, Number.POSITIVE_INFINITY)
      return events.flatMap((event) =>
        event.event === "review_dismissed" && event.dismissed_review ? [{ reviewId: event.dismissed_review.review_id, state: event.dismissed_review.state }] : [],
      )
    },

    // The pull request's own commits, oldest first, without the base branch's commits a merge brought in; GitHub lists
    // at most 250.
    pullCommits(number: number) {
      return paginate<{ sha: string; parents: { sha: string }[]; commit: { message: string } }>(`/repos/${repository}/pulls/${number}/commits`, 250)
    },

    async dismissReview(number: number, reviewId: number, message: string) {
      const path = `/repos/${repository}/pulls/${number}/reviews/${reviewId}/dismissals`
      await request(path, { method: "PUT", body: JSON.stringify({ message, event: "DISMISS" }) })
    },

    checkComment,

    async upsertComment(number: number, marker: string, body: string) {
      const existing = await checkComment(number, marker)
      const init = { method: existing ? "PATCH" : "POST", body: JSON.stringify({ body }) }
      const path = existing ? `/repos/${repository}/issues/comments/${existing.id}` : `/repos/${repository}/issues/${number}/comments`
      await request(path, init)
    },
  }
}

export type GitHub = ReturnType<typeof gitHub>
