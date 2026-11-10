// The model and request settings of the follow-up check. Switching models is a change to `model` alone.
// qwen3.8-27b made no false claims and caught every known real bug in a reliability benchmark of review models, at
// temperature 0.6 and medium reasoning effort (it offers no high). The output cap is Scaleway's 32k maximum, and
// max_tokens counts reasoning and answer together. Now and then the model gives no answer: it can reason until that
// cap, or, well below it, stop mid-sentence in its reasoning and reply with nothing; the job log then shows that
// reasoning's end. Only settings Scaleway documents are sent. A check gets one second ask at most (ask.ts), as asking
// again until an answer passes would make the verdict a draw.
export const settings = {
  model: "qwen3.8-27b",
  endpoint: "https://api.scaleway.ai/v1/chat/completions",
  temperature: 0.6,
  maxTokens: 32000,
  reasoningEffort: "medium",
}

// What a check may send. Above maxInputChars, file contents are left out, largest first; a check whose diff alone is
// above it is skipped. Asks of about 44k tokens or more often got no answer, against few below, and code runs about
// 3.35 characters per token, so maxInputChars keeps an ask near 39k tokens.
export const limits = {
  // The most files GitHub lists for a pull request.
  maxListedFiles: 3000,
  maxInputChars: 130_000,
  maxFileChars: 60_000,
  maxCommentChars: 60_000,
}

// The reviewer whose change requests the check follows up: its account login in REST, the name the comments use, and
// the GitHub App and name of the check run it writes on each commit, which concludes success only on a commit it
// reviewed in full. That holds only while its incremental reviews are off (.coderabbit.yaml): with them on, success
// would follow every push, also one it approved on the author's word. The merge workflow that reads the verdict tells
// a finished review apart by the same app, name and conclusion.
export const reviewer = {
  name: "CodeRabbit",
  login: "coderabbitai[bot]",
  app: "coderabbitai",
  check: "CodeRabbit",
}
