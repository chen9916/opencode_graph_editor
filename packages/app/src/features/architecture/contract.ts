import type { ArchitectureGetResourceOutput, ArchitecturePatchResourceInput } from "@opencode-ai/client/promise"
import type { Direction } from "@/context/language"
import type { ArchitectureConflict } from "./journal"

export type ArchitectureSnapshot = ArchitectureGetResourceOutput["data"]
export type ArchitectureResource = ArchitectureSnapshot["resource"]
export type ArchitectureNode = ArchitectureResource["nodes"][number]
export type ArchitectureEdge = ArchitectureResource["edges"][number]
export type ArchitectureConnectionSide = NonNullable<ArchitectureEdge["sourceHandle"]>
export type ArchitectureOperation = ArchitecturePatchResourceInput["operations"][number]
export type ArchitectureViewport = { readonly x: number; readonly y: number; readonly zoom: number }
export type ArchitectureEdgeStyle = "rectangular" | "curved" | "straight"

export type ArchitectureDraft = {
  readonly base: ArchitectureSnapshot
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
}

export type ArchitectureLabels = {
  readonly title: string
  readonly revision: (revision: number) => string
  readonly nodes: (count: number) => string
  readonly edges: (count: number) => string
  readonly outlineTitle: string
  readonly inspectorTitle: string
  readonly properties: string
  readonly connectionStyle: string
  readonly sourceSide: string
  readonly targetSide: string
  readonly sides: Record<ArchitectureConnectionSide, string>
  readonly rectangular: string
  readonly curved: string
  readonly straight: string
  readonly name: string
  readonly text: string
  readonly tags: string
  readonly search: string
  readonly allTags: string
  readonly clearFilters: string
  readonly addNode: string
  readonly save: string
  readonly reload: string
  readonly fitView: string
  readonly fitSelection: string
  readonly undo: string
  readonly redo: string
  readonly delete: string
  readonly duplicate: string
  readonly exportPatch: string
  readonly conflicts: string
  readonly dirty: string
  readonly clean: string
  readonly selectedItems: (nodes: number, edges: number) => string
  readonly moveSelectionHint: string
  readonly resourceDetails: string
  readonly discardConfirm: string
  readonly deleteNodeConfirm: string
  readonly deleteEdgeConfirm: string
  readonly deleteSelectionConfirm: string
  readonly copied: string
  readonly saveFailed: string
  readonly conflictReasons: Record<ArchitectureConflict["reason"], string>
}

export type ArchitecturePanelProps = {
  readonly direction: Direction
  readonly mobile: boolean
  readonly snapshot: ArchitectureSnapshot
  readonly draft?: ArchitectureDraft
  readonly viewport?: ArchitectureViewport
  readonly busy: boolean
  readonly action?: {
    readonly id: number
    readonly type: "save" | "reload" | "fitView" | "addNode" | "undo" | "redo" | "delete"
  }
  readonly labels: ArchitectureLabels
  readonly onJournal: (operations: ReadonlyArray<ArchitectureOperation>) => void
  readonly onViewport: (viewport: ArchitectureViewport) => void
  readonly onSave: (operations: ReadonlyArray<ArchitectureOperation>) => void
  readonly onReload: () => void
  readonly onExport: (operations: ReadonlyArray<ArchitectureOperation>) => void
  readonly onConfirm: (message: string, confirmLabel: string, action: () => void) => void
}
