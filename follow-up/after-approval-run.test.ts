import { describe, expect, test } from "bun:test"
import { type AfterApprovalReads, type PinnedHead, runAfterApproval } from "./after-approval-run"
import type { CheckRun, StandingApproval } from "./approval"
import type { Review } from "./change-requests"
import type { FollowUpFile } from "./follow-up"
import type { Completion } from "./scaleway"

const reviewed = "a".repeat(40)
const approved = "c".repeat(40)
const head = "b".repeat(40)
const merge = "d".repeat(40)
const bot = { login: "coderabbitai[bot]" }
const prompt = "Prompt to fix all issues\n```\nAdvice.\n\nInline comments:\nReview comments at @a.ts:\n- Line 3: Release the lock.\n```"
const changeRequest: Review = { id: 7, user: bot, state: "CHANGES_REQUESTED", commit_id: reviewed, body: prompt }
const approval: Review = { id: 9, user: bot, state: "APPROVED", commit_id: approved, body: "" }
const standing: StandingApproval = { approval, lifted: [changeRequest], reviewed: [approved, reviewed] }
const finished: CheckRun = { name: "CodeRabbit", status: "completed", conclusion: "success", app: { slug: "coderabbitai" } }

type Stub = Partial<{ files: FollowUpFile[]; own: FollowUpFile[] }>

function reads(stub: Stub = {}, looked: string[] = []): AfterApprovalReads {
  const files = stub.files ?? [
    { filename: "a.ts", status: "modified", patch: "@@ -3 +3 @@\n-acquire()\n+try { acquire() } finally { release() }" },
    { filename: "main-only.ts", status: "modified", patch: "@@ -1 +1 @@\n+from main" },
  ]
  return {
    checkRuns: async (sha) => {
      looked.push(sha)
      return sha === reviewed ? [finished] : []
    },
    compare: async (from) =>
      from === reviewed
        ? { status: "ahead", files, commits: [{ sha: approved }, { sha: merge }, { sha: head }] }
        : { status: "diverged", files: stub.own ?? [{ filename: "a.ts", status: "modified" }], commits: [] },
    pullCommits: async () => [
      { sha: reviewed, parents: [{ sha: "0" }], commit: { message: "feat: upload" } },
      { sha: approved, parents: [{ sha: reviewed }], commit: { message: "test: re-record" } },
      { sha: merge, parents: [{ sha: approved }, { sha: "e" }], commit: { message: "Merge branch 'main'" } },
      { sha: head, parents: [{ sha: merge }], commit: { message: "fix: release the lock" } },
      { sha: "9".repeat(40), parents: [{ sha: head }], commit: { message: "pushed during the run" } },
    ],
    fileAt: async (path, ref) => (path === "a.ts" && ref === head ? "try { acquire() } finally { release() }\n" : null),
  }
}

const pr: PinnedHead = { number: 12, sha: head, base: "f".repeat(40), title: "Retry the upload", body: "Why." }
const answering = (content: string, asked: string[] = []) => async (user: string): Promise<Completion> => {
  asked.push(user)
  return { content, reasoning: "", finish: "stop", usage: null }
}
const met = "Request 1: met - released in a finally.\nNo issues found."

describe("runAfterApproval", () => {
  test("checks an approval of the head itself from the commit the reviewer reviewed in full", async () => {
    expect((await runAfterApproval(reads(), answering(met), pr, { ...standing, approval: { ...approval, commit_id: head } })).verdict).toBe("clean")
  })

  test("reads the check runs newest first and measures from the first commit the reviewer reviewed in full", async () => {
    const looked: string[] = []
    const part = await runAfterApproval(reads({}, looked), answering(met), pr, standing)
    expect(looked).toEqual([approved, reviewed])
    expect(part).toEqual({ reviewed, approved, verdict: "clean", text: met })
  })

  test("asks with the lifted requests, the pinned head's own commits and files, and nothing from the base branch or a later push", async () => {
    const asked: string[] = []
    await runAfterApproval(reads(), answering(met, asked), pr, standing)
    expect(asked[0]).toContain("Request 1 (a.ts, Line 3): Release the lock.")
    expect(asked[0]).toContain("test: re-record")
    expect(asked[0]).toContain("fix: release the lock")
    expect(asked[0]).not.toContain("feat: upload")
    expect(asked[0]).not.toContain("Merge branch")
    expect(asked[0]).not.toContain("pushed during the run")
    expect(asked[0]).not.toContain("main-only.ts")
    expect(asked[0]).toContain("### a.ts")
  })

  test("shows a move without changes and a generated file without a diff as left out", async () => {
    const asked: string[] = []
    const files = [
      { filename: "a.ts", status: "modified", patch: "@@ -3 +3 @@" },
      { filename: "b.ts", previous_filename: "old.ts", status: "renamed", changes: 0 },
      { filename: "bun.lock", status: "modified" },
    ]
    expect((await runAfterApproval(reads({ files, own: files }), answering(met, asked), pr, standing)).verdict).toBe("clean")
    expect(asked[0]).toContain("## Changed but left out\n\nGenerated, binary or too large to diff:\n- b.ts\n- bun.lock")
  })

  test("asks for new problems alone when the approval lifted no request", async () => {
    const asked: string[] = []
    const part = await runAfterApproval(reads(), answering("No issues found.", asked), pr, { ...standing, lifted: [] })
    expect(part.verdict).toBe("clean")
    expect(asked[0]).toContain("## Requested changes\n\nNone.")
  })

  test("skips, never passes, when it cannot check", async () => {
    const skipped = async (stub: Stub, change: Partial<StandingApproval> = {}, content = met) =>
      (await runAfterApproval(reads(stub), answering(content), pr, { ...standing, ...change })).text
    expect(await skipped({}, { lifted: [{ ...changeRequest, body: "**Actionable comments posted: 1**" }] })).toBe(
      "Not checked: CodeRabbit's change request 7 cannot be read: it has no fix prompt to read its requested changes from.",
    )
    const many = Array.from({ length: 300 }, (_, index) => ({ filename: `f${index}`, status: "added", patch: "+" }))
    expect(await skipped({ files: many })).toBe("Not checked: GitHub lists 300 changed files, which may be cut short.")
    expect(await skipped({ own: many })).toBe("Not checked: GitHub lists 300 changed files, which may be cut short.")
    expect(await skipped({ files: [{ filename: "a.ts", status: "modified" }] })).toBe("Not checked: a.ts has no diff to show.")
    const image = { filename: "logo.png", status: "added" }
    expect(await skipped({ files: [image], own: [image] })).toBe("Not checked: logo.png has no diff to show.")
    const huge = [{ filename: "a.ts", status: "modified", patch: `+${"x".repeat(200_000)}` }]
    expect(await skipped({ files: huge })).toBe("Not checked: its input is above the cap of 130k characters.")
    expect(await skipped({}, {}, "")).toBe("Not checked: the model ended its turn without an answer.")
    expect(await skipped({}, {}, "No issues found.")).toBe("Not checked: the answer does not account for each of the 1 requests once.")
  })
})
