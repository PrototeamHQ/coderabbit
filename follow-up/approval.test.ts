import { describe, expect, test } from "bun:test"
import { type CheckRun, fullyReviewed, standingApproval } from "./approval"
import type { Review } from "./change-requests"

const bot = "coderabbitai[bot]"
let next = 1
const review = (login: string, state: string, commit: string): Review => ({ id: next++, user: { login }, state, commit_id: commit, body: "" })

describe("standingApproval", () => {
  test("is the reviewer's last verdict when it is an approval, with the change requests that stood before it", () => {
    const requested = review(bot, "CHANGES_REQUESTED", "c1")
    const approval = review(bot, "APPROVED", "c2")
    const reply = review(bot, "COMMENTED", "c3")
    expect(standingApproval([requested, review("ann", "COMMENTED", "c2"), approval, reply], [], [])).toEqual({
      approval,
      lifted: [requested],
      reviewed: ["c3", "c2", "c1"],
    })
  })

  test("leaves out a change request the comment's record lifted, and those before an earlier approval", () => {
    const old = review(bot, "CHANGES_REQUESTED", "c0")
    const recorded = review(bot, "CHANGES_REQUESTED", "c1")
    const approval = review(bot, "APPROVED", "c2")
    expect(standingApproval([old, review(bot, "APPROVED", "c0"), recorded, approval], [], [recorded.id])?.lifted).toEqual([])
  })

  test("is null when the last verdict is a change request, a dismissed approval, or there is none", () => {
    const approval = review(bot, "APPROVED", "c1")
    expect(standingApproval([approval, review(bot, "CHANGES_REQUESTED", "c2")], [], [])).toBeNull()
    const dismissed = { ...review(bot, "DISMISSED", "c1") }
    expect(standingApproval([dismissed], [{ reviewId: dismissed.id, state: "approved" }], [])).toBeNull()
    expect(standingApproval([review(bot, "COMMENTED", "c1"), review("ann", "APPROVED", "c1")], [], [])).toBeNull()
  })
})

describe("fullyReviewed", () => {
  const run = (change: Partial<CheckRun>): CheckRun => ({ name: "CodeRabbit", status: "completed", conclusion: "success", app: { slug: "coderabbitai" }, ...change })

  test("is the reviewer's own check run that concluded success", () => {
    expect(fullyReviewed([run({})])).toBe(true)
  })

  test("is not a skipped or running review, nor a run of that name from another app", () => {
    expect(fullyReviewed([run({ conclusion: "skipped" }), run({ status: "in_progress", conclusion: null })])).toBe(false)
    expect(fullyReviewed([run({ app: { slug: "someone-else" } }), run({ app: null })])).toBe(false)
    expect(fullyReviewed([run({ name: "CodeRabbit (copy)" })])).toBe(false)
  })
})
