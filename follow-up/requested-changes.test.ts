import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { promptRequests } from "./requested-changes"

// CodeRabbit's change request on a263286 of PrototeamHQ/protobase PR #117, recorded with gh pr view --json reviews.
const pr117 = () => Bun.file(join(import.meta.dir, "fixtures", "pr117-change-request.md")).text()

describe("promptRequests", () => {
  test("lists the inline and outside-diff comments of the fix prompt, leaving out other comments and pre-merge checks", async () => {
    const read = promptRequests(await pr117())
    if (read.kind !== "read") throw new Error(read.why)
    expect(read.requests.map((request) => [request.path, request.where])).toEqual([
      ["docs/website/src/content/docs/reference/workflows.md", "Line 225"],
      ["packages/server/src/personal-mail/linked-accounts.ts", "Line 48"],
      ["packages/server/src/workflows/connections/connection-triggers.ts", "Around line 12-18"],
      ["packages/server/src/workflows/triggers/trigger-jobs.ts", "Around line 90-91"],
      ["packages/ui/src/account/connections-section.tsx", "Around line 35-46"],
      ["docs/website/src/content/docs/reference/email.mdx", "Line 145"],
    ])
    expect(read.requests[4].text).toBe(
      "Update the `attempt` function so `setBusy(undefined)` runs after `work()` succeeds or fails, including when a non-`AuthError` is rethrown. Move the reset into a `finally` block and preserve the existing error handling.",
    )
    expect(read.requests.some((request) => request.text.includes("breaking change"))).toBe(false)
  })

  test("reads nothing from a body without a fix prompt, one whose prompt lists only other comments, or one off its stated count", async () => {
    expect(promptRequests("**Actionable comments posted: 1**")).toEqual({ kind: "unreadable", why: "it has no fix prompt to read its requested changes from" })
    const others = "Prompt to fix all issues\n```\nAdvice.\n\nOther comments:\nReview comments at @a.ts:\n- Line 1: Nit.\n```"
    expect(promptRequests(others)).toEqual({ kind: "unreadable", why: "its fix prompt lists no requested change" })
    const off = (await pr117()).replace("Actionable comments posted: 5", "Actionable comments posted: 6")
    expect(promptRequests(off)).toEqual({ kind: "unreadable", why: "its fix prompt lists 5 inline comments, not the 6 it states" })
  })
})
