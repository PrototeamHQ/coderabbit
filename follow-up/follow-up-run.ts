// Runs the follow-up of the reviewer's change request on a head (follow-up.ts), once isDue says one is due.
//
// A follow-up is due when the reviewer's change requests stand (change-requests.ts) on commits before the head. With
// one on the head itself the fixes have not come yet, so none is due. When the reviewed commit is no longer in the
// head's history, as after a rebase, the follow-up reads the pull request's whole diff and all its commit messages
// instead. The part is skipped, never clean, when a request cannot be read, the input is above the cap, a file a
// request names has no diff to show, or the model gives no answer that accounts for every request once.
import type { Review } from "./change-requests"
import { fitFollowUp, readFollowUp, type FollowUpFile } from "./follow-up"
import { isGenerated, type ChangedFile } from "./changed-files"
import { promptRequests } from "./requested-changes"
import type { Completion } from "./scaleway"
import { limits, reviewer } from "./settings"
import { skipReason } from "./verdict"

export type FollowUpPart = { reviewed: string; verdict: "clean" | "findings" | "skipped"; text: string; requests: Review[] }

export type FollowUpReads = {
  pullCommits(number: number): Promise<{ sha: string; parents: { sha: string }[]; commit: { message: string } }[]>
  compare(from: string, to: string): Promise<{ status: string; files: FollowUpFile[] }>
  fileAt(path: string, ref: string | null): Promise<string | null>
}

export type PullRequestHead = { number: number; sha: string; title: string; body: string | null; files: ChangedFile[] }

// The compare API lists at most 300 files, so a list that long may be cut short.
const maxComparedFiles = 300

// Whether a follow-up of the standing change requests is due on the head `sha`.
export const isDue = (requested: Review[], sha: string) => requested.length > 0 && !requested.some((review) => review.commit_id === sha)

export async function runFollowUp(github: FollowUpReads, ask: (user: string) => Promise<Completion>, pr: PullRequestHead, requested: Review[]): Promise<FollowUpPart> {
  if (!isDue(requested, pr.sha)) throw new Error("No follow-up is due on this head")
  const reviewed = requested[0].commit_id
  const skipped = (reason: string): FollowUpPart => ({ reviewed, verdict: "skipped", text: `Not checked: ${reason}`, requests: requested })

  const requests = []
  for (const review of requested) {
    const read = promptRequests(review.body)
    if (read.kind === "unreadable") return skipped(`${reviewer.name}'s change request ${review.id} cannot be read: ${read.why}.`)
    requests.push(...read.requests)
  }

  // After a rebase the reviewed commit is gone from the head's history, and the pull request's whole diff stands in.
  const compared = await github.compare(reviewed, pr.sha)
  const rebased = compared.status !== "ahead"
  const changed: FollowUpFile[] = rebased ? pr.files : compared.files
  if (changed.length >= maxComparedFiles) return skipped(`GitHub lists ${changed.length} changed files, which may be cut short.`)

  // Files only the base branch changed, brought in by a merge, drop out; a file a request names stays, deleted, moved
  // or not.
  const named = new Set(requests.flatMap((request) => (request.path ? [request.path] : [])))
  const inPull = new Set(pr.files.map((file) => file.filename))
  const relevant = changed.filter((file) => inPull.has(file.filename) || named.has(file.filename) || named.has(file.previous_filename ?? ""))
  const unshown = relevant.filter((file) => file.patch === undefined && (named.has(file.filename) || named.has(file.previous_filename ?? "")))
  if (unshown.length > 0) return skipped(`${unshown[0].filename}, which a request names, has no diff to show.`)
  const shown = relevant.filter((file) => file.patch !== undefined && !isGenerated(file.filename))

  const commits = await github.pullCommits(pr.number)
  const since = rebased ? -1 : commits.findIndex((commit) => commit.sha === reviewed)
  const messages = commits.slice(since + 1).filter((commit) => commit.parents.length === 1).map((commit) => commit.commit.message)

  const contents = new Map<string, string>()
  for (const path of named) {
    const text = await github.fileAt(path, pr.sha)
    if (text !== null && text.length <= limits.maxFileChars) contents.set(path, text)
  }

  const user = fitFollowUp(
    {
      reviewed,
      rebased,
      requests,
      title: pr.title,
      description: pr.body,
      commits: messages,
      files: shown,
      leftOut: relevant.filter((file) => !shown.includes(file)).map((file) => file.filename),
      contents,
    },
    limits.maxInputChars,
  )
  if (user === null) return skipped(`its input is above the cap of ${limits.maxInputChars / 1000}k characters.`)

  const completion = await ask(user)
  const unanswered = skipReason(completion)
  if (unanswered !== null) return skipped(unanswered)
  const answer = readFollowUp(completion.content, requests.length)
  if (answer.kind === "unaccounted") return skipped(`${answer.why}.`)
  return { reviewed, verdict: answer.kind === "met" ? "clean" : "findings", text: completion.content.trim(), requests: requested }
}
