import { expect, test } from "bun:test"
import { isGenerated } from "./changed-files"

test("lock files, changelogs, minified files and SQL snapshots are generated, source is not", () => {
  for (const path of ["bun.lock", "a/package-lock.json", "CHANGELOG.md", "dist/app.min.js", "db/schema.sql.json"]) expect(isGenerated(path)).toBe(true)
  for (const path of ["src/lock.ts", "docs/changelog-policy.md", "app.js"]) expect(isGenerated(path)).toBe(false)
})
