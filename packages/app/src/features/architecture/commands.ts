export const ARCHITECTURE_COMMAND_EVENT = "opencode:architecture-command"
export type ArchitectureCommand = "save" | "reload" | "fitView" | "addNode"

export function dispatchArchitectureCommand(command: ArchitectureCommand) {
  document.dispatchEvent(new CustomEvent(ARCHITECTURE_COMMAND_EVENT, { detail: command }))
}
