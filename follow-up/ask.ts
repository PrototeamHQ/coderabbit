// Asks the model, with at most one second ask, never more: asking again until an answer passes would make the verdict
// a draw. Only a turn the model ended on its own with no answer is asked once more; any other answer, empty at the
// output cap too, is kept as it is. An answer that is still no verdict is a skipped check.
import { complete, type Completion } from "./scaleway"
import { endedWithoutAnswer } from "./verdict"

export type Complete = (key: string, system: string, user: string) => Promise<Completion>

// The answer to use, and the first ask's empty answer when it was asked again, or null.
export async function askOnce(key: string, system: string, user: string, ask: Complete = complete) {
  const first = await ask(key, system, user)
  if (!endedWithoutAnswer(first)) return { completion: first, emptyFirst: null }
  return { completion: await ask(key, system, user), emptyFirst: first }
}
