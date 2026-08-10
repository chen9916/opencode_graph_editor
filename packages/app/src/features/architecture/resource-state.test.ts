import { describe, expect, test } from "bun:test"
import type { ArchitectureDraftChange, ArchitectureDraftSnapshot, ArchitectureLiveDraft, ArchitectureSnapshot } from "./contract"
import { beginArchitectureLocalSave, isArchitectureLocalSaveEvent } from "./event"
import {
  architectureDraftIsDirty,
  architectureDraftCanSkipSave,
  architectureDraftHasVisibleChanges,
  architectureDraftResourceID,
  architectureReloadSuccessState,
  architectureResourceSelectionOptions,
  architectureResourceSummary,
  architectureSaveSuccessState,
  latestArchitectureSnapshot,
  reconcileArchitectureSavedEvent,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
  selectedArchitectureSnapshot,
  selectedArchitectureResourceSummary,
  updateArchitectureResourceSummaries,
  visibleArchitectureDraft,
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
      server: "server",
      directory: "/repo",
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

  test("detects whether duplicate should use visible draft changes", () => {
    const saved = snapshot("design", "Design")
    const live = { ...snapshot("design", "Design"), digest: "live-digest" }

    expect(
      architectureDraftHasVisibleChanges({
        server: "server",
        directory: "/repo",
        base: saved,
        origin: saved,
        resource: saved.resource,
        operations: [],
        conflicts: [],
      }),
    ).toBe(false)
    expect(
      architectureDraftHasVisibleChanges({
        server: "server",
        directory: "/repo",
        base: saved,
        origin: live,
        resource: live.resource,
        operations: [],
        conflicts: [],
      }),
    ).toBe(true)
    expect(
      architectureDraftHasVisibleChanges({
        server: "server",
        directory: "/repo",
        base: saved,
        origin: saved,
        conflicts: [],
        resource: { ...saved.resource, name: "Visible rename" },
        operations: [{ id: "rename", type: "resource.update", name: "Visible rename" }],
      }),
    ).toBe(true)
  })

  test("clean Save can skip patch and commit work", () => {
    const saved = snapshot("design", "Design")

    expect(
      architectureDraftCanSkipSave({
        server: "server",
        directory: "/repo",
        base: saved,
        origin: saved,
        resource: saved.resource,
        operations: [],
        conflicts: [],
      }),
    ).toBe(true)
  })

  test("successful Save plus a concurrent own draft discard clears dirty state and advances renderer generation", () => {
    const saved = { ...snapshot("design", "Saved"), resource: { ...snapshot("design", "Saved").resource, revision: 2 } }
    const state = architectureSaveSuccessState({
      current: snapshot("design", "Draft"),
      saved,
      draft: live("design", "Draft"),
      draftEvent: { resourceID: "design", action: "discarded", revision: 2, digest: saved.digest },
      reloadGeneration: 4,
    })

    expect(state.snapshot).toEqual(saved)
    expect(state.draft).toBeNull()
    expect(state.reloadGeneration).toBe(5)
    expect(
      architectureDraftIsDirty({
        draft: visibleArchitectureDraft({
          base: state.snapshot,
          origin: state.snapshot,
          operations: [],
          conflicts: [],
          live: state.draft ?? undefined,
        }),
      }),
    ).toBe(false)
  })

  test("successful Reload plus a concurrent draft event keeps the authoritative saved snapshot and advances renderer generation", () => {
    const reloaded: ArchitectureDraftSnapshot = { source: "saved", snapshot: snapshot("design", "Saved") }
    const state = architectureReloadSuccessState({
      reloaded,
      draftEvent: { resourceID: "design", action: "updated", revision: 1, digest: "stale" },
      reloadGeneration: 2,
    })

    expect(state.snapshot).toEqual(reloaded.snapshot)
    expect(state.draft).toBeNull()
    expect(state.reloadGeneration).toBe(3)
  })

  test("saved-covered live draft is not dirty", () => {
    const saved = { ...snapshot("design", "Saved"), resource: { ...snapshot("design", "Saved").resource, revision: 3 } }
    const draft = visibleArchitectureDraft({
      base: saved,
      origin: saved,
      operations: [],
      conflicts: [],
      live: { source: "live", snapshot: saved },
    })

    expect(draft).toBeUndefined()
    expect(architectureDraftIsDirty({ draft })).toBe(false)
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

function live(id: string, name: string): ArchitectureLiveDraft {
  return { source: "live", snapshot: snapshot(id, name) }
}
