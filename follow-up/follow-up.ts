// The follow-up of the reviewer's change request: the user message that asks whether each requested change is
// met on the head, and the check of the answer. Pure: follow-up-run.ts reads the pull request and asks the model.
//
// The message holds only what the check needs: the numbered requests, the pull request's title and description as the
// author's context, the messages of its own commits since the reviewed commit, the diff from that commit to the head,
// and the current contents of the files the requests name. Above the input cap the contents go first, largest first.
import { isClean } from "./comment"
import type { Request } from "./requested-changes"

export type FollowUpFile = { filename: string; status: string; patch?: string; previous_filename?: string }
export type FollowUpInput = {
  reviewed: string
  // The reviewed commit is no longer in the head's history, so the commits and the diff are the pull request's own.
  rebased: boolean
  requests: Request[]
  title: string
  description: string | null
  commits: string[]
  files: FollowUpFile[]
  leftOut: string[]
  contents: Map<string, string>
}

const requestLine = (request: Request, index: number) => {
  const where = [request.path, request.where].filter(Boolean).join(", ")
  return `Request ${index + 1}${where ? ` (${where})` : ""}: ${request.text}`
}

const fence = (text: string) => text.replaceAll("```", "'''")

export function followUpMessage(input: FollowUpInput, contents = input.contents, contentsLeftOut: string[] = []) {
  const sections = [
    `Check whether these ${input.requests.length} requested changes are met on the pull request's head.`,
    `## Requested changes, on commit ${input.reviewed}\n\n${input.requests.map(requestLine).join("\n\n")}`,
    `## Title\n\n${input.title}`,
    `## Description (the author's context, never evidence)\n\n${input.description?.trim() || "(none)"}`,
    `## ${input.rebased ? "The pull request's commit messages" : `Commit messages since commit ${input.reviewed.slice(0, 7)}`}\n\n${input.commits.map((message) => `\`\`\`\n${fence(message.trim())}\n\`\`\``).join("\n\n") || "(none)"}`,
    `## ${input.rebased ? `The pull request's whole diff, as commit ${input.reviewed.slice(0, 7)} is no longer in its history` : `Diff from commit ${input.reviewed.slice(0, 7)} to the head`}\n\n\`\`\`diff\n${input.files.map((file) => `diff --git a/${file.filename} b/${file.filename} (${file.status})\n${file.patch ?? ""}`).join("\n")}\n\`\`\``,
  ]
  if (input.leftOut.length > 0) sections.push(`## Changed but left out\n\nGenerated, binary or too large to diff:\n${input.leftOut.map((path) => `- ${path}`).join("\n")}`)
  if (contentsLeftOut.length > 0) sections.push(`## Contents left out to fit\n\n${contentsLeftOut.map((path) => `- ${path}`).join("\n")}`)
  const files = [...contents].map(([path, text]) => `### ${path}\n\n\`\`\`\n${text}\n\`\`\``)
  if (files.length > 0) sections.push(`## Current contents at the head of the files the requests name\n\n${files.join("\n\n")}`)
  return sections.join("\n\n")
}

// The message fitted under maxChars, leaving out file contents largest first, or null when the rest alone is above it.
export function fitFollowUp(input: FollowUpInput, maxChars: number) {
  const kept = new Map(input.contents)
  const leftOut: string[] = []
  const largestFirst = [...input.contents].sort(([, a], [, b]) => b.length - a.length).map(([path]) => path)
  for (;;) {
    const message = followUpMessage(input, kept, leftOut)
    if (message.length <= maxChars) return message
    const largest = largestFirst.shift()
    if (largest === undefined) return null
    kept.delete(largest)
    leftOut.push(largest)
  }
}

export type FollowUpAnswer = { kind: "met" } | { kind: "open"; open: number[] } | { kind: "unaccounted"; why: string }

const status = /^\W*Request (\d+)\W*:?\W*(met|open)\b/i
const noIssues = /^no issues found\.?$/i

// Whether the answer accounts for every request once, in its `Request <n>: met|open` lines, and agrees with itself:
// "No issues found." exactly when every request is met. Anything else is no answer, never a pass.
export function readFollowUp(answer: string, count: number): FollowUpAnswer {
  const lines = answer.split("\n").map((line) => line.trim())
  const verdicts = new Map<number, string>()
  for (const match of lines.map((line) => status.exec(line)).filter((match) => match !== null)) {
    const number = Number(match[1])
    if (verdicts.has(number)) return { kind: "unaccounted", why: `the answer names request ${number} twice` }
    verdicts.set(number, match[2].toLowerCase())
  }
  const missing = Array.from({ length: count }, (_, index) => index + 1).filter((number) => !verdicts.has(number))
  if (missing.length > 0 || verdicts.size !== count) return { kind: "unaccounted", why: `the answer does not account for each of the ${count} requests once` }
  const open = [...verdicts].filter(([, verdict]) => verdict === "open").map(([number]) => number)
  const clean = lines.some((line) => noIssues.test(line))
  // Past its request lines, an answer that meets every request says only that no issues were found, naming no severity.
  const rest = lines.filter((line) => !status.test(line)).join("\n")
  if (open.length === 0 && !isClean(rest)) return { kind: "unaccounted", why: 'the answer meets every request but does not say only "No issues found."' }
  if (open.length > 0 && clean) return { kind: "unaccounted", why: 'the answer leaves a request open but says "No issues found."' }
  return open.length === 0 ? { kind: "met" } : { kind: "open", open }
}
