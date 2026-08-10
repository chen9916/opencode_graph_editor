import type {
  ArchitectureGetDraftOutput,
  ArchitectureGetResourceOutput,
  ArchitecturePatchDraftInput,
} from "@opencode-ai/client/promise"
import type { Direction } from "@/context/language"
import type { ArchitectureCommandAction } from "./commands"
import type { ArchitectureConflict } from "./journal"

export type ArchitectureSnapshot = ArchitectureGetResourceOutput["data"]
export type ArchitectureResource = ArchitectureSnapshot["resource"]
export type ArchitectureNode = ArchitectureResource["nodes"][number]
export type ArchitectureEdge = ArchitectureResource["edges"][number]
export type ArchitectureConnectionSide = NonNullable<ArchitectureEdge["sourceHandle"]>
export type ArchitectureOperation = ArchitecturePatchDraftInput["operations"][number]
export type ArchitectureViewport = { readonly x: number; readonly y: number; readonly zoom: number }
export type ArchitectureEdgeStyle = "rectangular" | "curved" | "straight"

export type ArchitectureDraftSnapshot = ArchitectureGetDraftOutput["data"]
export type ArchitectureLiveDraft = Omit<ArchitectureDraftSnapshot, "source"> & { readonly source: "live" }
export type ArchitectureLiveDraftCache = ArchitectureLiveDraft | null

export type ArchitectureDraft = {
  readonly base: ArchitectureSnapshot
  readonly origin?: ArchitectureSnapshot
  readonly journalBase?: ArchitectureResource
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
  readonly live?: ArchitectureLiveDraft
}

export type ArchitectureDraftChange = {
  readonly base: ArchitectureSnapshot
  readonly origin: ArchitectureSnapshot
  readonly resource: ArchitectureResource
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
}

export type ArchitectureSelectionPrompt = {
  readonly message: string
  readonly resourceID: string
  readonly resourceName: string
  readonly nodeIDs: ReadonlyArray<string>
  readonly edgeIDs: ReadonlyArray<string>
  readonly nodes: ReadonlyArray<{
    readonly id: string
    readonly text: string
    readonly tags: ReadonlyArray<string>
    readonly position: { readonly x: number; readonly y: number }
  }>
  readonly edges: ReadonlyArray<{
    readonly id: string
    readonly source: string
    readonly target: string
    readonly sourceHandle: ArchitectureConnectionSide | undefined
    readonly targetHandle: ArchitectureConnectionSide | undefined
    readonly style: ArchitectureEdgeStyle | undefined
  }>
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
  readonly tagHub: string
  readonly tagColor: string
  readonly tagUsage: (count: number) => string
  readonly noTags: string
  readonly clearColor: string
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
  readonly askSelection: string
  readonly askSelectionPlaceholder: string
  readonly askSelectionLabel: string
  readonly askSelectionContextAttached: string
  readonly send: string
  readonly cancel: string
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
  readonly askSelectionFailed: string
  readonly conflictReasons: Record<ArchitectureConflict["reason"], string>
}

export type ArchitecturePanelProps = {
  readonly direction: Direction
  readonly mobile: boolean
  readonly snapshot: ArchitectureSnapshot
  readonly draft?: ArchitectureDraft
  readonly reloadGeneration: number
  readonly viewport?: ArchitectureViewport
  readonly busy: boolean
  readonly action?: ArchitectureCommandAction
  readonly labels: ArchitectureLabels
  readonly onJournal: (change: ArchitectureDraftChange) => void
  readonly onViewport: (viewport: ArchitectureViewport) => void
  readonly onSave: (change: ArchitectureDraftChange) => void
  readonly onDuplicate: (change: ArchitectureDraftChange) => void
  readonly onAskSelection?: (input: ArchitectureSelectionPrompt) => void
  readonly onReload: () => void
  readonly onExport: (operations: ReadonlyArray<ArchitectureOperation>) => void
  readonly onExportResource: (resource: ArchitectureResource) => void
  readonly onConfirm: (message: string, confirmLabel: string, action: () => void) => void
}
