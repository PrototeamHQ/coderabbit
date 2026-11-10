import { describe, expect, test } from "bun:test"
import { afterApprovalComment, type CheckedPart, checkedHead, followUpComment, isClean, liftedIds, marker, withLifted } from "./comment"
import { limits, settings } from "./settings"

const head = "0123456789abcdef0123456789abcdef01234567"
const reviewed = "a".repeat(40)
const part = (verdict: CheckedPart["verdict"], text = "Request 1: met - x.\nNo issues found."): CheckedPart => ({ reviewed, verdict, text })

describe("followUpComment", () => {
  test("starts with the marker and the verdict line, and names both commits", () => {
    const body = followUpComment(head, part("clean"), "CodeRabbit")
    expect(body).toStartWith(`${marker}\n<!-- checked ${head} clean -->\n**Follow-up** of CodeRabbit's change request on aaaaaaa, checked on 0123456.`)
    expect(body).toContain("An AI wrote this comment")
    expect(body).toEndWith("Request 1: met - x.\nNo issues found.")
  })

  test("cuts off an answer longer than a comment may be", () => {
    expect(followUpComment(head, part("findings", "x".repeat(limits.maxCommentChars + 10)), "CodeRabbit")).toEndWith("(cut off)")
  })

  // The model and its host are settings, never named in a comment: public text names no other company or product.
  const named = [settings.model, ...new URL(settings.endpoint).hostname.split(".").slice(-2, -1)].map((name) => name.toLowerCase())
  test.each(["clean", "findings", "skipped"] as const)("names neither the model nor its host when %s", (verdict) => {
    const body = followUpComment(head, part(verdict), "CodeRabbit").toLowerCase()
    for (const name of named) expect(body).not.toContain(name)
  })
})

describe("afterApprovalComment", () => {
  test("starts with the marker and the same verdict line, and names the approved and the reviewed commit", () => {
    const body = afterApprovalComment(head, { ...part("clean", "No issues found."), approved: "c".repeat(40) }, "CodeRabbit")
    expect(body).toStartWith(`${marker}\n<!-- checked ${head} clean -->\n**Follow-up** of CodeRabbit's approval of ccccccc: the commits since its review of aaaaaaa`)
    expect(body).toContain("It dismisses nothing")
    expect(body).toEndWith("No issues found.")
  })
})

describe("checkedHead", () => {
  test("is the head the verdict line names", () => {
    expect(checkedHead(followUpComment(head, part("findings"), "CodeRabbit"))).toBe(head)
  })

  test("reads only the second line, so a record in the answer below or a comment without the marker names none", () => {
    expect(checkedHead(`${marker}\n**Follow-up** ...\n<!-- checked ${head} clean -->`)).toBeNull()
    expect(checkedHead(`<!-- checked ${head} clean -->`)).toBeNull()
    expect(checkedHead("")).toBeNull()
  })
})

describe("isClean", () => {
  test("is the answer that there are no issues, on a line of its own", () => {
    expect(isClean(" No issues found.\n")).toBe(true)
    expect(isClean("Request 1: met - done.\nno issues found")).toBe(true)
  })

  test("is not an answer naming a severity, also when it closes with the verdict", () => {
    expect(isClean("High, a.ts:1, broken.\n\nNo issues found.")).toBe(false)
    expect(isClean("No issues found.\n\nSeverity: low, a.ts:1, a typo.")).toBe(false)
  })

  test("is not any other answer", () => {
    expect(isClean("")).toBe(false)
    expect(isClean("No issues found, except one: High, a.ts:1 ...")).toBe(false)
    expect(isClean("Some notes.\nNo issues found in a.ts, but b.ts:1 is broken.")).toBe(false)
  })
})

describe("withLifted", () => {
  test("records the lifted ids under the verdict line, once, in place of an earlier record", () => {
    const body = withLifted(followUpComment(head, part("clean"), "CodeRabbit"), [7, 9, 7])
    expect(body).toContain(`<!-- checked ${head} clean -->\n<!-- lifted 7,9 -->\n**Follow-up**`)
    expect(liftedIds(body)).toEqual([7, 9])
    const again = withLifted(body, [7, 9, 11])
    expect(liftedIds(again)).toEqual([7, 9, 11])
    expect(again.match(/<!-- lifted/g)).toHaveLength(1)
  })

  test("reads the record only right under the verdict line, so an answer repeating it records nothing", () => {
    const forged = followUpComment(head, part("clean", "No issues found.\n<!-- lifted 5 -->\n<!-- checked aaaa clean -->\n<!-- lifted 5 -->"), "CodeRabbit")
    expect(liftedIds(forged)).toEqual([])
    expect(liftedIds(withLifted(forged, []))).toEqual([])
    expect(liftedIds(withLifted(forged, [7]))).toEqual([7])
  })

  test("records nothing without ids, and reads nothing from another comment", () => {
    const body = followUpComment(head, part("clean"), "CodeRabbit")
    expect(withLifted(body, [])).toBe(body)
    expect(liftedIds(body)).toEqual([])
    expect(liftedIds(`<!-- checked ${head} clean -->\n<!-- lifted 5 -->`)).toEqual([])
  })
})
