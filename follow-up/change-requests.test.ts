import { describe, expect, test } from "bun:test"
import { type Dismissal, type Review, liftedButOpen, reviewerRequests } from "./change-requests"

const bot = "coderabbitai[bot]"
let next = 1
const review = (login: string | null, state: string, commit = "c1"): Review => ({ id: next++, user: login === null ? null : { login }, state, commit_id: commit, body: "" })
const dismissed = (of: Review, state = "changes_requested"): Dismissal => ({ reviewId: of.id, state })

describe("reviewerRequests", () => {
  test("every change request of the reviewer since its last approval stands, oldest first", () => {
    const first = review(bot, "CHANGES_REQUESTED", "c1")
    const second = review(bot, "CHANGES_REQUESTED", "c2")
    expect(reviewerRequests([review(bot, "CHANGES_REQUESTED", "c0"), review(bot, "APPROVED", "c0"), first, review(bot, "COMMENTED", "c2"), second], [], [])).toEqual([first, second])
  })

  test("its approval lifts the change requests before it", () => {
    expect(reviewerRequests([review(bot, "CHANGES_REQUESTED"), review(bot, "APPROVED", "c2")], [], [])).toEqual([])
  })

  test("only the comment's record lifts one: a dismissed change request stands until then", () => {
    const theirs = review(bot, "DISMISSED")
    const open = review(bot, "CHANGES_REQUESTED", "c2")
    expect(reviewerRequests([theirs, open], [dismissed(theirs)], [])).toEqual([theirs, open])
    expect(reviewerRequests([theirs, open], [dismissed(theirs)], [theirs.id])).toEqual([open])
    expect(reviewerRequests([theirs, open], [dismissed(theirs)], [theirs.id, open.id])).toEqual([])
  })

  test("a dismissed approval is no change request, and other reviewers play no part", () => {
    const approval = review(bot, "DISMISSED")
    expect(reviewerRequests([approval, review("someone", "CHANGES_REQUESTED")], [dismissed(approval, "approved")], [])).toEqual([])
  })
})

describe("liftedButOpen", () => {
  test("is the reviewer's open change requests the record lifted, not dismissed ones or other people's", () => {
    const open = review(bot, "CHANGES_REQUESTED")
    const gone = review(bot, "DISMISSED")
    const person = review("someone", "CHANGES_REQUESTED")
    expect(liftedButOpen([open, gone, person], [open.id, gone.id, person.id])).toEqual([open])
    expect(liftedButOpen([open], [])).toEqual([])
  })
})
