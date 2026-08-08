// Graph editor is new, developer-facing vocabulary. Keep these keys on the
// existing English runtime fallback until each locale receives terminology
// reviewed against its developer-tooling corpus.
export const englishFallbackKeys = new Set([
  "session.tab.architecture",
  "session.panel.reviewFilesArchitecture",
  "command.architecture.open",
  "command.architecture.save",
  "command.architecture.reload",
  "command.architecture.fitView",
  "command.architecture.undo",
  "command.architecture.redo",
  "command.architecture.delete",
  "command.architecture.addNode",
  "settings.shortcuts.group.graphEditor",
])

export function usesEnglishFallback(key: string) {
  return key.startsWith("architecture.") || englishFallbackKeys.has(key)
}
