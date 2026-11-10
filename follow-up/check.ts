// The follow-up check of one pull request, from the gate to the dismissal. The model's answer reaches GitHub only as
// comment text below the comment's hidden record lines and through the verdict readFollowUp or readAfterApproval
// parses from it (follow-up.ts, after-approval.ts); only a clean follow-up of a change request dismisses, and only the
// reviewer's change requests it checked. With no change request standing, a follow-up after the reviewer's approval
// that no finished review of the head backs runs once per head and dismisses nothing.
import { runAfterApproval } from "./after-approval-run"
import { fullyReviewed, standingApproval } from "./approval"
import { liftedButOpen, reviewerRequests } from "./change-requests"
import { afterApprovalComment, checkedHead, followUpComment, liftedIds, marker, type Verdict, withLifted } from "./comment"
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
  | "checkRuns"
>

// One ask per kind of follow-up, each with its own fixed system prompt.
export type Asks = { followUp: Ask; afterApproval: Ask }
type Ask = (user: string) => Promise<Completion>

// What the check found: a follow-up's verdict, or none when it did not run, as the gate stopped it or none was due.
export type Outcome = Verdict | "none"

const dismissal = "A follow-up check found each change requested here met."

export async function runCheck(github: CheckGitHub, asks: Asks, repository: string, number: number, log = console.log): Promise<Outcome> {
  const pullRequest = await github.pullRequest(number)
  const allowed = await gate(repository, pullRequest, github.permission)
  if (!allowed.allowed) {
    log(`Not checked: ${allowed.why}`)
    return "none"
  }
  const sha = pullRequest.head.sha

  // A run cancelled between recording a lift and dismissing it leaves that change request open; it is dismissed now.
  const comment = (await github.checkComment(number, marker))?.body ?? ""
  const lifted = liftedIds(comment)
  const reviews = await github.reviews(number)
  for (const review of liftedButOpen(reviews, lifted)) await github.dismissReview(number, review.id, dismissal)

  const dismissals = await github.reviewDismissals(number)
  const requested = reviewerRequests(reviews, dismissals, lifted)
  if (!isDue(requested, sha)) {
    const standing = standingApproval(reviews, dismissals, lifted)
    if (standing === null) {
      log(`No follow-up is due: no change request of ${reviewer.name} stands on a commit before ${sha.slice(0, 7)}, and no approval of it does.`)
      return "none"
    }
    // An approval of the head that the reviewer's own finished review backs needs no follow-up.
    if (standing.approval.commit_id === sha && fullyReviewed(await github.checkRuns(sha, reviewer.check))) {
      log(`No follow-up is due: ${reviewer.name} reviewed ${sha.slice(0, 7)} in full and approved it.`)
      return "none"
    }
    // A later event on the same head, such as the reviewer's reply in a thread, would ask the same again and could
    // draw another verdict, so the head's first verdict stands until the next push.
    if (checkedHead(comment) === sha) {
      log(`No follow-up is due: ${sha.slice(0, 7)} was checked already.`)
      return "none"
    }
    const pinned = { number, sha, base: pullRequest.base.sha, title: pullRequest.title, body: pullRequest.body }
    const part = await runAfterApproval(github, asks.afterApproval, pinned, standing)
    log(`Follow-up of ${reviewer.name}'s approval of ${part.approved.slice(0, 7)}, from its review of ${part.reviewed.slice(0, 7)}: ${part.verdict}.`)
    // A push during the run leaves the verdict to the run of the new head.
    if ((await github.pullRequest(number)).head.sha !== sha) {
      log(`Not recorded: the head moved on from ${sha.slice(0, 7)} during the run.`)
      return "none"
    }
    await github.upsertComment(number, marker, withLifted(afterApprovalComment(sha, part, reviewer.name), lifted))
    return part.verdict
  }

  const files = await github.changedFiles(number, limits.maxListedFiles)
  const part = await runFollowUp(github, asks.followUp, { number, sha, title: pullRequest.title, body: pullRequest.body, files }, requested)
  log(`Follow-up of ${reviewer.name}'s change request on ${part.reviewed.slice(0, 7)}: ${part.verdict}.`)

  // The comment records the lifted change requests first, then the open ones are dismissed, so the pull request's page
  // shows them lifted.
  const met = part.verdict === "clean" ? part.requests : []
  await github.upsertComment(number, marker, withLifted(followUpComment(sha, part, reviewer.name), [...lifted, ...met.map((review) => review.id)]))
  for (const review of met.filter((review) => review.state === "CHANGES_REQUESTED")) await github.dismissReview(number, review.id, dismissal)
  return part.verdict
}
