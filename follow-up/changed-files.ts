// A pull request's changed files as the GitHub API lists them, and which of them are generated.

export type ChangedFile = {
  filename: string
  status: string
  patch?: string
  previous_filename?: string
}

// Generated files whose diff says nothing a reviewer can act on. They are named as left out instead.
const generated = [
  /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/,
  /\.sql\.json$/,
  /(^|\/)CHANGELOG(\.md)?$/,
  /\.min\.(js|css)$/,
]

export const isGenerated = (path: string) => generated.some((pattern) => pattern.test(path))
