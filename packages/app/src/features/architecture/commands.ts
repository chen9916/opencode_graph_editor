export const ARCHITECTURE_COMMAND_EVENT = "opencode:architecture-command"
const ARCHITECTURE_PANEL_TARGET = "[data-architecture-panel]"
let lastArchitectureCommandTarget: Element | undefined

export type ArchitectureCommand =
  | "save"
  | "reload"
  | "fitView"
  | "addNode"
  | "undo"
  | "redo"
  | "delete"
  | "exportPatch"
  | "exportResource"
  | "duplicateResource"
export type ArchitectureCommandRequest =
  | ArchitectureCommand
  | {
      readonly type: ArchitectureCommand
      readonly target?: Element | null
    }
export type ArchitectureCommandAction = {
  readonly id: number
  readonly type: ArchitectureCommand
  readonly server: string
  readonly directory: string
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

export function architectureCommandMatches(
  action: ArchitectureCommandAction | undefined,
  target: string | { readonly server: string; readonly directory: string; readonly resourceID: string },
) {
  if (!action) return false
  if (typeof target === "string") return action.resourceID === target
  return (
    action.server === target.server &&
    action.directory === target.directory &&
    action.resourceID === target.resourceID
  )
}

export function architecturePanelCommandTarget(event: KeyboardEvent) {
  const target =
    event.target instanceof Element
      ? event.target
      : typeof document !== "undefined" && document.activeElement instanceof Element
        ? document.activeElement
        : undefined
  if (target && architectureTextEntryTarget(target)) return false
  const panel = target ? architectureCommandPanel(target) : undefined
  if (!panel) {
    if (target && !architecturePanelFallbackTarget(target)) return false
    const fallback = architectureCommandTarget()
    if (!fallback) return false
    lastArchitectureCommandTarget = fallback
    return true
  }
  lastArchitectureCommandTarget = target
  return true
}

export function architectureCommandRequest(detail: unknown): ArchitectureCommandRequest | undefined {
  if (isArchitectureCommand(detail)) return detail
  if (!detail || typeof detail !== "object") return
  const type = "type" in detail ? detail.type : undefined
  if (!isArchitectureCommand(type)) return
  const target =
    typeof Element !== "undefined" && "target" in detail && detail.target instanceof Element
      ? detail.target
      : undefined
  return { type, target }
}

export function architectureCommandRequestType(detail: ArchitectureCommandRequest) {
  return typeof detail === "string" ? detail : detail.type
}

export function architectureCommandRequestTarget(detail: ArchitectureCommandRequest) {
  return typeof detail === "string" ? undefined : detail.target
}

export function dispatchArchitectureCommand(command: ArchitectureCommand, target?: Element | null) {
  if (typeof document === "undefined") return
  document.dispatchEvent(
    new CustomEvent(ARCHITECTURE_COMMAND_EVENT, {
      detail: { type: command, target: target ?? architectureCommandTarget() },
    }),
  )
}

function architectureCommandTarget() {
  if (document.activeElement instanceof Element && architectureCommandPanel(document.activeElement))
    return document.activeElement
  if (lastArchitectureCommandTarget && architectureCommandPanel(lastArchitectureCommandTarget))
    return lastArchitectureCommandTarget
  return Array.from(document.querySelectorAll<HTMLElement>(ARCHITECTURE_PANEL_TARGET)).find(architecturePanelVisible)
}

function architectureCommandPanel(target: Element) {
  const panel = target.closest<HTMLElement>(ARCHITECTURE_PANEL_TARGET)
  if (!panel || !architecturePanelVisible(panel)) return
  return panel
}

function architectureTextEntryTarget(target: Element) {
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return !!target.closest("input, textarea, select, [contenteditable='true']")
}

function architecturePanelFallbackTarget(target: Element) {
  return target === document.body || target === document.documentElement
}

function architecturePanelVisible(panel: HTMLElement) {
  return panel.isConnected && !panel.closest("[inert], [hidden], .hidden")
}

function isArchitectureCommand(value: unknown): value is ArchitectureCommand {
  return (
    value === "save" ||
    value === "reload" ||
    value === "fitView" ||
    value === "addNode" ||
    value === "undo" ||
    value === "redo" ||
    value === "delete" ||
    value === "exportPatch" ||
    value === "exportResource" ||
    value === "duplicateResource"
  )
}
