import type {
  ArchitectureGetInstanceOutput,
  ArchitectureGetResourceOutput,
  ArchitecturePatchInstanceInput,
} from "@opencode-ai/client/promise"
import type { Direction } from "@/context/language"
import type { ArchitectureCommandAction } from "./commands"
import type { ArchitectureConflict } from "./journal"

export type ArchitectureSnapshot = ArchitectureGetResourceOutput["data"]
export type ArchitectureResource = ArchitectureSnapshot["resource"]
export type ArchitectureNode = ArchitectureResource["nodes"][number]
export type ArchitectureEdge = ArchitectureResource["edges"][number]
export type ArchitectureConnectionSide = NonNullable<ArchitectureEdge["sourceHandle"]>
export type ArchitectureOperation = ArchitecturePatchInstanceInput["operations"][number]
export type ArchitectureViewport = { readonly x: number; readonly y: number; readonly zoom: number }
export type ArchitectureEdgeStyle = "rectangular" | "curved" | "straight"

export type ArchitectureInstanceSnapshot = ArchitectureGetInstanceOutput["data"]
export type ArchitectureLiveInstance = Omit<ArchitectureInstanceSnapshot, "source"> & { readonly source: "live" }
export type ArchitectureLiveInstanceCache = ArchitectureLiveInstance | null

// Transient editor-local pending overlay. The backend live instance is the
// normal graph instance; these operations only bridge unacknowledged local UI
// edits plus crash/undo recovery.
export type ArchitecturePendingOverlay = {
  readonly base: ArchitectureSnapshot
  readonly origin?: ArchitectureSnapshot
  readonly journalBase?: ArchitectureResource
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
  readonly instance?: ArchitectureLiveInstance
}

export type ArchitectureRuntimeDirtyReason = "pending-operations" | "pending-conflicts" | "live-instance"
export type ArchitectureRuntimeSyncStatus =
  | "unselected"
  | "loading"
  | "clean"
  | "live-instance"
  | "local-pending"
  | "conflicted"
  | "pending-covered"
export type ArchitectureRuntimeDebugEventType = "journal" | "sync" | "server-event" | "save" | "reload" | "canvas-source"
export type ArchitectureRuntimeDebugEventStatus = "recorded" | "received" | "started" | "succeeded" | "failed"

export type ArchitectureRuntimeDebugEvent = {
  readonly id: string
  readonly type: ArchitectureRuntimeDebugEventType
  readonly status: ArchitectureRuntimeDebugEventStatus
  readonly at: number
  readonly resourceID: string
  readonly operationCount?: number
  readonly operationTypes?: ReadonlyArray<ArchitectureOperation["type"]>
  readonly conflictCount?: number
  readonly revision?: number
  readonly digest?: string
  readonly details?: ReadonlyArray<{ readonly key: string; readonly value: string | number | boolean }>
}

export type ArchitectureConflictExplanation = {
  readonly operationID: string
  readonly operationType: ArchitectureOperation["type"]
  readonly reason: ArchitectureConflict["reason"]
  readonly target: {
    readonly kind: "resource" | "tag" | "node" | "edge"
    readonly id?: string
  }
}

export type ArchitectureRuntimeView = {
  readonly selectedResourceID?: string
  readonly snapshot?: ArchitectureSnapshot
  readonly visibleSnapshot?: ArchitectureSnapshot
  readonly pending?: ArchitecturePendingOverlay
  readonly pendingCovered: boolean
  readonly visibleResource?: ArchitectureResource
  readonly dirty: boolean
  readonly dirtyReasons: ReadonlyArray<ArchitectureRuntimeDirtyReason>
  readonly operationCount: number
  readonly conflictCount: number
  readonly hasLiveInstance: boolean
  readonly savedRevision?: number
  readonly savedDigest?: string
  readonly visibleRevision?: number
  readonly visibleDigest?: string
  readonly syncStatus: ArchitectureRuntimeSyncStatus
  readonly conflictExplanations: ReadonlyArray<ArchitectureConflictExplanation>
  readonly debugEvents: ReadonlyArray<ArchitectureRuntimeDebugEvent>
}

export type ArchitectureInstanceChange = {
  readonly server: string
  readonly directory: string
  readonly base: ArchitectureSnapshot
  readonly origin: ArchitectureSnapshot
  readonly resource: ArchitectureResource
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
}

export type ArchitectureViewportChange = {
  readonly server: string
  readonly directory: string
  readonly resourceID: string
  readonly viewport: ArchitectureViewport
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
  readonly defaultNodeText: string
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
  readonly conflictExplanation: (explanation: ArchitectureConflictExplanation) => string
  readonly debug: {
    readonly title: string
    readonly resourceID: string
    readonly dirty: string
    readonly dirtyReasons: string
    readonly syncStatus: string
    readonly pendingOperations: string
    readonly conflicts: string
    readonly liveInstance: string
    readonly savedRevision: string
    readonly savedDigest: string
    readonly visibleRevision: string
    readonly visibleDigest: string
    readonly yes: string
    readonly no: string
    readonly none: string
    readonly statuses: Record<ArchitectureRuntimeSyncStatus, string>
    readonly reasons: Record<ArchitectureRuntimeDirtyReason, string>
    readonly activity: string
    readonly noActivity: string
    readonly eventTypes: Record<ArchitectureRuntimeDebugEventType, string>
    readonly eventStatuses: Record<ArchitectureRuntimeDebugEventStatus, string>
    readonly operationTypes: Record<ArchitectureOperation["type"], string>
    readonly eventOperations: (operations: string) => string
  }
}

export type ArchitecturePanelProps = {
  readonly server: string
  readonly directory: string
  readonly direction: Direction
  readonly mobile: boolean
  readonly snapshot: ArchitectureSnapshot
  readonly runtimeView: ArchitectureRuntimeView
  readonly liveInstanceVersion: number
  readonly pending?: ArchitecturePendingOverlay
  readonly viewport?: ArchitectureViewport
  readonly busy: boolean
  readonly action?: ArchitectureCommandAction
  readonly labels: ArchitectureLabels
  readonly onJournal: (change: ArchitectureInstanceChange) => void
  readonly onViewport: (change: ArchitectureViewportChange) => void
  readonly onSave: (change: ArchitectureInstanceChange) => void
  readonly onDuplicate: (change: ArchitectureInstanceChange) => void
  readonly onAskSelection?: (input: ArchitectureSelectionPrompt) => void
  readonly onReload: () => void
  readonly onExport: (operations: ReadonlyArray<ArchitectureOperation>) => void
  readonly onExportResource: (resource: ArchitectureResource) => void
  readonly onCanvasSourceDebug?: (event: ArchitectureRuntimeDebugEvent) => void
  readonly onConfirm: (message: string, confirmLabel: string, action: () => void) => void
}
