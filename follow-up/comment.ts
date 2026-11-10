// The one comment the follow-up check keeps on a pull request. It is found again by its marker and updated in place. A
// hidden line records the head it checked and its verdict, and the line under it the reviewer's change requests a
// follow-up lifted (change-requests.ts). Model text only ever goes below both, so an answer cannot write either.
import { limits } from "./settings"

export const marker = "<!-- coderabbit-follow-up -->"

export type Verdict = "clean" | "findings" | "skipped"

export type CheckedPart = { reviewed: string; verdict: Verdict; text: string }

// The comment's body: the marker, the verdict line of `head`, the intro and the part's text, cut to what a comment
// may hold.
function commentBody(head: string, verdict: Verdict, intro: string, partText: string) {
  const text = partText.length > limits.maxCommentChars ? `${partText.slice(0, limits.maxCommentChars)}\n\n(cut off)` : partText
  return `${marker}\n<!-- checked ${head} ${verdict} -->\n${intro}\n\n${text}`
}

// The comment for a follow-up of the reviewer's change request on `head`.
export function followUpComment(head: string, part: CheckedPart, reviewerName: string) {
  const intro =
    `**Follow-up** of ${reviewerName}'s change request on ${part.reviewed.slice(0, 7)}, checked on ${head.slice(0, 7)}. ` +
    "An AI wrote this comment and can be wrong. A clean follow-up dismisses the change request it checked."
  return commentBody(head, part.verdict, intro, part.text)
}

// The comment for a follow-up of the reviewer's approval of an earlier commit on `head`.
export function afterApprovalComment(head: string, part: CheckedPart & { approved: string }, reviewerName: string) {
  const intro =
    `**Follow-up** of ${reviewerName}'s approval of ${part.approved.slice(0, 7)}: the commits since its review of ${part.reviewed.slice(0, 7)} and the changes it requested, checked on ${head.slice(0, 7)}. ` +
    "An AI wrote this comment and can be wrong. It dismisses nothing, and a later run on this head keeps this verdict."
  return commentBody(head, part.verdict, intro, part.text)
}

// Whether an answer found nothing. The model says so with the line "No issues found." (prompts/follow-up.md); it
// tags each open request with a severity, so an answer naming one is never clean, even as a word in prose: this
// verdict lifts a change request, so in doubt it reads findings.
export function isClean(answer: string) {
  const verdict = answer.split("\n").some((line) => /^no issues found\.?$/i.test(line.trim()))
  return verdict && !/\b(high|medium|low)\b/i.test(answer)
}

const verdictLine = /^<!-- checked ([0-9a-f]+) (clean|findings|skipped) -->$/m

const liftedLine = /^<!-- lifted ([\d,]+) -->$/

// The head the comment's verdict line, its second line, names, or null when it has none there.
export function checkedHead(body: string) {
  if (!body.startsWith(`${marker}\n`)) return null
  return /^<!-- checked ([0-9a-f]+) (clean|findings|skipped) -->$/.exec(body.split("\n", 2)[1])?.[1] ?? null
}

// The ids of the reviewer's change requests a follow-up found met, as the comment records them right under its
// verdict line; an answer that repeats the record anywhere else records nothing.
export function liftedIds(body: string) {
  if (!body.startsWith(marker)) return []
  const verdict = verdictLine.exec(body)
  if (verdict === null) return []
  const next = body.slice(verdict.index + verdict[0].length + 1).split("\n", 1)[0]
  return liftedLine.exec(next)?.[1].split(",").map(Number) ?? []
}

// The comment with `ids` recorded as lifted, right under its verdict line, in place of any such record there; a comment
// without a verdict line is left as it is.
export function withLifted(body: string, ids: number[]) {
  const verdict = verdictLine.exec(body)
  if (verdict === null) return body
  const at = verdict.index + verdict[0].length + 1
  const rest = body.slice(at)
  const after = liftedLine.test(rest.split("\n", 1)[0]) ? rest.slice(rest.indexOf("\n") + 1) : rest
  return ids.length === 0 ? `${body.slice(0, at)}${after}` : `${body.slice(0, at)}<!-- lifted ${[...new Set(ids)].join(",")} -->\n${after}`
}
