import type {
  ArchitectureDraftSnapshot,
  ArchitectureLiveDraft,
  ArchitectureLiveDraftCache,
  ArchitectureOperation,
  ArchitectureResource,
  ArchitectureSnapshot,
} from "./contract"
import { applyOperations, operationID, rebaseOperations } from "./journal"

export class ArchitectureDraftSynchronizationCancelled extends Error {
  readonly _tag = "ArchitectureDraftSynchronizationCancelled"

  constructor() {
    super("Architecture draft synchronization was invalidated")
    this.name = "ArchitectureDraftSynchronizationCancelled"
  }
}

export function architectureLiveDraftCache(draft: ArchitectureDraftSnapshot): ArchitectureLiveDraftCache {
  if (draft.source === "live") return { ...draft, source: "live" }
  return null
}

export function sameArchitectureResource(left: ArchitectureResource, right: ArchitectureResource) {
  return canonical(left) === canonical(right)
}

export function rebaseArchitectureDraft(
  origin: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
  live: ArchitectureResource,
) {
  const local = applyOperations(origin, operations)
  const base = {
    ...live,
    name: mergeValue(origin.name, local.name, live.name)!,
    nodes: mergeEntities(origin.nodes, local.nodes, live.nodes),
    edges: mergeEntities(origin.edges, local.edges, live.edges),
  }
  const tagColors = mergeTagColors(origin.tagColors, local.tagColors, live.tagColors)
  const merged = Object.keys(tagColors).length > 0 ? { ...base, tagColors } : base
  const rebased = rebaseOperations(origin, merged, operations)
  return {
    base: merged,
    operations: rebased.operations,
    conflicts: rebased.conflicts,
  }
}

export function reconcileArchitectureDraft(current: ArchitectureResource, target: ArchitectureResource) {
  const removedNodeIDs = new Set(
    current.nodes.filter((node) => !target.nodes.some((candidate) => candidate.id === node.id)).map((node) => node.id),
  )
  const tags = new Set([...Object.keys(current.tagColors ?? {}), ...Object.keys(target.tagColors ?? {})])
  return [
    ...(current.name === target.name
      ? []
      : [{ id: operationID(), type: "resource.update" as const, name: target.name }]),
    ...Array.from(tags).flatMap((tag): ArchitectureOperation[] => {
      if (current.tagColors?.[tag] === target.tagColors?.[tag]) return []
      return [{ id: operationID(), type: "tag.color", tag, color: target.tagColors?.[tag] }]
    }),
    ...current.nodes.flatMap((node): ArchitectureOperation[] => {
      if (!removedNodeIDs.has(node.id)) return []
      return [{ id: operationID(), type: "node.remove", nodeID: node.id, cascade: true }]
    }),
    ...target.nodes.flatMap((node): ArchitectureOperation[] => {
      const existing = current.nodes.find((candidate) => candidate.id === node.id)
      if (!existing) return [{ id: operationID(), type: "node.create", node }]
      if (canonical(existing) === canonical(node)) return []
      return [{ id: operationID(), type: "node.update", node }]
    }),
    ...current.edges.flatMap((edge): ArchitectureOperation[] => {
      if (removedNodeIDs.has(edge.source) || removedNodeIDs.has(edge.target)) return []
      if (target.edges.some((candidate) => candidate.id === edge.id)) return []
      return [{ id: operationID(), type: "edge.remove", edgeID: edge.id }]
    }),
    ...target.edges.flatMap((edge): ArchitectureOperation[] => {
      const existing = current.edges.find((candidate) => candidate.id === edge.id)
      if (!existing) return [{ id: operationID(), type: "edge.create", edge }]
      if (canonical(existing) === canonical(edge)) return []
      return [{ id: operationID(), type: "edge.update", edge }]
    }),
  ]
}

export function createArchitectureDraftSynchronizer(input: {
  readonly patch: (
    base: ArchitectureSnapshot,
    operations: ReadonlyArray<ArchitectureOperation>,
  ) => Promise<ArchitectureLiveDraftCache>
  readonly update: (draft: ArchitectureLiveDraft) => void
}) {
  let generation = 0
  let latest: ArchitectureSnapshot | undefined
  let tail: Promise<unknown> = Promise.resolve()

  const synchronize = (base: ArchitectureSnapshot, target: ArchitectureResource) => {
    const admitted = generation
    const task = tail.then(async () => {
      if (admitted !== generation) return
      const current = latest ?? base
      const operations = reconcileArchitectureDraft(current.resource, target)
      if (operations.length === 0) {
        latest = current
        return
      }
      const updated = await input.patch(current, operations)
      if (!updated) throw new Error("Architecture draft patch did not return a live draft")
      if (admitted !== generation) return
      latest = updated.snapshot
      input.update(updated)
    })
    tail = task.catch(() => undefined)
    return task
  }

  const synchronizeAuthoritative = (
    observe: () => Promise<ArchitectureDraftSnapshot>,
    target: ArchitectureResource,
  ) => {
    const admitted = generation
    const task = tail.then(async () => {
      if (admitted !== generation) throw new ArchitectureDraftSynchronizationCancelled()
      const observed = await observe()
      if (admitted !== generation) throw new ArchitectureDraftSynchronizationCancelled()
      const operations = reconcileArchitectureDraft(observed.snapshot.resource, target)
      if (operations.length === 0 && observed.source === "live") {
        latest = observed.snapshot
        return observed.snapshot
      }
      const updated = await input.patch(observed.snapshot, operations)
      if (!updated) throw new Error("Architecture draft patch did not return a live draft")
      if (admitted !== generation) throw new ArchitectureDraftSynchronizationCancelled()
      latest = updated.snapshot
      input.update(updated)
      return updated.snapshot
    })
    tail = task.catch(() => undefined)
    return task
  }

  const invalidate = async () => {
    generation += 1
    latest = undefined
    await tail
  }

  return { synchronize, synchronizeAuthoritative, invalidate }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`
}

function mergeEntities<T extends { readonly id: string }>(
  origin: ReadonlyArray<T>,
  local: ReadonlyArray<T>,
  live: ReadonlyArray<T>,
) {
  const ids = [...live.map((item) => item.id), ...origin.map((item) => item.id)].filter(
    (id, index, all) => all.indexOf(id) === index,
  )
  return ids.flatMap((id) => {
    const before = origin.find((item) => item.id === id)
    const target = local.find((item) => item.id === id)
    const remote = live.find((item) => item.id === id)
    const value = mergeValue(before, target, remote)
    return value === undefined ? [] : [value]
  })
}

function mergeTagColors(
  origin: ArchitectureResource["tagColors"],
  local: ArchitectureResource["tagColors"],
  live: ArchitectureResource["tagColors"],
) {
  const tags = [...Object.keys(origin ?? {}), ...Object.keys(live ?? {})].filter(
    (tag, index, all) => all.indexOf(tag) === index,
  )
  return Object.fromEntries(
    tags.flatMap((tag) => {
      const value = mergeValue(origin?.[tag], local?.[tag], live?.[tag])
      return value === undefined ? [] : [[tag, value]]
    }),
  )
}

function mergeValue<T>(origin: T | undefined, local: T | undefined, live: T | undefined) {
  if (canonical(origin) === canonical(local)) return live
  if (canonical(live) === canonical(local) || canonical(live) === canonical(origin)) return origin
  return live
}
