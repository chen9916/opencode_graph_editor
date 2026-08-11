import type {
  ArchitectureLiveInstanceCache,
  ArchitecturePendingOverlay,
  ArchitectureRuntimeDirtyReason,
  ArchitectureRuntimeSyncStatus,
  ArchitectureRuntimeView,
  ArchitectureSnapshot,
} from "./contract"
import { architectureInstanceIsDirty, architectureVisibleLiveInstance, selectedArchitectureSnapshot } from "./resource-state"

export function architectureRuntimeView(input: {
  readonly selectedResourceID: string | undefined
  readonly saved: ArchitectureSnapshot | undefined
  readonly live: ArchitectureLiveInstanceCache | undefined
  readonly pending: ArchitecturePendingOverlay | undefined
}): ArchitectureRuntimeView {
  const snapshot = selectedArchitectureSnapshot(input.selectedResourceID, input.saved)
  const live = selectedArchitectureLiveInstance(input.selectedResourceID, input.live)
  const visible = architectureVisibleLiveInstance({ saved: snapshot, live, pending: input.pending })
  const operationCount = visible.pending?.operations.length ?? 0
  const conflictCount = visible.pending?.conflicts.length ?? 0
  const hasLiveInstance = !!live || !!visible.pending?.instance
  const dirty = architectureInstanceIsDirty({ pending: visible.pending })
  return {
    selectedResourceID: input.selectedResourceID,
    snapshot,
    visibleSnapshot: visible.snapshot,
    pending: visible.pending,
    pendingCovered: visible.pendingCovered,
    visibleResource: visible.snapshot?.resource,
    dirty,
    dirtyReasons: dirtyReasons({ operationCount, conflictCount, hasLiveInstance }),
    operationCount,
    conflictCount,
    hasLiveInstance,
    savedRevision: snapshot?.resource.revision,
    savedDigest: snapshot?.digest,
    visibleRevision: visible.snapshot?.resource.revision,
    visibleDigest: visible.snapshot?.digest,
    syncStatus: syncStatus({
      selectedResourceID: input.selectedResourceID,
      visible,
      operationCount,
      conflictCount,
      hasLiveInstance,
    }),
    debugEvents: [],
  }
}

function selectedArchitectureLiveInstance(
  selectedResourceID: string | undefined,
  live: ArchitectureLiveInstanceCache | undefined,
) {
  if (!selectedResourceID || !live) return undefined
  if (live.snapshot.resource.id !== selectedResourceID) return undefined
  return live
}

function dirtyReasons(input: {
  readonly operationCount: number
  readonly conflictCount: number
  readonly hasLiveInstance: boolean
}): ReadonlyArray<ArchitectureRuntimeDirtyReason> {
  return [
    ...(input.operationCount > 0 ? (["pending-operations"] as const) : []),
    ...(input.conflictCount > 0 ? (["pending-conflicts"] as const) : []),
    ...(input.hasLiveInstance ? (["live-instance"] as const) : []),
  ]
}

function syncStatus(input: {
  readonly selectedResourceID: string | undefined
  readonly visible: ReturnType<typeof architectureVisibleLiveInstance>
  readonly operationCount: number
  readonly conflictCount: number
  readonly hasLiveInstance: boolean
}): ArchitectureRuntimeSyncStatus {
  if (!input.selectedResourceID) return "unselected"
  if (!input.visible.snapshot) return "loading"
  if (input.visible.pendingCovered) return "pending-covered"
  if (input.conflictCount > 0) return "conflicted"
  if (input.operationCount > 0) return "local-pending"
  if (input.hasLiveInstance) return "live-instance"
  return "clean"
}
