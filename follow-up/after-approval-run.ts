// Runs the follow-up after the reviewer's approval of an earlier commit (after-approval.ts), when no change request of
// it stands (approval.ts).
//
// It measures from the newest commit the reviewer's own check shows it reviewed in full, not from the approved
// commit, and checks again the change requests that stood right before the approval, as the approval may rest on the
// author's word alone. Every read is of the head's commit as the check read it at the start, so a push during the run
// cannot mix two heads. The part is skipped, never clean, when the reviewer finished a review on none of its commits,
// that commit is no longer in the head's history, a request cannot be read, GitHub may have cut a file list short, a
// changed file has no diff to show, the input is above the cap, or the model gives no answer that accounts for every
// request once.
import { type CheckRun, fullyReviewed, type StandingApproval } from "./approval"
import { fitAfterApproval, readAfterApproval } from "./after-approval"
import { isGenerated } from "./changed-files"
import type { FollowUpFile } from "./follow-up"
import { promptRequests } from "./requested-changes"
import type { Completion } from "./scaleway"
import { limits, reviewer } from "./settings"
import { skipReason } from "./verdict"

export type AfterApprovalPart = { reviewed: string; approved: string; verdict: "clean" | "findings" | "skipped"; text: string }

export type AfterApprovalReads = {
  checkRuns(sha: string, name: string): Promise<CheckRun[]>
  compare(from: string, to: string): Promise<{ status: string; files: FollowUpFile[]; commits: { sha: string }[] }>
  pullCommits(number: number): Promise<{ sha: string; parents: { sha: string }[]; commit: { message: string } }[]>
  fileAt(path: string, ref: string | null): Promise<string | null>
}

export type PinnedHead = { number: number; sha: string; base: string; title: string; body: string | null }

// The compare API lists at most 300 files, so a list that long may be cut short.
const maxComparedFiles = 300

// What moves a skipped pull request on, besides a human approval.
const fullReview = "A full review of the head by the reviewer gives the check a new start."

// The newest of the commits the reviewer's reviews name on which its own check finished a review, or null. It reads
// one commit's check runs at a time, newest first, and stops at the first.
async function lastFullReview(github: AfterApprovalReads, commits: string[]) {
  for (const sha of commits) {
    if (fullyReviewed(await github.checkRuns(sha, reviewer.check))) return sha
  }
  return null
}

export async function runAfterApproval(github: AfterApprovalReads, ask: (user: string) => Promise<Completion>, pr: PinnedHead, standing: StandingApproval): Promise<AfterApprovalPart> {
  const approved = standing.approval.commit_id

  const reviewed = await lastFullReview(github, standing.reviewed)
  const skipped = (reason: string): AfterApprovalPart => ({ reviewed: reviewed ?? approved, approved, verdict: "skipped", text: `Not checked: ${reason}` })
  if (reviewed === null) return skipped(`${reviewer.name}'s own check finished a review on none of the commits it reviewed. ${fullReview}`)

  const requests = []
  for (const review of standing.lifted) {
    const read = promptRequests(review.body)
    if (read.kind === "unreadable") return skipped(`${reviewer.name}'s change request ${review.id} cannot be read: ${read.why}.`)
    requests.push(...read.requests)
  }

  const compared = await github.compare(reviewed, pr.sha)
  if (compared.status !== "ahead") return skipped(`commit ${reviewed.slice(0, 7)}, which ${reviewer.name} last reviewed in full, is no longer in the head's history. ${fullReview}`)
  // The pull request's own files at this head, from its base as the check read it, drop the base branch's files a
  // merge brought in.
  const own = await github.compare(pr.base, pr.sha)
  for (const list of [compared.files, own.files]) {
    if (list.length >= maxComparedFiles) return skipped(`GitHub lists ${list.length} changed files, which may be cut short.`)
  }

  const named = new Set(requests.flatMap((request) => (request.path ? [request.path] : [])))
  const inPull = new Set(own.files.map((file) => file.filename))
  const relevant = compared.files.filter((file) => inPull.has(file.filename) || named.has(file.filename) || named.has(file.previous_filename ?? ""))
  // A clean verdict passes the whole diff, so a changed file the model cannot see, too large or binary, stops it. A
  // move without changes and a generated file hide nothing.
  const unshown = relevant.filter((file) => file.patch === undefined && !isGenerated(file.filename) && !(file.status === "renamed" && file.changes === 0))
  if (unshown.length > 0) return skipped(`${unshown[0].filename} has no diff to show.`)
  const shown = relevant.filter((file) => file.patch !== undefined && !isGenerated(file.filename))

  // The pull request's own commits that this head holds after the reviewed commit, without merges.
  const between = new Set(compared.commits.map((commit) => commit.sha))
  const messages = (await github.pullCommits(pr.number)).filter((commit) => between.has(commit.sha) && commit.parents.length === 1).map((commit) => commit.commit.message)

  const contents = new Map<string, string>()
  for (const path of named) {
    const text = await github.fileAt(path, pr.sha)
    if (text !== null && text.length <= limits.maxFileChars) contents.set(path, text)
  }

  const user = fitAfterApproval(
    {
      reviewed,
      approved,
      requests,
      title: pr.title,
      description: pr.body,
      commits: messages,
      files: shown,
      leftOut: relevant.filter((file) => !shown.includes(file)).map((file) => file.filename),
      contents,
    },
    limits.maxInputChars,
  )
  if (user === null) return skipped(`its input is above the cap of ${limits.maxInputChars / 1000}k characters.`)

  const completion = await ask(user)
  const unanswered = skipReason(completion)
  if (unanswered !== null) return skipped(unanswered)
  const answer = readAfterApproval(completion.content, requests.length)
  if (answer.kind === "unaccounted") return skipped(`${answer.why}.`)
  return { reviewed, approved, verdict: answer.kind, text: completion.content.trim() }
}
