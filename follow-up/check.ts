// The follow-up check of one pull request, from the gate to the dismissal. The model's answer reaches GitHub only as
// comment text below the comment's hidden record lines and through the verdict readFollowUp parses from it
// (follow-up.ts); only a clean verdict dismisses, and only the reviewer's change requests that follow-up checked.
import { liftedButOpen, reviewerRequests } from "./change-requests"
import { followUpComment, liftedIds, marker, type Verdict, withLifted } from "./comment"
import { isDue, runFollowUp } from "./follow-up-run"
import { gate } from "./gate"
import type { GitHub } from "./github"
import type { Completion } from "./scaleway"
import { limits, reviewer } from "./settings"

export type CheckGitHub = Pick<
  GitHub,
  | "pullRequest"
  | "permission"
  | "checkComment"
  | "upsertComment"
  | "reviews"
  | "reviewDismissals"
  | "dismissReview"
  | "changedFiles"
  | "compare"
  | "pullCommits"
  | "fileAt"
>

// What the check found: a follow-up's verdict, or none when it did not run, as the gate stopped it or none was due.
export type Outcome = Verdict | "none"

const dismissal = "A follow-up check found each change requested here met."

export async function runCheck(github: CheckGitHub, ask: (user: string) => Promise<Completion>, repository: string, number: number, log = console.log): Promise<Outcome> {
  const pullRequest = await github.pullRequest(number)
  const allowed = await gate(repository, pullRequest, github.permission)
  if (!allowed.allowed) {
    log(`Not checked: ${allowed.why}`)
    return "none"
  }
  const sha = pullRequest.head.sha

  // A run cancelled between recording a lift and dismissing it leaves that change request open; it is dismissed now.
  const lifted = liftedIds((await github.checkComment(number, marker))?.body ?? "")
  const reviews = await github.reviews(number)
  for (const review of liftedButOpen(reviews, lifted)) await github.dismissReview(number, review.id, dismissal)

  const requested = reviewerRequests(reviews, await github.reviewDismissals(number), lifted)
  if (!isDue(requested, sha)) {
    log(`No follow-up is due: no change request of ${reviewer.name} stands on a commit before ${sha.slice(0, 7)}.`)
    return "none"
  }

  const files = await github.changedFiles(number, limits.maxListedFiles)
  const part = await runFollowUp(github, ask, { number, sha, title: pullRequest.title, body: pullRequest.body, files }, requested)
  log(`Follow-up of ${reviewer.name}'s change request on ${part.reviewed.slice(0, 7)}: ${part.verdict}.`)

  // The comment records the lifted change requests first, then the open ones are dismissed, so the pull request's page
  // shows them lifted.
  const met = part.verdict === "clean" ? part.requests : []
  await github.upsertComment(number, marker, withLifted(followUpComment(sha, part, reviewer.name), [...lifted, ...met.map((review) => review.id)]))
  for (const review of met.filter((review) => review.state === "CHANGES_REQUESTED")) await github.dismissReview(number, review.id, dismissal)
  return part.verdict
}
