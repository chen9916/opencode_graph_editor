import { describe, expect, test } from "bun:test"
import type { ArchitectureDraftChange, ArchitectureSnapshot } from "./contract"
import { beginArchitectureLocalSave, isArchitectureLocalSaveEvent } from "./event"
import {
  architectureDraftResourceID,
  architectureResourceSelectionOptions,
  architectureResourceSummary,
  latestArchitectureSnapshot,
  reconcileArchitectureSavedEvent,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
  selectedArchitectureSnapshot,
  selectedArchitectureResourceSummary,
  updateArchitectureResourceSummaries,
} from "./resource-state"

const snapshot = (id: string, name: string): ArchitectureSnapshot => ({
  digest: `${id}-digest`,
  storage: { root: "/repo/.opencode/architecture", path: `.opencode/architecture/resources/${id}.json` },
  resource: { version: 2, revision: 0, id, name, nodes: [], edges: [] },
})

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

  test("routes an Add Node journal to the graph represented by the editor change", () => {
    const created = snapshot("new_graph", "New Graph")
    const change: ArchitectureDraftChange = {
      base: created,
      origin: created,
      conflicts: [],
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
    }

    expect(architectureDraftResourceID(change)).toBe("new_graph")
    expect(architectureDraftResourceID(change)).not.toBe("auth_resourceID")
  })

  test("save settling does not replace an already cached newer saved revision", () => {
    const s1 = snapshot("design", "S1")
    const s2 = { ...snapshot("design", "S2"), resource: { ...snapshot("design", "S2").resource, revision: 2 } }
    const summaries = updateArchitectureResourceSummaries(
      [architectureResourceSummary(s2)],
      architectureResourceSummary(s1),
    )

    expect(latestArchitectureSnapshot(s2, s1)).toBe(s2)
    expect(summaries).toEqual([architectureResourceSummary(s2)])
  })

  test("keeps newly saved nodes visible when a late refetch returns the previous revision", () => {
    const old = snapshot("design", "Design")
    const saved = {
      ...snapshot("design", "Design"),
      digest: "design-digest-2",
      resource: {
        ...old.resource,
        revision: 2,
        nodes: [{ id: "new", text: "New node", tags: [], layout: { position: { x: 0, y: 0 } } }],
      },
    }

    expect(latestArchitectureSnapshot(saved, old)).toBe(saved)
  })

  test("reconciles a newer saved event suppressed during a failed Save", async () => {
    const finish = beginArchitectureLocalSave({ server: "server", directory: "/repo", resourceID: "design" })
    const current = snapshot("design", "S1")
    const newest = {
      ...snapshot("design", "S3"),
      digest: "design-digest-3",
      resource: { ...snapshot("design", "S3").resource, revision: 3 },
    }
    expect(
      isArchitectureLocalSaveEvent({
        server: "server",
        directory: "/repo",
        event: { resourceID: "design", revision: 3, digest: newest.digest },
      }),
    ).toBe(true)

    const reconciled = await reconcileArchitectureSavedEvent({
      current,
      event: finish(),
      observe: async () => newest,
    })

    expect(reconciled).toEqual({ snapshot: newest, invalidate: false })
  })
})
