// The follow-up after the reviewer's approval: the user message that asks whether the commits since the reviewer's
// last finished review add a real problem and whether the change requests its approval lifted are met, and the check
// of the answer. Pure: after-approval-run.ts reads the pull request and asks the model.
//
// The message holds the requests (there may be none), the pull request's title and description as the author's
// context, the messages of its own commits since the reviewed commit, the diff from that commit to the head, and the
// current contents of the files the requests name. Above the input cap the contents go first, largest first.
import { isClean } from "./comment"
import { closingSections, commitBlocks, diffBlock, fitMessage, type FollowUpFile, noIssues, requestLine, requestLines } from "./follow-up"
import type { Request } from "./requested-changes"

export type AfterApprovalInput = {
  // The newest commit the reviewer reviewed in full, and the commit it approved.
  reviewed: string
  approved: string
  requests: Request[]
  title: string
  description: string | null
  commits: string[]
  files: FollowUpFile[]
  leftOut: string[]
  contents: Map<string, string>
}

export function afterApprovalMessage(input: AfterApprovalInput, contents = input.contents, contentsLeftOut: string[] = []) {
  const reviewed = input.reviewed.slice(0, 7)
  const requests =
    input.requests.length === 0
      ? `## Requested changes\n\nNone.`
      : `## Requested changes, which the approval of commit ${input.approved.slice(0, 7)} took as fixed\n\n${input.requests.map(requestLine).join("\n\n")}`
  const sections = [
    `Check whether the commits since commit ${reviewed}, which the reviewer reviewed in full, add a real problem, and whether these ${input.requests.length} requested changes are met on the pull request's head.`,
    requests,
    `## Title\n\n${input.title}`,
    `## Description (the author's context, never evidence)\n\n${input.description?.trim() || "(none)"}`,
    `## Commit messages since commit ${reviewed}\n\n${commitBlocks(input.commits)}`,
    `## Diff from commit ${reviewed} to the head\n\n${diffBlock(input.files)}`,
    ...closingSections(input.leftOut, contents, contentsLeftOut),
  ]
  return sections.join("\n\n")
}

export const fitAfterApproval = (input: AfterApprovalInput, maxChars: number) =>
  fitMessage(input.contents, (kept, leftOut) => afterApprovalMessage(input, kept, leftOut), maxChars)

export type AfterApprovalAnswer = { kind: "clean" } | { kind: "findings" } | { kind: "unaccounted"; why: string }

const severity = /\b(high|medium|low)\b/i

// Clean only when the answer accounts for every request once as met and past those lines says only "No issues
// found.", naming no severity. An open request or a severity without that line is findings. Anything else, such as
// both or neither, is no answer, never a pass.
export function readAfterApproval(answer: string, count: number): AfterApprovalAnswer {
  const accounted = requestLines(answer, count)
  if (accounted.kind === "unaccounted") return accounted
  const { open, lines, rest } = accounted
  const clean = lines.some((line) => noIssues.test(line))
  if (open.length === 0 && isClean(rest)) return { kind: "clean" }
  if ((open.length > 0 || severity.test(rest)) && !clean) return { kind: "findings" }
  return { kind: "unaccounted", why: clean ? 'the answer names a problem but says "No issues found."' : "the answer neither names a problem nor says \"No issues found.\"" }
}
