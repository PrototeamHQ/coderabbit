import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { askOnce } from "./ask"
import type { Completion } from "./scaleway"
import { skipReason } from "./verdict"

// A recorded response whose model ended its turn with no answer under the input cap: it is asked once more, never again.
const emptyAnswerStream = await Bun.file(join(import.meta.dir, "fixtures", "empty-answer.sse")).text()

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const answer = (content: string, finish: string): Completion => ({ content, reasoning: "", finish, usage: null })

function answers(...completions: Completion[]) {
  const asked: Completion[] = []
  const ask = async () => {
    const next = completions[asked.length]
    asked.push(next)
    return next
  }
  return { ask, asked }
}

describe("askOnce", () => {
  test("asks once more after the recorded empty answer, and no third time", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(emptyAnswerStream)
    }) as unknown as typeof fetch
    const { completion } = await askOnce("key", "system", "user")
    expect(calls).toBe(2)
    expect(skipReason(completion)).toBe("the model ended its turn without an answer.")
  })

  test("asks once for an answer", async () => {
    const { ask, asked } = answers(answer("No issues found.", "stop"))
    const { completion } = await askOnce("key", "system", "user", ask)
    expect(asked).toHaveLength(1)
    expect(completion.content).toBe("No issues found.")
  })

  test("keeps the second answer after an empty one", async () => {
    const { ask, asked } = answers(answer("\n\n", "stop"), answer("No issues found.", "stop"))
    const { completion, emptyFirst } = await askOnce("key", "system", "user", ask)
    expect(asked).toHaveLength(2)
    expect(completion.content).toBe("No issues found.")
    expect(emptyFirst?.content).toBe("\n\n")
  })

  test("does not ask again for an answer cut off at the output cap", async () => {
    const { ask, asked } = answers(answer("", "length"), answer("No issues found.", "stop"))
    const { completion } = await askOnce("key", "system", "user", ask)
    expect(asked).toHaveLength(1)
    expect(skipReason(completion)).toBe("the model used its whole output budget before answering.")
  })
})
