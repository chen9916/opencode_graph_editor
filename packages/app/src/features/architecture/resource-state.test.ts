import { describe, expect, test } from "bun:test"
import type { ArchitectureInstanceChange, ArchitectureSnapshot } from "./contract"
import {
  architectureInstanceCanSkipSave,
  architectureInstanceHasVisibleChanges,
  architectureInstanceIsDirty,
  architectureInstanceResourceID,
  architectureVisibleLiveInstance,
  architectureResourceSelectionOptions,
  architectureResourceSummary,
  latestArchitectureSnapshot,
  missingSelectedArchitectureResourceID,
  reconcileArchitectureSavedEvent,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
  selectedArchitectureSnapshot,
  selectedArchitectureResourceSummary,
  updateArchitectureResourceSummaries,
} from "./resource-state"

const snapshot = (id: string, name: string, digest = `${id}-digest`): ArchitectureSnapshot => ({
  digest,
  storage: { root: "/repo/.opencode/architecture", path: `.opencode/architecture/resources/${id}.json` },
  resource: { version: 2, revision: 0, id, name, nodes: [], edges: [] },
})

const change = (overrides: Partial<ArchitectureInstanceChange> = {}): ArchitectureInstanceChange => {
  const saved = snapshot("design", "Design")
  return {
    server: "server",
    directory: "/repo",
    base: saved,
    origin: saved,
    resource: saved.resource,
    operations: [],
    conflicts: [],
    ...overrides,
  }
}

describe("architecture resource state", () => {
  test("preserves an explicit selection while the resource list is stale", () => {
    const stale = [architectureResourceSummary(snapshot("auth_resourceID", "Auth"))]

    expect(resolveArchitectureResourceID("new_graph", stale)).toBe("new_graph")
    expect(resolveArchitectureResourceID(undefined, stale)).toBe("auth_resourceID")
  })

  test("keeps a created graph active across an auth-first event refetch race", () => {
    const auth = architectureResourceSummary(snapshot("auth_resourceID", "Auth"))
    const created = snapshot("new_graph", "New Graph")
    const optimistic = updateArchitectureResourceSummaries([auth], architectureResourceSummary(created))

    expect(optimistic.map((resource) => resource.id)).toEqual(["auth_resourceID", "new_graph"])
    expect(resolveArchitectureResourceID(created.resource.id, optimistic)).toBe("new_graph")
    expect(resolveArchitectureResourceID(created.resource.id, [auth])).toBe("new_graph")
  })

  test("reports a persisted selection as missing only after the resource load fails", () => {
    const auth = architectureResourceSummary(snapshot("auth_resourceID", "Auth"))
    const billing = snapshot("billing_resourceID", "Billing")

    expect(
      missingSelectedArchitectureResourceID({
        selectedID: "new_graph",
        resources: [auth],
        snapshot: undefined,
        resourceError: undefined,
      }),
    ).toBeUndefined()
    expect(
      missingSelectedArchitectureResourceID({
        selectedID: "new_graph",
        resources: [auth],
        snapshot: undefined,
        resourceError: new Error("missing"),
      }),
    ).toBe("new_graph")
    expect(
      missingSelectedArchitectureResourceID({
        selectedID: billing.resource.id,
        resources: [auth],
        snapshot: billing,
        resourceError: new Error("stale list"),
      }),
    ).toBeUndefined()
  })

  test("ignores highlighted resources until the selector commits a selection", () => {
    const auth = architectureResourceSummary(snapshot("auth_resourceID", "Auth"))
    const billing = architectureResourceSummary(snapshot("billing_resourceID", "Billing"))

    expect(
      resolveArchitectureResourceSelection({
        currentID: auth.id,
        selectedID: billing.id,
        committed: false,
      }),
    ).toBe(auth.id)
    expect(
      resolveArchitectureResourceSelection({
        currentID: auth.id,
        selectedID: billing.id,
        committed: true,
      }),
    ).toBe(billing.id)
  })

  test("keeps an explicitly selected graph in selector options during stale list reconciliation", () => {
    const auth = architectureResourceSummary(snapshot("auth_resourceID", "Auth"))
    const billing = snapshot("billing_resourceID", "Billing")
    const options = architectureResourceSelectionOptions([auth], billing)

    expect(selectedArchitectureResourceSummary(billing.resource.id, [auth])).toBeUndefined()
    expect(options.map((resource) => resource.id)).toEqual(["auth_resourceID", "billing_resourceID"])
    expect(selectedArchitectureResourceSummary(billing.resource.id, [auth], billing)).toEqual(
      architectureResourceSummary(billing),
    )
    expect(resolveArchitectureResourceID(billing.resource.id, [auth])).toBe(billing.resource.id)
  })

  test("ignores snapshots that do not belong to the active resource", () => {
    const auth = snapshot("auth_resourceID", "Auth")
    const billing = snapshot("billing_resourceID", "Billing")

    expect(selectedArchitectureSnapshot("billing_resourceID", auth)).toBeUndefined()
    expect(selectedArchitectureSnapshot("billing_resourceID", billing)).toBe(billing)
  })

  test("dirty state is driven by local operations and conflicts", () => {
    expect(architectureInstanceHasVisibleChanges(change())).toBe(false)
    expect(
      architectureInstanceHasVisibleChanges(
        change({
          operations: [{ id: "move", type: "node.position", nodeID: "node", position: { x: 12, y: 8 } }],
        }),
      ),
    ).toBe(true)
    expect(
      architectureInstanceCanSkipSave(
        change({
          operations: [],
          conflicts: [
            {
              operation: { id: "conflict", type: "node.remove", nodeID: "missing", cascade: true },
              reason: "missing",
            },
          ],
        }),
      ),
    ).toBe(false)
    expect(architectureInstanceIsDirty({ pending: change() })).toBe(false)
    expect(architectureInstanceIsDirty({ pending: { ...change(), instance: { source: "live" } } })).toBe(true)
    expect(
      architectureInstanceIsDirty({
        pending: change({
          operations: [{ id: "move", type: "node.position", nodeID: "node", position: { x: 12, y: 8 } }],
        }),
      }),
    ).toBe(true)
  })

  test("routes an Add Node journal to the graph represented by the editor change", () => {
    const created = snapshot("new_graph", "New Graph")
    const changeValue = change({
      base: created,
      origin: created,
      resource: {
        ...created.resource,
        nodes: [{ id: "node", text: "New node", tags: [], layout: { position: { x: 0, y: 0 } } }],
      },
      operations: [
        {
          id: "add-node",
          type: "node.create",
          node: { id: "node", text: "New node", tags: [], layout: { position: { x: 0, y: 0 } } },
        },
      ],
    })

    expect(architectureInstanceResourceID(changeValue)).toBe("new_graph")
  })

  test("selection and summary helpers keep the latest saved snapshot visible", async () => {
    const saved = snapshot("design", "Saved")
    const newer = { ...snapshot("design", "Saved", "next-digest"), resource: { ...saved.resource, revision: 2 } }

    expect(latestArchitectureSnapshot(saved, newer)).toBe(newer)
    expect(architectureResourceSummary(saved)).toEqual({
      id: "design",
      name: "Saved",
      revision: 0,
      digest: "design-digest",
      nodes: 0,
      edges: 0,
    })

    const reconciled = await reconcileArchitectureSavedEvent({
      current: saved,
      event: { resourceID: "design", revision: 2, digest: newer.digest },
      observe: async () => newer,
    })

    expect(reconciled).toEqual({ snapshot: newer, invalidate: false })
  })

  test("prefers the backend live instance over an acknowledged local pending overlay", () => {
    const saved = snapshot("design", "Design")
    const live = {
      source: "live" as const,
      snapshot: {
        ...saved,
        digest: "live",
        resource: {
          ...saved.resource,
          nodes: [{ id: "node", text: "Live", tags: [], layout: { position: { x: 0, y: 0 } } }],
        },
      },
    }
    const visible = architectureVisibleLiveInstance({
      saved,
      live,
      pending: {
        base: saved,
        origin: saved,
        journalBase: saved.resource,
        operations: [{ id: "add-node", type: "node.create", node: live.snapshot.resource.nodes[0]! }],
        conflicts: [],
      },
    })

    expect(visible.snapshot).toBe(live.snapshot)
    expect(visible.pendingCovered).toBe(true)
    expect(visible.pending?.operations).toEqual([])
    expect(visible.pending?.instance).toBe(live)
  })

  test("prefers the backend live instance over the saved snapshot without a local pending overlay", () => {
    const saved = snapshot("design", "Saved")
    const live = {
      source: "live" as const,
      snapshot: {
        ...saved,
        digest: "ai-live",
        resource: {
          ...saved.resource,
          nodes: [{ id: "ai", text: "AI update", tags: [], layout: { position: { x: 0, y: 0 } } }],
        },
      },
    }

    const visible = architectureVisibleLiveInstance({ saved, live, pending: undefined })

    expect(visible.snapshot).toBe(live.snapshot)
    expect(visible.pending?.base).toBe(live.snapshot)
    expect(visible.pending?.operations).toEqual([])
    expect(visible.pendingCovered).toBe(false)
  })

  test("treats unacknowledged local operations as a pending overlay on top of the live instance", () => {
    const saved = snapshot("design", "Design")
    const aiNode = { id: "ai", text: "AI", tags: [], layout: { position: { x: 240, y: 0 } } }
    const localNode = { id: "local", text: "Local", tags: [], layout: { position: { x: 0, y: 120 } } }
    const live = {
      source: "live" as const,
      snapshot: { ...saved, digest: "ai", resource: { ...saved.resource, nodes: [aiNode] } },
    }
    const visible = architectureVisibleLiveInstance({
      saved,
      live,
      pending: {
        base: saved,
        origin: saved,
        journalBase: saved.resource,
        operations: [{ id: "add-local", type: "node.create", node: localNode }],
        conflicts: [],
      },
    })

    expect(visible.snapshot).toBe(live.snapshot)
    expect(visible.pendingCovered).toBe(false)
    expect(visible.pending?.journalBase).toBe(live.snapshot.resource)
    expect(visible.pending?.operations.map((operation) => operation.type)).toEqual(["node.create"])
    expect(visible.pending?.operations[0]).toMatchObject({ type: "node.create", node: localNode })
  })
})
