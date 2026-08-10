export const ARCHITECTURE_COMMAND_EVENT = "opencode:architecture-command"
export type ArchitectureCommand = "save" | "reload" | "fitView" | "addNode" | "undo" | "redo" | "delete" | "exportPatch"
export type ArchitectureCommandAction = {
  readonly id: number
  readonly type: ArchitectureCommand
  readonly resourceID: string
}

export const architectureCommandKeybinds = {
  save: "mod+s",
  reload: "mod+r",
  fitView: "mod+0",
  undo: "mod+z",
  redo: "mod+shift+z",
  delete: "backspace,delete",
} satisfies Partial<Record<ArchitectureCommand, string>>

export function architectureCommandMatches(action: ArchitectureCommandAction | undefined, resourceID: string) {
  return action?.resourceID === resourceID
}

export function architectureEditorCommandTarget(event: KeyboardEvent) {
  const target =
    event.target instanceof Element
      ? event.target
      : typeof document !== "undefined" && document.activeElement instanceof Element
        ? document.activeElement
        : undefined
  if (!target?.closest(".architecture-editor")) return false
  if (target instanceof HTMLElement && target.isContentEditable) return false
  return !target.closest("input, textarea, select, [contenteditable='true']")
}

export function dispatchArchitectureCommand(command: ArchitectureCommand) {
  document.dispatchEvent(new CustomEvent(ARCHITECTURE_COMMAND_EVENT, { detail: command }))
}
