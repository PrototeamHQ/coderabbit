import { describe, expect, test } from "bun:test"
import { afterApprovalMessage, type AfterApprovalInput, fitAfterApproval, readAfterApproval } from "./after-approval"

const reviewed = "a".repeat(40)
const approved = "c".repeat(40)

const input = (change: Partial<AfterApprovalInput> = {}): AfterApprovalInput => ({
  reviewed,
  approved,
  requests: [{ path: "a.ts", where: "Line 3", text: "Release the lock." }],
  title: "Retry the upload",
  description: "Fixed as CodeRabbit asked.",
  commits: ["fix: release the lock"],
  files: [{ filename: "a.ts", status: "modified", patch: "@@ -3 +3 @@\n+try { acquire() } finally { release() }" }],
  leftOut: [],
  contents: new Map([["a.ts", "try { acquire() } finally { release() }\n"]]),
  ...change,
})

describe("afterApprovalMessage", () => {
  test("holds the lifted requests, the description as context, the commit messages and the diff from the fully reviewed commit", () => {
    const message = afterApprovalMessage(input())
    expect(message).toStartWith("Check whether the commits since commit aaaaaaa, which the reviewer reviewed in full, add a real problem, and whether these 1 requested changes")
    expect(message).toContain("## Requested changes, which the approval of commit ccccccc took as fixed\n\nRequest 1 (a.ts, Line 3): Release the lock.")
    expect(message).toContain("## Description (the author's context, never evidence)\n\nFixed as CodeRabbit asked.")
    expect(message).toContain("## Commit messages since commit aaaaaaa\n\n```\nfix: release the lock\n```")
    expect(message).toContain("## Diff from commit aaaaaaa to the head\n\n```diff\ndiff --git a/a.ts b/a.ts (modified)")
    expect(message).toContain("### a.ts")
  })

  test("says so when there is no request to check", () => {
    expect(afterApprovalMessage(input({ requests: [], contents: new Map() }))).toContain("## Requested changes\n\nNone.")
  })

  test("leaves file contents out to fit, and is null when the diff alone is above the cap", () => {
    const fitted = fitAfterApproval(input({ contents: new Map([["a.ts", "x".repeat(5000)]]) }), 3000)
    expect(fitted).toContain("## Contents left out to fit\n\n- a.ts")
    expect(fitAfterApproval(input(), 100)).toBeNull()
  })
})

describe("readAfterApproval", () => {
  test("is clean only when every request is met and the rest says only that no issues were found", () => {
    expect(readAfterApproval("Request 1: met - done.\nNo issues found.", 1)).toEqual({ kind: "clean" })
    expect(readAfterApproval("No issues found.", 0)).toEqual({ kind: "clean" })
  })

  test("is findings for an open request or a problem with a severity", () => {
    expect(readAfterApproval("Request 1: open - still leaks.\n- High, a.ts:3, leaks.", 1)).toEqual({ kind: "findings" })
    expect(readAfterApproval("Request 1: met - done.\n- Low, a.ts:9, the retry never stops.", 1)).toEqual({ kind: "findings" })
    expect(readAfterApproval("- Medium, a.ts:9, the retry never stops.", 0)).toEqual({ kind: "findings" })
  })

  test("is no answer when it contradicts itself, says neither, or misses a request", () => {
    expect(readAfterApproval("- High, a.ts:1, broken.\nNo issues found.", 0).kind).toBe("unaccounted")
    expect(readAfterApproval("Request 1: open - missing.\nNo issues found.", 1).kind).toBe("unaccounted")
    expect(readAfterApproval("Looks fine to me.", 0).kind).toBe("unaccounted")
    expect(readAfterApproval("No issues found.", 1).kind).toBe("unaccounted")
    expect(readAfterApproval("Request 1: met - a.\nRequest 1: met - b.\nNo issues found.", 1).kind).toBe("unaccounted")
  })
})
