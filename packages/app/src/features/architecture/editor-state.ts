import type { ArchitectureInstanceChange, ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import type { ArchitectureConflict } from "./journal"
import { applyOperations, flattenJournal } from "./journal"
import { reconcileArchitectureInstanceChange, sameArchitectureResource } from "./live-instance"

export type ArchitectureEditorHistoryEntry = {
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly before: ArchitectureResource
  readonly after: ArchitectureResource
}

export type ArchitectureEditorHistory = {
  readonly source: ArchitectureResource
  readonly resource: ArchitectureResource
  readonly past: ReadonlyArray<ArchitectureEditorHistoryEntry>
  readonly future: ReadonlyArray<ArchitectureEditorHistoryEntry>
  readonly pending: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
}

export function architectureEditorLiveInstanceKey(input: {
  readonly base: ArchitectureSnapshot
  readonly liveInstanceVersion: number
}) {
  return `${input.base.resource.id}:${input.base.digest}:${input.liveInstanceVersion}`
}

export function createArchitectureEditorHistory(
  source: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
): ArchitectureEditorHistory {
  return operations.reduce<ArchitectureEditorHistory>(
    (history, operation) => commitLoadedArchitectureEditorHistory(history, [operation]),
    { source, resource: source, past: [], future: [], pending: [] },
  )
}

export function syncArchitectureEditorHistorySource(
  history: ArchitectureEditorHistory,
  source: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
) {
  const next = createArchitectureEditorHistory(source, operations)
  if (!sameArchitectureResource(history.resource, next.resource)) {
    if (
      history.future.some(
        (entry) =>
          sameArchitectureResource(history.resource, entry.before) &&
          sameArchitectureResource(next.resource, entry.after),
      )
    )
      return { ...history, source, pending: pendingBatches(source, history.resource) }
    return next
  }
  return {
    ...history,
    source,
    resource: next.resource,
    pending: pendingBatches(source, next.resource),
  }
}

export function commitArchitectureEditorHistory(
  history: ArchitectureEditorHistory,
  operations: ReadonlyArray<ArchitectureOperation>,
) {
  if (operations.length === 0) return history
  const resource = applyOperations(history.resource, operations)
  return {
    source: history.source,
    resource,
    past: [...history.past, { operations, before: history.resource, after: resource }],
    future: [],
    pending: pendingBatches(history.source, resource),
  }
}

export function undoArchitectureEditorHistory(history: ArchitectureEditorHistory) {
  const batch = history.past.at(-1)
  if (!batch) return history
  return {
    source: history.source,
    resource: batch.before,
    past: history.past.slice(0, -1),
    future: [batch, ...history.future],
    pending: pendingBatches(history.source, batch.before),
  }
}

export function redoArchitectureEditorHistory(history: ArchitectureEditorHistory) {
  const batch = history.future[0]
  if (!batch) return history
  return {
    source: history.source,
    resource: batch.after,
    past: [...history.past, batch],
    future: history.future.slice(1),
    pending: pendingBatches(history.source, batch.after),
  }
}

export function architectureEditorPendingOperations(history: ArchitectureEditorHistory) {
  return flattenJournal(history.pending)
}

export function architectureInstanceChange(
  resource: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
  base: ArchitectureSnapshot,
  origin: ArchitectureSnapshot,
  conflicts: ReadonlyArray<ArchitectureConflict>,
  server: string,
  directory: string,
): ArchitectureInstanceChange {
  return { server, directory, base, origin, resource, operations, conflicts }
}

function commitLoadedArchitectureEditorHistory(
  history: ArchitectureEditorHistory,
  operations: ReadonlyArray<ArchitectureOperation>,
): ArchitectureEditorHistory {
  const resource = applyOperations(history.resource, operations)
  return {
    source: history.source,
    resource,
    past: [...history.past, { operations, before: history.resource, after: resource }],
    future: [],
    pending: [...history.pending, operations],
  }
}

function pendingBatches(source: ArchitectureResource, resource: ArchitectureResource) {
  const operations = reconcileArchitectureInstanceChange(source, resource)
  return operations.length > 0 ? [operations] : []
}
