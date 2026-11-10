import { describe, expect, test } from "bun:test"
import { gate } from "./gate"
import type { PullRequest } from "./github"

const pullRequest = (change: Partial<PullRequest> = {}): PullRequest => ({
  title: "Fix",
  body: null,
  state: "open",
  draft: false,
  user: { login: "ann" },
  head: { sha: "b".repeat(40), repo: { full_name: "o/r" } },
  ...change,
})

const asked: string[] = []
const permission = (level: string) => async (login: string) => {
  asked.push(login)
  return level
}

describe("gate", () => {
  test("lets an open, ready pull request from this repository by a writer through", async () => {
    expect(await gate("o/r", pullRequest(), permission("write"))).toEqual({ allowed: true })
    expect(await gate("o/r", pullRequest(), permission("admin"))).toEqual({ allowed: true })
  })

  test("stops an author without write access", async () => {
    for (const level of ["read", "none", "triage", ""]) {
      expect(await gate("o/r", pullRequest(), permission(level))).toEqual({ allowed: false, why: `its author ann has ${level} access, not write.` })
    }
  })

  test("stops a fork, a deleted fork, a draft and a closed pull request without asking for the author's access", async () => {
    asked.length = 0
    expect(await gate("o/r", pullRequest({ head: { sha: "b", repo: { full_name: "mallory/r" } } }), permission("admin"))).toEqual({ allowed: false, why: "its head is in a fork." })
    expect(await gate("o/r", pullRequest({ head: { sha: "b", repo: null } }), permission("admin"))).toEqual({ allowed: false, why: "its head is in a fork that was deleted." })
    expect((await gate("o/r", pullRequest({ draft: true }), permission("admin"))).allowed).toBe(false)
    expect((await gate("o/r", pullRequest({ state: "closed" }), permission("admin"))).allowed).toBe(false)
    expect(asked).toEqual([])
  })
})
