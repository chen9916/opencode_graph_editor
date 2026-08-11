import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type {
  ArchitectureDraftChange,
  ArchitectureOperation,
  ArchitectureSnapshot,
} from "./contract"
import type { ArchitectureConflict } from "./journal"
import {
  architectureSnapshotCoversEvent,
  type ArchitectureResourceEventInfo,
} from "./event"

export type ArchitectureResourceSummary = ArchitectureListResourcesOutput["data"][number]

export function resolveArchitectureResourceID(
  selectedID: string | undefined,
  resources: ArchitectureListResourcesOutput["data"] | undefined,
) {
  return selectedID ?? resources?.[0]?.id
}

export function selectedArchitectureSnapshot(
  resourceID: string | undefined,
  snapshot: ArchitectureSnapshot | undefined,
) {
  if (!resourceID || snapshot?.resource.id !== resourceID) return undefined
  return snapshot
}

export function architectureDraftResourceID(change: ArchitectureDraftChange) {
  return change.resource.id
}

export function architectureDraftHasVisibleChanges(change: ArchitectureDraftChange) {
  return change.operations.length > 0
}

export function architectureDraftCanSkipSave(change: ArchitectureDraftChange) {
  return !architectureDraftHasVisibleChanges(change) && change.conflicts.length === 0
}

export function architectureDraftIsDirty(input: {
  readonly draft:
    | {
        readonly operations?: ReadonlyArray<ArchitectureOperation>
        readonly conflicts?: ReadonlyArray<ArchitectureConflict>
        readonly live?: unknown
      }
    | undefined
  readonly operations?: ReadonlyArray<ArchitectureOperation>
}) {
  return (
    !!input.draft?.live ||
    (input.operations ?? input.draft?.operations ?? []).length > 0 ||
    (input.draft?.conflicts?.length ?? 0) > 0
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
