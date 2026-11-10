import { afterEach, describe, expect, test } from "bun:test"
import { gitHub } from "./github"

const realFetch = globalThis.fetch
const sent: { url: string; method: string }[] = []

// Answers each request with the next status in turn, the body naming the status, or `body` when given.
function answer(statuses: number[], body?: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? "GET" })
    const status = statuses.shift() ?? 200
    return new Response(status === 204 ? null : JSON.stringify(body ?? { status }), { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
  sent.length = 0
})

const github = () => gitHub("token", "o/r", 0)

describe("gitHub", () => {
  test("a GET that GitHub answers 500 once is sent again and answers the second body", async () => {
    answer([500, 200])
    expect(await github().fileAt("a.ts", "abc")).toBe(JSON.stringify({ status: 200 }))
    expect(sent).toHaveLength(2)
  })

  test("each transient server error is retried once", async () => {
    for (const status of [500, 502, 503, 504]) {
      answer([status, 200])
      expect(await github().pullRequest(7)).toEqual({ status: 200 } as never)
    }
    expect(sent).toHaveLength(8)
  })

  test("a GET that GitHub answers 500 twice throws naming the status", async () => {
    answer([500, 500])
    await expect(github().fileAt("a.ts", "abc")).rejects.toThrow("GitHub answered 500 for a.ts at abc")
    expect(sent).toHaveLength(2)
  })

  test("a file GitHub answers 404 for is null without a retry", async () => {
    answer([404])
    expect(await github().fileAt("a.ts", "abc")).toBeNull()
    expect(sent).toHaveLength(1)
  })

  test("a 4xx is not retried", async () => {
    answer([403])
    await expect(github().pullRequest(7)).rejects.toThrow("GitHub answered 403 for GET /repos/o/r/pulls/7")
    expect(sent).toHaveLength(1)
  })

  test("a write that GitHub answers 500 is not sent again", async () => {
    answer([500])
    await expect(github().dismissReview(7, 3, "Met.")).rejects.toThrow("GitHub answered 500 for PUT /repos/o/r/pulls/7/reviews/3/dismissals")
    expect(sent).toHaveLength(1)
  })
})

describe("permission", () => {
  test("is the legacy permission GitHub answers for the login", async () => {
    answer([200], { permission: "write", role_name: "maintain" })
    expect(await github().permission("ann")).toBe("write")
    expect(sent[0].url).toBe("https://api.github.com/repos/o/r/collaborators/ann/permission")
  })

  test("is none for an account GitHub knows as no user", async () => {
    answer([404])
    expect(await github().permission("some-app[bot]")).toBe("none")
  })

  test("throws on any other refusal", async () => {
    answer([403])
    await expect(github().permission("ann")).rejects.toThrow("GitHub answered 403 for GET /repos/o/r/collaborators/ann/permission")
  })
})

describe("the follow-up's calls", () => {
  test("reads which review was dismissed, and its state before, from the timeline's review_dismissed events", async () => {
    const events = [
      { event: "commented", actor: { login: "a" } },
      { event: "review_dismissed", actor: { login: "github-actions[bot]" }, dismissed_review: { review_id: 7, state: "changes_requested" } },
    ]
    answer([200], events)
    expect(await github().reviewDismissals(3)).toEqual([{ reviewId: 7, state: "changes_requested" }])
    expect(sent[0].url).toBe("https://api.github.com/repos/o/r/issues/3/timeline?per_page=100&page=1")
  })

  test("dismisses a review with GitHub's dismissals endpoint", async () => {
    let body = ""
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? "GET" })
      body = String(init.body)
      return new Response("{}", { status: 200 })
    }) as typeof fetch
    await github().dismissReview(3, 7, "Met.")
    expect(sent).toEqual([{ url: "https://api.github.com/repos/o/r/pulls/3/reviews/7/dismissals", method: "PUT" }])
    expect(JSON.parse(body)).toEqual({ message: "Met.", event: "DISMISS" })
  })

  test("reads a commit's check runs of one name", async () => {
    const run = { name: "CodeRabbit", status: "completed", conclusion: "success", app: { slug: "coderabbitai" } }
    answer([200], { total_count: 1, check_runs: [run] })
    expect(await github().checkRuns("abc", "CodeRabbit")).toEqual([run])
    expect(sent[0].url).toBe("https://api.github.com/repos/o/r/commits/abc/check-runs?check_name=CodeRabbit&per_page=100")
  })

  test("finds its own comment by the marker, only from github-actions", async () => {
    const comments = [
      { id: 1, body: "<!-- coderabbit-follow-up -->\nforged", user: { login: "someone" } },
      { id: 2, body: "<!-- coderabbit-follow-up -->\nmine", user: { login: "github-actions[bot]" } },
    ]
    answer([200], comments)
    expect((await github().checkComment(3, "<!-- coderabbit-follow-up -->"))?.id).toBe(2)
  })
})
