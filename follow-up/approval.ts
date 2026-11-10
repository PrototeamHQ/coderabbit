// The reviewer's (CodeRabbit's) approval that a later push left behind, and the commit its own review last finished
// on. Pure: the caller reads the reviews, the review_dismissed events, the comment's record and the check runs.
//
// CodeRabbit approves on its own once it reads its review threads as resolved, also on an author's "fixed" reply
// before the fix is pushed, so its approval alone is no evidence. Only its check run concluding success shows it
// reviewed a commit in full. The after-approval follow-up (after-approval-run.ts) therefore measures from that commit
// and checks again the change requests the approval lifted.
import { type Dismissal, isReviewers, isVerdict, type Review, reviewerRequests } from "./change-requests"
import { reviewer } from "./settings"

export type StandingApproval = {
  approval: Review
  // The change requests that stood right before the approval, oldest first.
  lifted: Review[]
  // The commits the reviewer's reviews name, newest first, each once.
  reviewed: string[]
}

// The reviewer's last verdict when it is an approval that still stands, or null. A dismissed approval is none, and
// neither is a change request the comment's record lifted.
export function standingApproval(reviews: Review[], dismissals: Dismissal[], lifted: number[]): StandingApproval | null {
  const theirs = reviews.filter(isReviewers)
  const last = theirs.filter(isVerdict).at(-1)
  if (last === undefined || last.state !== "APPROVED") return null
  const before = reviews.slice(0, reviews.indexOf(last))
  return {
    approval: last,
    lifted: reviewerRequests(before, dismissals, lifted),
    reviewed: [...new Set(theirs.map((review) => review.commit_id).reverse())],
  }
}

// A check run as GET /repos/{repo}/commits/{ref}/check-runs lists it; app is null when GitHub hides it.
export type CheckRun = { name: string; status: string; conclusion: string | null; app: { slug: string } | null }

// Whether the reviewer's own check run on a commit finished its review. It is told apart by the app that wrote it, as
// any app or workflow can write a check run of that name.
export const fullyReviewed = (runs: CheckRun[]) =>
  runs.some((run) => run.app?.slug === reviewer.app && run.name === reviewer.check && run.conclusion === "success")
