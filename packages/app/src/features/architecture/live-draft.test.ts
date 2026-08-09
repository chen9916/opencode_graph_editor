import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type {
  ArchitectureDraftSnapshot,
  ArchitectureLiveDraft,
  ArchitectureOperation,
  ArchitectureResource,
  ArchitectureSnapshot,
} from "./contract"
import { applyOperations } from "./journal"
import {
  ArchitectureDraftSynchronizationCancelled,
  architectureLiveDraftCache,
  createArchitectureDraftSynchronizer,
  discardSavedArchitectureLiveDraftCache,
  latestArchitectureLiveDraftCache,
  rebaseArchitectureDraft,
  reconcileArchitectureDraft,
  sameArchitectureResource,
} from "./live-draft"

const resource = (text = "A"): ArchitectureResource => ({
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes: [{ id: "a", text, tags: [], layout: { position: { x: 0, y: 0 } } }],
  edges: [],
})

const snapshot = (value = resource(), digest = value.nodes[0]?.text ?? "empty"): ArchitectureSnapshot => ({
  digest,
  storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
  resource: value,
})

const live = (value: ArchitectureResource, digest?: string): ArchitectureLiveDraft => ({
  source: "live",
  snapshot: snapshot(value, digest),
})

describe("architecture live draft", () => {
  test("uses null as a stable cached representation after save", () => {
    const queryClient = new QueryClient()
    const key = ["architecture-resource-draft", "server", "/repo", "design"] as const
    queryClient.setQueryData(key, live(resource("draft")))

    queryClient.setQueryData(
      key,
      architectureLiveDraftCache({ source: "saved", snapshot: snapshot(resource("saved")) }),
    )

    expect(queryClient.getQueryData(key)).toBeNull()
  })

  test("reload and discard responses replace a stale live cache", () => {
    const stale = live(resource("stale"))
    const saved: ArchitectureDraftSnapshot = { source: "saved", snapshot: snapshot(resource("saved")) }

    expect(architectureLiveDraftCache(stale)).toEqual(stale)
    expect(architectureLiveDraftCache(saved)).toBeNull()
  })

  test("keeps newer live draft cache data over a late stale refetch", () => {
    const newer = live({ ...resource("newer"), revision: 3 }, "newer")
    const stale = live({ ...resource("stale"), revision: 2 }, "stale")

    expect(latestArchitectureLiveDraftCache(newer, stale)).toBe(newer)
  })

  test("clears live draft cache once the saved snapshot covers it", () => {
    const saved = snapshot({ ...resource("saved"), revision: 3 }, "saved")
    const committedDraft = live({ ...resource("saved"), revision: 3 }, "saved")
    const nextDraft = live({ ...resource("next"), revision: 4 }, "next")

    expect(discardSavedArchitectureLiveDraftCache(committedDraft, saved)).toBeNull()
    expect(discardSavedArchitectureLiveDraftCache(nextDraft, saved)).toBe(nextDraft)
  })

  test("reconciles two cumulative edits as incremental patches", async () => {
    const patches: ArchitectureOperation[][] = []
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => {
        patches.push([...operations])
        return live(applyOperations(base.resource, operations))
      },
      update: (draft) => updates.push(draft),
    })
    const first = resource("first")
    const second = { ...first, name: "Second" }

    await synchronizer.synchronize(snapshot(), first)
    await synchronizer.synchronize(snapshot(), second)

    expect(patches).toHaveLength(2)
    expect(patches[0]?.map((operation) => operation.type)).toEqual(["node.update"])
    expect(patches[1]?.map((operation) => operation.type)).toEqual(["resource.update"])
    expect(updates.at(-1)?.snapshot.resource).toEqual(second)
  })

  test("rejects an external draft update between authoritative synchronization and commit", async () => {
    const patches: ArchitectureOperation[][] = []
    let server = resource("A")
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => {
        patches.push([...operations])
        server = applyOperations(base.resource, operations)
        return live(server)
      },
      update: () => undefined,
    })
    const visibleTarget = resource("B")

    await synchronizer.synchronize(snapshot(server), visibleTarget)
    const expected = await synchronizer.synchronizeAuthoritative(async () => live(server), visibleTarget)
    server = resource("external")
    const commit = async () => {
      if (server.revision !== expected.resource.revision || snapshot(server).digest !== expected.digest)
        throw { _tag: "ArchitectureConflictError", conflictKind: "draft_changed" }
      return server
    }

    await expect(commit()).rejects.toMatchObject({
      _tag: "ArchitectureConflictError",
      conflictKind: "draft_changed",
    })
    expect(patches).toHaveLength(1)
    expect(expected.resource).toEqual(visibleTarget)
    expect(server).toEqual(resource("external"))
  })

  test("reconciles an empty local journal back to the pre-existing AI draft", async () => {
    const aiDraft = resource("AI")
    const patches: ArchitectureOperation[][] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => {
        patches.push([...operations])
        return live(applyOperations(base.resource, operations))
      },
      update: () => undefined,
    })

    await synchronizer.synchronize(snapshot(aiDraft), resource("local"))
    await synchronizer.synchronize(snapshot(aiDraft), aiDraft)

    expect(patches.map((operations) => operations.map((operation) => operation.type))).toEqual([
      ["node.update"],
      ["node.update"],
    ])
    expect(applyOperations(resource("local"), patches[1]!)).toEqual(aiDraft)
  })

  test("invalidating a pending response prevents stale cache restoration", async () => {
    const pending = deferred<ArchitectureLiveDraft>()
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: () => pending.promise,
      update: (draft) => updates.push(draft),
    })
    const write = synchronizer.synchronize(snapshot(), resource("draft"))
    await Promise.resolve()
    const invalidated = synchronizer.invalidate()

    pending.resolve(live(resource("draft")))
    await Promise.all([write, invalidated])

    expect(updates).toEqual([])
  })

  test("invalidating a pending authoritative observation rejects synchronization", async () => {
    const pending = deferred<ArchitectureDraftSnapshot>()
    const started = deferred<void>()
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => live(applyOperations(base.resource, operations)),
      update: (draft) => updates.push(draft),
    })
    const write = synchronizer.synchronizeAuthoritative(() => {
      started.resolve(undefined)
      return pending.promise
    }, resource("local"))
    await started.promise
    const invalidated = synchronizer.invalidate()

    pending.resolve(live(resource("discarded")))
    await expect(write).rejects.toBeInstanceOf(ArchitectureDraftSynchronizationCancelled)
    await invalidated

    expect(updates).toEqual([])
  })

  test("diffs exact snapshots without replaying prior creates", () => {
    const withNode = { ...resource(), nodes: [...resource().nodes, node("b", "B")] }
    const edited = { ...withNode, nodes: withNode.nodes.map((item) => (item.id === "b" ? node("b", "B2") : item)) }
    const operations = reconcileArchitectureDraft(withNode, edited)

    expect(operations.map((operation) => operation.type)).toEqual(["node.update"])
    expect(sameArchitectureResource(applyOperations(withNode, operations), edited)).toBe(true)
    expect(sameArchitectureResource({ ...resource(), tagColors: undefined }, resource())).toBe(true)
  })

  test("keeps local journal operations while including externally added nodes", () => {
    const localNode = node("local", "Local")
    const externalNode = node("external", "External")
    const operations: ArchitectureOperation[] = [{ id: "create-local", type: "node.create", node: localNode }]
    const origin = resource()
    const local = applyOperations(origin, operations)
    const live = { ...local, nodes: [...local.nodes, externalNode] }
    const rebased = rebaseArchitectureDraft(origin, operations, live)

    expect(rebased.operations).toEqual(operations)
    expect(rebased.conflicts).toEqual([])
    expect(rebased.base.nodes).toEqual([origin.nodes[0], externalNode])
    expect(
      applyOperations(rebased.base, rebased.operations).nodes.toSorted((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(live.nodes.toSorted((left, right) => left.id.localeCompare(right.id)))
  })

  test("does not duplicate a locally acknowledged node update", () => {
    const origin = resource()
    const updated = { ...origin.nodes[0]!, text: "Updated" }
    const operations: ArchitectureOperation[] = [{ id: "update-a", type: "node.update", node: updated }]
    const rebased = rebaseArchitectureDraft(origin, operations, applyOperations(origin, operations))

    expect(rebased.operations).toEqual(operations)
    expect(rebased.conflicts).toEqual([])
    expect(applyOperations(rebased.base, rebased.operations).nodes).toEqual([updated])
  })
})

function node(id: string, text: string) {
  return { id, text, tags: [], layout: { position: { x: 0, y: 0 } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
