export const ARCHITECTURE_COMMAND_EVENT = "opencode:architecture-command"
export type ArchitectureCommand = "save" | "reload" | "fitView" | "addNode" | "undo" | "redo" | "delete"
export type ArchitectureCommandAction = {
  readonly id: number
  readonly type: ArchitectureCommand
  readonly resourceID: string
}

export function architectureCommandMatches(action: ArchitectureCommandAction | undefined, resourceID: string) {
  return action?.resourceID === resourceID
}

export function dispatchArchitectureCommand(command: ArchitectureCommand) {
  document.dispatchEvent(new CustomEvent(ARCHITECTURE_COMMAND_EVENT, { detail: command }))
}
