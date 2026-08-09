import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ArchitectureDraftChange, ArchitectureSnapshot } from "./contract"
import { architectureSnapshotCoversEvent, type ArchitectureResourceEventInfo } from "./event"

export function resolveArchitectureResourceID(
  selectedID: string | undefined,
  resources: ArchitectureListResourcesOutput["data"] | undefined,
) {
  return selectedID ?? resources?.[0]?.id
}

export function architectureDraftResourceID(change: ArchitectureDraftChange) {
  return change.resource.id
}

export function architectureResourceSummary(
  snapshot: ArchitectureSnapshot,
): ArchitectureListResourcesOutput["data"][number] {
  return {
    id: snapshot.resource.id,
    name: snapshot.resource.name,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
    nodes: snapshot.resource.nodes.length,
    edges: snapshot.resource.edges.length,
  }
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
  summary: ArchitectureListResourcesOutput["data"][number],
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
