import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { complete } from "./scaleway"
import { endedWithoutAnswer, skipReason } from "./verdict"

// A recorded response whose model ended its turn with no answer: its finish reason and usage as the job logged them,
// with neutral filler in place of its reasoning text.
const emptyAnswerStream = await Bun.file(join(import.meta.dir, "fixtures", "empty-answer.sse")).text()

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("the recorded empty answer is a turn the model ended with no answer, which is no verdict", async () => {
  globalThis.fetch = (async () => new Response(emptyAnswerStream)) as unknown as typeof fetch
  const completion = await complete("key", "system", "user")
  expect(completion.finish).toBe("stop")
  expect(completion.usage).toMatchObject({ completion_tokens: 9390, completion_tokens_details: { reasoning_tokens: 9389 } })
  expect(endedWithoutAnswer(completion)).toBe(true)
  expect(skipReason(completion)).toBe("the model ended its turn without an answer.")
})
