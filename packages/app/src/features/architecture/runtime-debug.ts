import type {
  ArchitectureInstanceChange,
  ArchitectureOperation,
  ArchitectureRuntimeDebugEvent,
  ArchitectureRuntimeDebugEventStatus,
  ArchitectureRuntimeDebugEventType,
  ArchitectureSnapshot,
} from "./contract"
import type { ArchitectureCanvasSourceTransition } from "./canvas-source-sync"
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
  readonly details?: ArchitectureRuntimeDebugEvent["details"]
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
    ...(input.details === undefined ? {} : { details: input.details }),
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
  readonly details?: ArchitectureRuntimeDebugEvent["details"]
}) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: input.resourceID,
    type: input.type,
    status: input.status,
    revision: input.snapshot.resource.revision,
    digest: input.snapshot.digest,
    details: input.details,
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
    details:
      "action" in event
        ? details({
            action: event.action,
            baseRevision: event.baseRevision,
            baseDigest: event.baseDigest,
            instance: event.instance ? event.instance.source : undefined,
          })
        : undefined,
  })
}

export function architectureInstanceRefetchStartedDebugEvent(event: ArchitectureResourceInstanceEventInfo) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: event.resourceID,
    type: "sync",
    status: "started",
    revision: event.revision,
    digest: event.digest,
    details: details({
      action: event.action,
      baseRevision: event.baseRevision,
      baseDigest: event.baseDigest,
      reason: "metadata-only-instance-event",
    }),
  })
}

export function architectureInstanceRefetchFinishedDebugEvent(input: {
  readonly event: ArchitectureResourceInstanceEventInfo
  readonly status: Extract<ArchitectureRuntimeDebugEventStatus, "succeeded" | "failed">
  readonly revision?: number
  readonly digest?: string
  readonly source?: "live" | "saved"
  readonly reason?: string
}) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: input.event.resourceID,
    type: "sync",
    status: input.status,
    revision: input.revision ?? input.event.revision,
    digest: input.digest ?? input.event.digest,
    details: details({
      action: input.event.action,
      source: input.source,
      reason: input.reason,
      eventRevision: input.event.revision,
      eventDigest: input.event.digest,
      baseRevision: input.event.baseRevision,
      baseDigest: input.event.baseDigest,
    }),
  })
}

export function architectureSyncDecisionDebugEvent(input: {
  readonly resourceID: string
  readonly status?: Extract<ArchitectureRuntimeDebugEventStatus, "succeeded" | "failed">
  readonly revision?: number
  readonly digest?: string
  readonly details: Record<string, string | number | boolean | undefined>
}) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: input.resourceID,
    type: "sync",
    status: input.status ?? "succeeded",
    revision: input.revision,
    digest: input.digest,
    details: details(input.details),
  })
}

export function architectureCanvasSourceDebugEvent(transition: ArchitectureCanvasSourceTransition) {
  return createArchitectureRuntimeDebugEvent({
    resourceID: transition.resourceID,
    type: "canvas-source",
    status: "received",
    revision: transition.to.revision,
    digest: transition.to.digest,
    details: details({
      action: transition.action,
      source: transition.source,
      reason: transition.reason,
      resourceID: transition.resourceID,
      fromRevision: transition.from?.revision,
      fromDigest: transition.from?.digest,
      toRevision: transition.to.revision,
      toDigest: transition.to.digest,
    }),
  })
}

function operationTypes(operations: ReadonlyArray<ArchitectureOperation>) {
  return Array.from(new Set(operations.map((operation) => operation.type)))
}

function details(input: Record<string, string | number | boolean | undefined>) {
  const values = Object.entries(input).flatMap(([key, value]) => (value === undefined ? [] : [{ key, value }]))
  return values.length > 0 ? values : undefined
}
