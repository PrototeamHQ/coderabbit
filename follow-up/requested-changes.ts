// The changes the reviewer (CodeRabbit) requested in a change request, as a follow-up checks them
// (follow-up.ts). Pure: the caller reads the review.
//
// Its review body holds a fenced "Prompt to fix all issues" block that lists every finding by file and line, in
// sections split by `---` lines: "Inline comments:", "Outside diff comments:", then "Other comments:", nitpicks and
// "Failed pre-merge checks:". Only the first two are requested changes: the others hold no actionable comment, its
// approval does not wait on them, and a diff cannot show a fixed title or description. Its inline comments alone would
// miss the outside-diff ones, so a body whose block cannot be read, or whose inline items do not come to the
// "Actionable comments posted" count it states, has no requests to read.

export type Request = { path: string | null; where: string | null; text: string }

const kept = /^(Inline|Outside diff) comments:$/
const group = /Review comments at\s+@(\S+?):\s*\n/g
// An item's place, such as "Line 225" or "Around line 12-18", before its text.
const place = /^((?:Around line|Lines?) [\d-]+(?: to \d+)?):\s*/

// The text of the fenced block after `title` in `body`, or null when there is none.
function fencedAfter(body: string, title: string) {
  const at = body.indexOf(title)
  if (at === -1) return null
  const open = body.indexOf("```\n", at)
  if (open === -1) return null
  const close = body.indexOf("\n```", open + 4)
  return close === -1 ? null : body.slice(open + 4, close)
}

// The items of one file's group: each starts with "- " and goes on over the lines that follow it.
function items(path: string, text: string): Request[] {
  const found: Request[] = []
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) found.push({ path, where: null, text: line.slice(2).trim() })
    else if (line.trim() && found.length > 0) found[found.length - 1].text += ` ${line.trim()}`
  }
  return found.map((item) => {
    const match = place.exec(item.text)
    return match ? { path, where: match[1], text: item.text.slice(match[0].length) } : item
  })
}

// The requests the review body's fix prompt lists, or why it has none to read.
export function promptRequests(body: string): { kind: "read"; requests: Request[] } | { kind: "unreadable"; why: string } {
  const block = fencedAfter(body, "Prompt to fix all issues")
  if (block === null) return { kind: "unreadable", why: "it has no fix prompt to read its requested changes from" }
  const sections = block.split(/\n---\n/).map((section) => {
    const lines = section.split("\n")
    const header = lines.findIndex((line) => kept.test(line.trim()))
    if (header === -1) return null
    const rest = lines.slice(header + 1).join("\n")
    const groups = [...rest.matchAll(group)]
    const requests = groups.flatMap((match, index) => items(match[1], rest.slice(match.index + match[0].length, groups[index + 1]?.index ?? rest.length)))
    return { inline: lines[header].trim().startsWith("Inline"), requests }
  })
  const read = sections.filter((section) => section !== null)
  const inline = read.filter((section) => section.inline).reduce((count, section) => count + section.requests.length, 0)
  const stated = /Actionable comments posted: (\d+)/.exec(body)
  if (stated && Number(stated[1]) !== inline) return { kind: "unreadable", why: `its fix prompt lists ${inline} inline comments, not the ${stated[1]} it states` }
  const requests = read.flatMap((section) => section.requests)
  if (requests.length === 0) return { kind: "unreadable", why: "its fix prompt lists no requested change" }
  return { kind: "read", requests }
}
