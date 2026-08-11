import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type {
  ArchitectureInstanceChange,
  ArchitectureLiveInstanceCache,
  ArchitectureOperation,
  ArchitecturePendingOverlay,
  ArchitectureSnapshot,
} from "./contract"
import type { ArchitectureConflict } from "./journal"
import { applyOperations } from "./journal"
import {
  architectureSnapshotCoversEvent,
  type ArchitectureResourceEventInfo,
} from "./event"
import { reconcileArchitectureInstanceChange, rebaseArchitecturePendingOverlay } from "./live-instance"

export type ArchitectureResourceSummary = ArchitectureListResourcesOutput["data"][number]

export function resolveArchitectureResourceID(
  selectedID: string | undefined,
  resources: ArchitectureListResourcesOutput["data"] | undefined,
) {
  return selectedID ?? resources?.[0]?.id
}

export function missingSelectedArchitectureResourceID(input: {
  readonly selectedID: string | undefined
  readonly resources: ArchitectureListResourcesOutput["data"] | undefined
  readonly snapshot: ArchitectureSnapshot | undefined
  readonly resourceError: unknown
}) {
  if (!input.selectedID || !input.resourceError || !input.resources) return
  if (input.snapshot?.resource.id === input.selectedID) return
  if (input.resources.some((resource) => resource.id === input.selectedID)) return
  return input.selectedID
}

export function selectedArchitectureSnapshot(
  resourceID: string | undefined,
  snapshot: ArchitectureSnapshot | undefined,
) {
  if (!resourceID || snapshot?.resource.id !== resourceID) return undefined
  return snapshot
}

export function architectureVisibleLiveInstance(input: {
  readonly saved: ArchitectureSnapshot | undefined
  readonly live: ArchitectureLiveInstanceCache | undefined
  readonly pending: ArchitecturePendingOverlay | undefined
}) {
  const source = input.live?.snapshot ?? input.saved
  if (!source) return { snapshot: undefined, pending: undefined, pendingCovered: false }
  if (!input.pending)
    return {
      snapshot: source,
      pending: input.live ? liveInstancePendingOverlay(source, input.live) : undefined,
      pendingCovered: false,
    }
  const rebased = rebaseArchitecturePendingOverlay(
    input.pending.journalBase ?? (input.pending.origin ?? input.pending.base).resource,
    input.pending.operations,
    source.resource,
  )
  const operations = reconcileArchitectureInstanceChange(source.resource, applyOperations(rebased.base, rebased.operations))
  const conflicts = [...input.pending.conflicts, ...rebased.conflicts]
  const covered = operations.length === 0 && conflicts.length === 0
  if (covered)
    return {
      snapshot: source,
      pending: input.live ? liveInstancePendingOverlay(source, input.live) : undefined,
      pendingCovered: true,
    }
  return {
    snapshot: source,
    pending: {
      base: source,
      origin: source,
      journalBase: source.resource,
      operations,
      conflicts,
      instance: input.live ?? undefined,
    },
    pendingCovered: false,
  }
}

export function architectureInstanceResourceID(change: ArchitectureInstanceChange) {
  return change.resource.id
}

export function architectureInstanceHasVisibleChanges(change: ArchitectureInstanceChange) {
  return change.operations.length > 0
}

function liveInstancePendingOverlay(
  snapshot: ArchitectureSnapshot,
  instance: NonNullable<ArchitectureLiveInstanceCache>,
): ArchitecturePendingOverlay {
  return {
    base: snapshot,
    origin: snapshot,
    journalBase: snapshot.resource,
    operations: [],
    conflicts: [],
    instance,
  }
}

export function architectureInstanceCanSkipSave(change: ArchitectureInstanceChange) {
  return !architectureInstanceHasVisibleChanges(change) && change.conflicts.length === 0
}

export function architectureInstanceIsDirty(input: {
  readonly pending:
    | {
        readonly operations?: ReadonlyArray<ArchitectureOperation>
        readonly conflicts?: ReadonlyArray<ArchitectureConflict>
        readonly instance?: unknown
      }
    | undefined
  readonly operations?: ReadonlyArray<ArchitectureOperation>
}) {
  return (
    !!input.pending?.instance ||
    (input.operations ?? input.pending?.operations ?? []).length > 0 ||
    (input.pending?.conflicts?.length ?? 0) > 0
  )
}

export function architectureResourceSummary(
  snapshot: ArchitectureSnapshot,
): ArchitectureResourceSummary {
  return {
    id: snapshot.resource.id,
    name: snapshot.resource.name,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
    nodes: snapshot.resource.nodes.length,
    edges: snapshot.resource.edges.length,
  }
}

export function architectureResourceSelectionOptions(
  resources: ArchitectureListResourcesOutput["data"] | undefined,
  snapshot: ArchitectureSnapshot | undefined,
) {
  if (!snapshot) return [...(resources ?? [])]
  return updateArchitectureResourceSummaries(resources, architectureResourceSummary(snapshot))
}

export function selectedArchitectureResourceSummary(
  resourceID: string | undefined,
  resources: ArchitectureListResourcesOutput["data"] | undefined,
  snapshot?: ArchitectureSnapshot,
) {
  return architectureResourceSelectionOptions(resources, snapshot).find((resource) => resource.id === resourceID)
}

export function resolveArchitectureResourceSelection(input: {
  readonly currentID: string | undefined
  readonly selectedID: string | undefined
  readonly committed: boolean
}) {
  if (!input.committed || !input.selectedID) return input.currentID
  return input.selectedID
}

export function latestArchitectureSnapshot(
  current: ArchitectureSnapshot | undefined,
  candidate: ArchitectureSnapshot,
): ArchitectureSnapshot
export function latestArchitectureSnapshot(
  current: ArchitectureSnapshot | undefined,
  candidate: ArchitectureSnapshot | undefined,
): ArchitectureSnapshot | undefined
export function latestArchitectureSnapshot(
  current: ArchitectureSnapshot | undefined,
  candidate: ArchitectureSnapshot | undefined,
) {
  if (!candidate) return candidate
  if (current?.resource.id === candidate.resource.id && current.resource.revision > candidate.resource.revision)
    return current
  return candidate
}

export function updateArchitectureResourceSummaries(
  current: ArchitectureListResourcesOutput["data"] | undefined,
  summary: ArchitectureResourceSummary,
) {
  const list = current ?? []
  const next = list.some((item) => item.id === summary.id)
    ? list.map((item) => (item.id === summary.id && item.revision <= summary.revision ? summary : item))
    : [...list, summary]
  return next.toSorted((left, right) => left.name.localeCompare(right.name))
}

export async function reconcileArchitectureSavedEvent(input: {
  readonly current: ArchitectureSnapshot | undefined
  readonly event: ArchitectureResourceEventInfo | undefined
  readonly observe: () => Promise<ArchitectureSnapshot>
}) {
  if (!input.event || architectureSnapshotCoversEvent(input.current, input.event))
    return { snapshot: undefined, invalidate: false }
  const observed = await input.observe().catch(() => undefined)
  const snapshot = observed ? latestArchitectureSnapshot(input.current, observed) : undefined
  return {
    snapshot,
    invalidate: !architectureSnapshotCoversEvent(snapshot ?? input.current, input.event),
  }
}
