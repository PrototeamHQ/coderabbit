// Who the follow-up check runs for. Its input, the diff, the commit messages, the description and the reviewer's
// findings, is the author's to write, and its pass dismisses a change request, so it runs only where everything in
// that input already came from someone trusted to change the repository: an open, ready pull request whose head is a
// branch of this repository, not a fork, by an author with write access. Anything else never reaches the model.
import type { PullRequest } from "./github"

export type Gate = { allowed: true } | { allowed: false; why: string }

const writers = new Set(["admin", "write"])

// `permission` reads the author's legacy permission on the repository (github.ts); it is only asked for a pull
// request that passes every other check.
export async function gate(repository: string, pullRequest: PullRequest, permission: (login: string) => Promise<string>): Promise<Gate> {
  if (pullRequest.state !== "open") return { allowed: false, why: "the pull request is closed." }
  if (pullRequest.draft) return { allowed: false, why: "the pull request is a draft." }
  if (pullRequest.head.repo === null) return { allowed: false, why: "its head is in a fork that was deleted." }
  if (pullRequest.head.repo.full_name !== repository) return { allowed: false, why: "its head is in a fork." }
  const login = pullRequest.user.login
  const level = await permission(login)
  if (!writers.has(level)) return { allowed: false, why: `its author ${login} has ${level} access, not write.` }
  return { allowed: true }
}
