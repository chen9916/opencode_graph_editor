import type {
  ArchitectureInstanceChange,
  ArchitectureOperation,
  ArchitectureRuntimeDebugEvent,
  ArchitectureRuntimeDebugEventStatus,
  ArchitectureRuntimeDebugEventType,
  ArchitectureSnapshot,
} from "./contract"
import type { ArchitectureResourceEventInfo, ArchitectureResourceInstanceEventInfo } from "./event"
import { architectureInstanceResourceID } from "./resource-state"

export function createArchitectureRuntimeDebugEvent(input: {
  readonly resourceID: string
  readonly type: ArchitectureRuntimeDebugEventType
  readonly status: ArchitectureRuntimeDebugEventStatus
  readonly operationCount?: number
  readonly operationTypes?: ReadonlyArray<ArchitectureOperation["type"]>
  readonly conflictCount?: number
  readonly revision?: number
  readonly digest?: string
  readonly now?: number
  readonly unique?: string
}): ArchitectureRuntimeDebugEvent {
  const at = input.now ?? Date.now()
  const unique = input.unique ?? Math.random().toString(36).slice(2, 8)
  return {
    id: `${at.toString(36)}_${unique}`,
    at,
    resourceID: input.resourceID,
    type: input.type,
    status: input.status,
    ...(input.operationCount === undefined ? {} : { operationCount: input.operationCount }),
    ...(input.operationTypes === undefined ? {} : { operationTypes: input.operationTypes }),
    ...(input.conflictCount === undefined ? {} : { conflictCount: input.conflictCount }),
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    ...(input.digest === undefined ? {} : { digest: input.digest }),
  }
}

export function prependArchitectureRuntimeDebugEvent(
  current: ReadonlyArray<ArchitectureRuntimeDebugEvent> | undefined,
  event: ArchitectureRuntimeDebugEvent,
  limit = 8,
) {
  return [event, ...(current ?? [])].slice(0, limit)
}

export function architectureJournalDebugEvent(change: ArchitectureInstanceChange) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: architectureInstanceResourceID(change),
    type: "journal",
    status: "recorded",
    operationCount: change.operations.length,
    operationTypes: operationTypes(change.operations),
    conflictCount: change.conflicts.length,
    revision: change.resource.revision,
  })
}

export function architectureSaveStartedDebugEvent(change: ArchitectureInstanceChange) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: architectureInstanceResourceID(change),
    type: "save",
    status: "started",
    operationCount: change.operations.length,
    operationTypes: operationTypes(change.operations),
    conflictCount: change.conflicts.length,
    revision: change.resource.revision,
  })
}

export function architectureSnapshotDebugEvent(input: {
  readonly resourceID: string
  readonly type: "save" | "reload" | "sync"
  readonly status: Extract<ArchitectureRuntimeDebugEventStatus, "received" | "succeeded">
  readonly snapshot: ArchitectureSnapshot
}) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: input.resourceID,
    type: input.type,
    status: input.status,
    revision: input.snapshot.resource.revision,
    digest: input.snapshot.digest,
  })
}

export function architectureFailedDebugEvent(input: {
  readonly resourceID: string
  readonly type: "save" | "reload"
}) {
  return createArchitectureRuntimeDebugEvent({ resourceID: input.resourceID, type: input.type, status: "failed" })
}

export function architectureReloadStartedDebugEvent(resourceID: string) {
  return createArchitectureRuntimeDebugEvent({ resourceID, type: "reload", status: "started" })
}

export function architectureResourceServerDebugEvent(
  event: ArchitectureResourceEventInfo | ArchitectureResourceInstanceEventInfo,
) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: event.resourceID,
    type: "server-event",
    status: "received",
    revision: event.revision,
    digest: event.digest,
  })
}

function operationTypes(operations: ReadonlyArray<ArchitectureOperation>) {
  return Array.from(new Set(operations.map((operation) => operation.type)))
}
