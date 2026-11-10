import { describe, expect, test } from "bun:test"
import type { Review } from "./change-requests"
import type { FollowUpFile } from "./follow-up"
import { type FollowUpReads, isDue, type PullRequestHead, runFollowUp } from "./follow-up-run"
import type { Completion } from "./scaleway"

const reviewed = "a".repeat(40)
const head = "b".repeat(40)
const bot = { login: "coderabbitai[bot]" }
const prompt = "Prompt to fix all issues\n```\nAdvice.\n\nInline comments:\nReview comments at @a.ts:\n- Line 3: Release the lock.\n```"
const changeRequest: Review = { id: 7, user: bot, state: "CHANGES_REQUESTED", commit_id: reviewed, body: prompt }

type Stub = Partial<{ status: string; files: FollowUpFile[] }>

function reads(stub: Stub = {}): FollowUpReads {
  return {
    pullCommits: async () => [
      { sha: reviewed, parents: [{ sha: "0" }], commit: { message: "feat: upload" } },
      { sha: "c".repeat(40), parents: [{ sha: reviewed }, { sha: "d" }], commit: { message: "Merge branch 'main'" } },
      { sha: head, parents: [{ sha: "c" }], commit: { message: "fix: release the lock" } },
    ],
    compare: async () => ({
      status: stub.status ?? "ahead",
      files: stub.files ?? [
        { filename: "a.ts", status: "modified", patch: "@@ -3 +3 @@\n-acquire()\n+try { acquire() } finally { release() }" },
        { filename: "main-only.ts", status: "modified", patch: "@@ -1 +1 @@" },
      ],
    }),
    fileAt: async (path) => (path === "a.ts" ? "try { acquire() } finally { release() }\n" : null),
  }
}

const pr: PullRequestHead = { number: 12, sha: head, title: "Retry the upload", body: "Why.", files: [{ filename: "a.ts", status: "modified", patch: "@@ -0,0 +1 @@\n+whole" }] }
const answering = (content: string, asked: string[] = []) => async (user: string): Promise<Completion> => {
  asked.push(user)
  return { content, reasoning: "", finish: "stop", usage: null }
}
const met = "Request 1: met - released in a finally.\nNo issues found."

describe("isDue", () => {
  test("is due for a standing change request on an earlier commit only", () => {
    expect(isDue([changeRequest], head)).toBe(true)
    expect(isDue([], head)).toBe(false)
    expect(isDue([changeRequest, { ...changeRequest, id: 8, commit_id: head }], head)).toBe(false)
  })
})

describe("runFollowUp", () => {
  test("refuses to run when no follow-up is due", async () => {
    await expect(runFollowUp(reads(), answering("x"), pr, [])).rejects.toThrow("No follow-up is due")
  })

  test("asks with the requests, the pull request's own commit messages and the diff of its files, and passes a met answer", async () => {
    const asked: string[] = []
    const part = await runFollowUp(reads(), answering(met, asked), pr, [changeRequest])
    expect(part).toEqual({ reviewed, verdict: "clean", text: met, requests: [changeRequest] })
    expect(asked[0]).toContain("Request 1 (a.ts, Line 3): Release the lock.")
    expect(asked[0]).toContain("fix: release the lock")
    expect(asked[0]).not.toContain("Merge branch")
    expect(asked[0]).not.toContain("feat: upload")
    expect(asked[0]).not.toContain("main-only.ts")
    expect(asked[0]).toContain("### a.ts")
  })

  test("gives findings for an open request", async () => {
    expect((await runFollowUp(reads(), answering("Request 1: open - still leaks.\n\n- High, a.ts:3, ..."), pr, [changeRequest])).verdict).toBe("findings")
  })

  test("reads the pull request's whole diff and commit messages once the reviewed commit left its history", async () => {
    const asked: string[] = []
    await runFollowUp(reads({ status: "diverged" }), answering(met, asked), pr, [changeRequest])
    expect(asked[0]).toContain(`The pull request's whole diff, as commit ${reviewed.slice(0, 7)} is no longer in its history`)
    expect(asked[0]).toContain("+whole")
    expect(asked[0]).toContain("feat: upload")
  })

  test("keeps a file a request names under its new name after a move", async () => {
    const asked: string[] = []
    const moved = [{ filename: "b.ts", previous_filename: "a.ts", status: "renamed", patch: "@@ -3 +3 @@" }]
    await runFollowUp(reads({ files: moved }), answering(met, asked), { ...pr, files: [] }, [changeRequest])
    expect(asked[0]).toContain("diff --git a/b.ts b/b.ts (renamed)")
  })

  test("skips, never passes, when it cannot check", async () => {
    const skipped = async (stub: Stub, content = met, requested = [changeRequest]) => (await runFollowUp(reads(stub), answering(content), pr, requested)).text
    expect(await skipped({}, met, [{ ...changeRequest, body: "**Actionable comments posted: 1**" }])).toBe(
      "Not checked: CodeRabbit's change request 7 cannot be read: it has no fix prompt to read its requested changes from.",
    )
    expect(await skipped({ files: [{ filename: "a.ts", status: "modified" }] })).toBe("Not checked: a.ts, which a request names, has no diff to show.")
    expect(await skipped({ files: Array.from({ length: 300 }, (_, index) => ({ filename: `f${index}`, status: "added" })) })).toBe(
      "Not checked: GitHub lists 300 changed files, which may be cut short.",
    )
    expect(await skipped({}, "")).toBe("Not checked: the model ended its turn without an answer.")
    expect(await skipped({}, "No issues found.")).toBe("Not checked: the answer does not account for each of the 1 requests once.")
  })
})
