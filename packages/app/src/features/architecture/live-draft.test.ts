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

  test("keeps the visible live draft over a late null or same-revision response", () => {
    const current = live(resource("current"), "current")
    const stale = live(resource("stale"), "stale")

    expect(latestArchitectureLiveDraftCache(current, null)).toBe(current)
    expect(latestArchitectureLiveDraftCache(current, stale)).toBe(current)
  })

  test("clears live draft cache once the saved snapshot covers it", () => {
    const saved = snapshot({ ...resource("saved"), revision: 3 }, "saved")
    const committedDraft = live({ ...resource("saved"), revision: 3 }, "saved")
    const aiDraft = live({ ...resource("ai"), revision: 3 }, "ai")
    const nextDraft = live({ ...resource("next"), revision: 4 }, "next")

    expect(discardSavedArchitectureLiveDraftCache(committedDraft, saved)).toBeNull()
    expect(discardSavedArchitectureLiveDraftCache(aiDraft, saved)).toBe(aiDraft)
    expect(discardSavedArchitectureLiveDraftCache(nextDraft, saved)).toBe(nextDraft)
  })

  test("does not erase a newer AI draft after an out-of-order discard for the same saved revision", () => {
    const saved = snapshot({ ...resource("saved"), revision: 2 }, "saved")
    const aiDraft = live({ ...resource("AI"), revision: 2 }, "ai-draft")

    expect(discardSavedArchitectureLiveDraftCache(aiDraft, saved)).toBe(aiDraft)
    expect(latestArchitectureLiveDraftCache(aiDraft, null)).toBe(aiDraft)
  })

  test("reconciles two cumulative edits as incremental patches", async () => {
    const patches: ArchitectureOperation[][] = []
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => {
        patches.push([...operations])
        return live(applyOperations(base.resource, operations))
      },
      update: (draft) => {
        if (draft) updates.push(draft)
      },
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

  test("waits for a delayed external draft fetch before saving the rebased canvas", async () => {
    const externalNode = node("external", "AI")
    const localNode = node("local", "Local")
    const ai = { ...resource(), nodes: [...resource().nodes, externalNode] }
    const operations: ArchitectureOperation[] = [{ id: "create-local", type: "node.create", node: localNode }]
    const pending = deferred<ArchitectureDraftSnapshot>()
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => live(applyOperations(base.resource, operations)),
      update: () => undefined,
    })

    const fetch = synchronizer.adoptSnapshot(() => pending.promise)
    await Promise.resolve()
    const save = synchronizer.synchronizeAuthoritative(async () => live(ai), (observed) => {
      const rebased = rebaseArchitectureDraft(resource(), operations, observed.snapshot.resource)
      return applyOperations(rebased.base, rebased.operations)
    })
    pending.resolve(live(ai))

    const synchronized = await save
    await fetch

    expect(synchronized.resource.nodes.map((item) => item.id).toSorted()).toEqual(["a", "external", "local"])
  })

  test("adopts an externally observed draft before calculating later local patches", async () => {
    const externalNode = node("external", "AI")
    const localNode = node("local", "Local")
    const ai = { ...resource(), nodes: [...resource().nodes, externalNode] }
    const target = { ...ai, nodes: [...ai.nodes, localNode] }
    const patches: ArchitectureOperation[][] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => {
        patches.push([...operations])
        return live(applyOperations(base.resource, operations))
      },
      update: () => undefined,
    })

    await synchronizer.adopt(live(ai))
    await synchronizer.synchronize(snapshot(resource()), target)

    expect(patches).toHaveLength(1)
    expect(patches[0]?.map((operation) => operation.type)).toEqual(["node.create"])
    expect(applyOperations(ai, patches[0]!).nodes.map((item) => item.id).toSorted()).toEqual([
      "a",
      "external",
      "local",
    ])
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
      update: (draft) => {
        if (draft) updates.push(draft)
      },
    })
    const write = synchronizer.synchronize(snapshot(), resource("draft"))
    await Promise.resolve()
    const invalidated = synchronizer.invalidate()

    pending.resolve(live(resource("draft")))
    await Promise.all([write, invalidated])

    expect(updates).toEqual([])
  })

  test("invalidate waits for an in-flight patch before reload can discard the draft", async () => {
    const pending = deferred<ArchitectureLiveDraft>()
    const started = deferred<void>()
    const updates: ArchitectureLiveDraft[] = []
    const events: string[] = []
    let server = resource("saved")
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: (_base, _operations) => {
        events.push("patch-start")
        started.resolve(undefined)
        return pending.promise.then((draft) => {
          server = draft.snapshot.resource
          events.push("patch-finished")
          return draft
        })
      },
      update: (draft) => {
        if (draft) updates.push(draft)
      },
    })
    const write = synchronizer.synchronize(snapshot(server), resource("draft"))
    await started.promise
    let reloaded = false
    const reload = synchronizer.invalidate().then(() => {
      server = resource("reloaded")
      reloaded = true
      events.push("reload")
    })

    await Promise.resolve()
    expect(reloaded).toBe(false)

    pending.resolve(live(resource("draft")))
    await Promise.all([write, reload])

    expect(events).toEqual(["patch-start", "patch-finished", "reload"])
    expect(server).toEqual(resource("reloaded"))
    expect(updates).toEqual([])
  })

  test("invalidating a pending authoritative observation rejects synchronization", async () => {
    const pending = deferred<ArchitectureDraftSnapshot>()
    const started = deferred<void>()
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => live(applyOperations(base.resource, operations)),
      update: (draft) => {
        if (draft) updates.push(draft)
      },
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

  test("invalidating a pending external draft fetch prevents late cache restoration after save or reload", async () => {
    const pending = deferred<ArchitectureDraftSnapshot>()
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: async (base, operations) => live(applyOperations(base.resource, operations)),
      update: (draft) => {
        if (draft) updates.push(draft)
      },
    })
    const fetch = synchronizer.adoptSnapshot(() => pending.promise)
    await Promise.resolve()
    const invalidated = synchronizer.invalidate()

    pending.resolve(live(resource("late")))
    await expect(fetch).rejects.toBeInstanceOf(ArchitectureDraftSynchronizationCancelled)
    await invalidated

    expect(updates).toEqual([])
  })

  test("invalidating before authoritative save drains a started patch without waiting for a queued metadata fetch", async () => {
    const patch = deferred<ArchitectureLiveDraft>()
    const events: string[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: () => {
        events.push("patch-start")
        return patch.promise
      },
      update: () => undefined,
    })
    const write = synchronizer.synchronize(snapshot(), resource("draft"))
    await Promise.resolve()
    const metadataFetch = synchronizer.adoptSnapshot(() => {
      events.push("metadata-fetch-start")
      return Promise.resolve(live(resource("metadata")))
    })
    const metadataFetchFailure = metadataFetch.catch((error) => error)
    const invalidated = synchronizer.invalidate()
    const save = synchronizer.synchronizeAuthoritative(
      async () => {
        events.push("save-observe")
        return live(resource("server"))
      },
      resource("server"),
    )

    await Promise.resolve()
    expect(events).toEqual(["patch-start"])

    patch.resolve(live(resource("draft")))
    await Promise.all([write, invalidated, save])

    expect(await metadataFetchFailure).toBeInstanceOf(ArchitectureDraftSynchronizationCancelled)
    expect(events).toEqual(["patch-start", "save-observe"])
  })

  test("resource switching invalidation cancels pending per-resource synchronization", async () => {
    const pending = deferred<ArchitectureLiveDraft>()
    const updates: ArchitectureLiveDraft[] = []
    const synchronizer = createArchitectureDraftSynchronizer({
      patch: () => pending.promise,
      update: (draft) => {
        if (draft) updates.push(draft)
      },
    })
    const write = synchronizer.synchronize(snapshot(), resource("old selection"))
    await Promise.resolve()
    const switched = synchronizer.invalidate()

    pending.resolve(live(resource("old selection")))
    await Promise.all([write, switched])

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
