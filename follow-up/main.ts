// Runs the follow-up check of one pull request (check.ts) and writes its outcome to the step's output as `verdict`.
// It reads the pull request only through the GitHub API, as data, and never checks out or runs its code.
//
//   REPOSITORY=owner/name PR_NUMBER=1 GITHUB_TOKEN=... SCW_PR_REVIEW_SECRET_KEY=... [GITHUB_OUTPUT=path] bun main.ts
import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { askOnce } from "./ask"
import { runCheck } from "./check"
import { gitHub } from "./github"
import type { Completion } from "./scaleway"
import { emptyAnswerReasoning } from "./verdict"

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const repository = required("REPOSITORY")
const number = Number(required("PR_NUMBER"))
const github = gitHub(required("GITHUB_TOKEN"), repository)
// Fixed text with nothing of the pull request in it.
const prompt = (name: string) => Bun.file(join(import.meta.dir, "prompts", `${name}.md`)).text()
const prompts = { followUp: await prompt("follow-up"), afterApproval: await prompt("after-approval") }

// The usage line, and for an empty answer the end of the reasoning, go to the job log only, never to the comment.
function logAsk(completion: Completion) {
  console.log(`finish=${completion.finish} usage=${JSON.stringify(completion.usage)}`)
  const reasoning = emptyAnswerReasoning(completion)
  if (reasoning !== null) console.log(`The answer is empty; the reasoning ends with:\n${reasoning}`)
}

// The key is read only once the gate let the pull request through and a follow-up is due.
const asking = (system: string) => async (user: string) => {
  console.log(`Follow-up, ${Math.round(user.length / 1000)}k characters:`)
  const { completion, emptyFirst } = await askOnce(required("SCW_PR_REVIEW_SECRET_KEY"), system, user)
  if (emptyFirst) {
    logAsk(emptyFirst)
    console.log("Asked once more, as the model ended its turn with no answer.")
  }
  logAsk(completion)
  return completion
}

const verdict = await runCheck(github, { followUp: asking(prompts.followUp), afterApproval: asking(prompts.afterApproval) }, repository, number)
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `verdict=${verdict}\n`)
