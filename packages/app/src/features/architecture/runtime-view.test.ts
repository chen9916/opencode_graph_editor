import { describe, expect, test } from "bun:test"
import type { ArchitectureLiveInstance, ArchitectureOperation, ArchitecturePendingOverlay, ArchitectureSnapshot } from "./contract"
import { architectureRuntimeView } from "./runtime-view"

const snapshot = (overrides: {
  readonly id?: string
  readonly text?: string
  readonly revision?: number
  readonly digest?: string
} = {}): ArchitectureSnapshot => ({
  digest: overrides.digest ?? `${overrides.id ?? "design"}-digest`,
  storage: {
    root: "/repo/.opencode/architecture",
    path: `.opencode/architecture/resources/${overrides.id ?? "design"}.json`,
  },
  resource: {
    version: 2,
    revision: overrides.revision ?? 1,
    id: overrides.id ?? "design",
    name: "Design",
    nodes: [{ id: "node", text: overrides.text ?? "Saved", tags: [], layout: { position: { x: 0, y: 0 } } }],
    edges: [],
  },
})

const live = (value: ArchitectureSnapshot): ArchitectureLiveInstance => ({ source: "live", snapshot: value })

const pending = (
  base: ArchitectureSnapshot,
  operations: ReadonlyArray<ArchitectureOperation>,
  conflicts: ArchitecturePendingOverlay["conflicts"] = [],
): ArchitecturePendingOverlay => ({
  base,
  origin: base,
  journalBase: base.resource,
  operations,
  conflicts,
})

describe("architecture runtime view", () => {
  test("summarizes a clean saved resource", () => {
    const saved = snapshot()

    expect(
      architectureRuntimeView({ selectedResourceID: saved.resource.id, saved, live: null, pending: undefined }),
    ).toMatchObject({
      snapshot: saved,
      visibleSnapshot: saved,
      visibleResource: saved.resource,
      dirty: false,
      dirtyReasons: [],
      operationCount: 0,
      conflictCount: 0,
      hasLiveInstance: false,
      savedRevision: 1,
      savedDigest: "design-digest",
      visibleRevision: 1,
      visibleDigest: "design-digest",
      syncStatus: "clean",
    })
  })

  test("reports dirty pending operations", () => {
    const saved = snapshot()
    const operation: ArchitectureOperation = {
      id: "move-node",
      type: "node.position",
      nodeID: "node",
      position: { x: 12, y: 8 },
    }
    const view = architectureRuntimeView({
      selectedResourceID: saved.resource.id,
      saved,
      live: null,
      pending: pending(saved, [operation]),
    })

    expect(view.dirty).toBe(true)
    expect(view.dirtyReasons).toEqual(["pending-operations"])
    expect(view.operationCount).toBe(1)
    expect(view.conflictCount).toBe(0)
    expect(view.syncStatus).toBe("local-pending")
  })

  test("reports dirty pending conflicts", () => {
    const saved = snapshot()
    const view = architectureRuntimeView({
      selectedResourceID: saved.resource.id,
      saved,
      live: null,
      pending: pending(saved, [], [
        {
          operation: { id: "remove-missing", type: "node.remove", nodeID: "missing", cascade: true },
          reason: "missing",
        },
      ]),
    })

    expect(view.dirty).toBe(true)
    expect(view.dirtyReasons).toEqual(["pending-conflicts"])
    expect(view.operationCount).toBe(0)
    expect(view.conflictCount).toBe(1)
    expect(view.syncStatus).toBe("conflicted")
  })

  test("reports dirty backend live instances", () => {
    const saved = snapshot()
    const updated = snapshot({ text: "AI", digest: "live-digest" })
    const view = architectureRuntimeView({
      selectedResourceID: saved.resource.id,
      saved,
      live: live(updated),
      pending: undefined,
    })

    expect(view.dirty).toBe(true)
    expect(view.dirtyReasons).toEqual(["live-instance"])
    expect(view.operationCount).toBe(0)
    expect(view.conflictCount).toBe(0)
    expect(view.hasLiveInstance).toBe(true)
    expect(view.visibleSnapshot).toBe(updated)
    expect(view.savedDigest).toBe("design-digest")
    expect(view.visibleDigest).toBe("live-digest")
    expect(view.syncStatus).toBe("live-instance")
  })

  test("marks a local pending overlay as covered when the live instance already includes it", () => {
    const saved = snapshot()
    const node = { id: "local", text: "Local", tags: [], layout: { position: { x: 24, y: 12 } } }
    const updated = {
      ...saved,
      digest: "covered-live",
      resource: { ...saved.resource, nodes: [...saved.resource.nodes, node] },
    }
    const view = architectureRuntimeView({
      selectedResourceID: saved.resource.id,
      saved,
      live: live(updated),
      pending: pending(saved, [{ id: "add-local", type: "node.create", node }]),
    })

    expect(view.pendingCovered).toBe(true)
    expect(view.dirty).toBe(true)
    expect(view.dirtyReasons).toEqual(["live-instance"])
    expect(view.operationCount).toBe(0)
    expect(view.conflictCount).toBe(0)
    expect(view.hasLiveInstance).toBe(true)
    expect(view.syncStatus).toBe("pending-covered")
  })
})
