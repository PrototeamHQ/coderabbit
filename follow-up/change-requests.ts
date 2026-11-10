// Which of the reviewer's change requests still stand on a pull request. Pure: the caller reads the reviews, the issue
// timeline's review_dismissed events and the check comment's record of lifted change requests (comment.ts).
//
// The reviewer's (settings.reviewer, CodeRabbit) change requests are lifted only by its own later approval, or once a
// follow-up found every change they request met (follow-up-run.ts), which the check comment records by their ids. A
// dismissal does not lift them: the account that pushes the fixes can dismiss a review, and one it dismissed can no
// longer be dismissed again. The check still dismisses those it lifted that are open, so the pull request's page shows
// them lifted.
import { reviewer } from "./settings"

// A review as GET /repos/{repo}/pulls/{number}/reviews lists them, oldest first; user is null for a deleted account.
export type Review = { id: number; user: { login: string } | null; state: string; commit_id: string; body: string }
// A review_dismissed event of the issue timeline: which review was dismissed, and the state it had before.
export type Dismissal = { reviewId: number; state: string }

const isVerdict = (review: Review) => review.state === "APPROVED" || review.state === "CHANGES_REQUESTED" || review.state === "DISMISSED"

const isReviewers = (review: Review) => review.user?.login === reviewer.login

// The reviewer's change requests that stand, oldest first: each since its last approval, open or dismissed, whose id
// `lifted` does not hold. A dismissed review that was an approval is none.
export function reviewerRequests(reviews: Review[], dismissals: Dismissal[], lifted: number[]) {
  const before = new Map(dismissals.map((dismissal) => [dismissal.reviewId, dismissal.state.toLowerCase()]))
  const done = new Set(lifted)
  let standing: Review[] = []
  for (const review of reviews.filter((review) => isReviewers(review) && isVerdict(review))) {
    if (review.state === "APPROVED") standing = []
    else if (review.state === "CHANGES_REQUESTED" || before.get(review.id) !== "approved") standing.push(review)
  }
  return standing.filter((review) => !done.has(review.id))
}

// The reviewer's change requests that `lifted` holds but that are still open on the page, such as when a run was
// cancelled between recording them and dismissing them; the check dismisses them.
export function liftedButOpen(reviews: Review[], lifted: number[]) {
  const done = new Set(lifted)
  return reviews.filter((review) => isReviewers(review) && review.state === "CHANGES_REQUESTED" && done.has(review.id))
}
