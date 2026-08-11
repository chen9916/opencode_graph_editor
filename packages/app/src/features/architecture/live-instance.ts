import type {
  ArchitectureInstanceSnapshot,
  ArchitectureLiveInstance,
  ArchitectureLiveInstanceCache,
  ArchitectureOperation,
  ArchitectureResource,
  ArchitectureSnapshot,
} from "./contract"
import { applyOperations, operationID, rebaseOperations } from "./journal"

export class ArchitectureInstanceSynchronizationCancelled extends Error {
  readonly _tag = "ArchitectureInstanceSynchronizationCancelled"

  constructor() {
    super("Architecture instance synchronization was invalidated")
    this.name = "ArchitectureInstanceSynchronizationCancelled"
  }
}

export function architectureLiveInstanceCache(instance: ArchitectureInstanceSnapshot): ArchitectureLiveInstanceCache {
  if (instance.source === "live") return { ...instance, source: "live" }
  return null
}

export function latestArchitectureLiveInstanceCache(
  current: ArchitectureLiveInstanceCache | undefined,
  candidate: ArchitectureLiveInstanceCache,
) {
  // An explicit discard from save/reload must clear the visible live instance.
  if (candidate === null) return null
  if (!candidate) return current ?? candidate
  if (current?.snapshot.resource.id !== candidate.snapshot.resource.id) return candidate
  if (current.snapshot.resource.revision > candidate.snapshot.resource.revision) return current
  if (current.snapshot.resource.revision === candidate.snapshot.resource.revision) return current
  return candidate
}

export function adoptArchitectureLiveInstanceCache(
  current: ArchitectureLiveInstanceCache | undefined,
  candidate: ArchitectureLiveInstanceCache,
) {
  if (!candidate) return candidate
  if (
    current?.snapshot.resource.id === candidate.snapshot.resource.id &&
    current.snapshot.resource.revision > candidate.snapshot.resource.revision
  )
    return current
  return candidate
}

export function discardSavedArchitectureLiveInstanceCache(
  current: ArchitectureLiveInstanceCache | undefined,
  saved: ArchitectureSnapshot,
) {
  if (!current) return null
  if (current.snapshot.resource.id !== saved.resource.id) return current
  if (current.snapshot.resource.revision < saved.resource.revision) return null
  if (current.snapshot.resource.revision === saved.resource.revision && current.snapshot.digest === saved.digest)
    return null
  return current
}

export function sameArchitectureResource(left: ArchitectureResource, right: ArchitectureResource) {
  return canonical(left) === canonical(right)
}

export function rebaseArchitecturePendingOverlay(
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

export function reconcileArchitectureInstanceChange(current: ArchitectureResource, target: ArchitectureResource) {
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

export function createArchitectureInstanceSynchronizer(input: {
  readonly patch: (
    base: ArchitectureSnapshot,
    operations: ReadonlyArray<ArchitectureOperation>,
  ) => Promise<ArchitectureLiveInstanceCache>
  readonly update: (instance: ArchitectureLiveInstanceCache) => void
  readonly adopt?: (instance: ArchitectureLiveInstanceCache) => void
}) {
  let generation = 0
  let latest: ArchitectureSnapshot | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const mutations = new Set<Promise<unknown>>()

  const patch = (base: ArchitectureSnapshot, operations: ReadonlyArray<ArchitectureOperation>) => {
    const task = input.patch(base, operations)
    const tracked = task.catch(() => undefined)
    mutations.add(tracked)
    void tracked.then(() => mutations.delete(tracked))
    return task
  }

  const synchronize = (base: ArchitectureSnapshot, target: ArchitectureResource) => {
    const admitted = generation
    const task = tail.then(async () => {
      if (admitted !== generation) return
      const current = latest?.resource.id === target.id ? latest : base
      const operations = reconcileArchitectureInstanceChange(current.resource, target)
      if (operations.length === 0) {
        latest = current
        return
      }
      const updated = await patch(current, operations)
      if (!updated) throw new Error("Architecture instance patch did not return a live instance")
      if (admitted !== generation) return
      latest = updated.snapshot
      input.update(updated)
    })
    tail = task.catch(() => undefined)
    return task
  }

  const synchronizeAuthoritative = (
    observe: () => Promise<ArchitectureInstanceSnapshot>,
    target: ArchitectureResource | ((observed: ArchitectureInstanceSnapshot) => ArchitectureResource),
  ) => {
    const admitted = generation
    const task = tail.then(async () => {
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      const observed = await observe()
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      latest = observed.snapshot
      const desired = typeof target === "function" ? target(observed) : target
      const operations = reconcileArchitectureInstanceChange(observed.snapshot.resource, desired)
      if (operations.length === 0 && observed.source === "live") {
        latest = observed.snapshot
        return observed.snapshot
      }
      const updated = await patch(observed.snapshot, operations)
      if (!updated) throw new Error("Architecture instance patch did not return a live instance")
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      latest = updated.snapshot
      updateAuthoritative(updated)
      return updated.snapshot
    })
    tail = task.catch(() => undefined)
    return task
  }

  const adopt = (instance: ArchitectureLiveInstanceCache) => {
    const admitted = generation
    const task = tail.then(() => {
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      latest = instance?.snapshot
      updateAuthoritative(instance)
      return instance
    })
    tail = task.catch(() => undefined)
    return task
  }

  const adoptSnapshot = (observe: () => Promise<ArchitectureInstanceSnapshot>) => {
    const admitted = generation
    const task = tail.then(async () => {
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      const observed = await observe()
      if (admitted !== generation) throw new ArchitectureInstanceSynchronizationCancelled()
      latest = observed.snapshot
      const instance = architectureLiveInstanceCache(observed)
      updateAuthoritative(instance)
      return instance
    })
    tail = task.catch(() => undefined)
    return task
  }

  const invalidate = async () => {
    generation += 1
    latest = undefined
    tail = Promise.all(Array.from(mutations))
    await tail
  }

  const updateAuthoritative = (instance: ArchitectureLiveInstanceCache) => (input.adopt ?? input.update)(instance)

  return { synchronize, synchronizeAuthoritative, adopt, adoptSnapshot, invalidate }
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
