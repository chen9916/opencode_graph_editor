import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { ServerApi } from "@/utils/server"
import {
  createArchitectureResourceAction,
  duplicateArchitectureResourceAction,
  reloadArchitectureResourceAction,
  removeArchitectureResourceAction,
  saveArchitectureResourceAction,
  type ArchitectureResourceActionScope,
} from "./architecture-resource-actions"
import { createArchitectureResourceQueryCache } from "./architecture-resource-queries"
import type {
  ArchitectureInstanceChange,
  ArchitectureLiveInstance,
  ArchitectureOperation,
  ArchitecturePendingOverlay,
  ArchitectureRuntimeDebugEvent,
  ArchitectureSnapshot,
  ArchitectureViewport,
} from "./contract"

describe("architecture resource actions", () => {
  test("saves by invalidating, synchronizing authoritatively, committing, replacing saved cache, and clearing live state", async () => {
    const events: string[] = []
    const debugEvents: ArchitectureRuntimeDebugEvent[] = []
    const dependencies = createDependencies()
    const server = createServerApi({
      getInstance: async () => {
        events.push("load-instance")
        return { source: "live", snapshot: snapshot("design", 2, "observed") }
      },
      patchInstance: async () => {
        events.push("patch-instance")
        return { source: "live", snapshot: snapshot("design", 3, "synchronized") }
      },
      commitInstance: async () => {
        events.push("commit-instance")
        return snapshot("design", 4, "saved")
      },
    })

    dependencies.cache.setResources([summary("design", 1, "old")])
    dependencies.cache.setLiveInstance("design", live("design", 2, "dirty"))
    dependencies.pending.design = overlay("design")
    await saveArchitectureResourceAction({
      change: change(snapshot("design", 1, "old"), resource("design", 1, "edited")),
      busy: false,
      currentServer: "server",
      currentDirectory: "/repo",
      currentLivePending: live("design", 2, "dirty"),
      scope: scope(server, "design"),
      cache: dependencies.cache,
      synchronizer: synchronizer(events),
      setBusy: (busy) => events.push(`busy:${busy}`),
      clearPendingOverlay: (id) => (dependencies.pending[id] = undefined),
      bumpLiveInstanceVersion: (id) => (dependencies.versions[id] = (dependencies.versions[id] ?? 0) + 1),
      debug: (event) => debugEvents.push(event),
      onError: dependencies.onError,
    })

    expect(events).toEqual(["busy:true", "invalidate", "load-instance", "patch-instance", "commit-instance", "adopt:null", "busy:false"])
    expect(dependencies.cache.getSnapshot("design")?.digest).toBe("saved")
    expect(dependencies.cache.getLiveInstance("design")).toBeNull()
    expect(dependencies.cache.getResources()).toEqual([summary("design", 4, "saved")])
    expect(dependencies.pending.design).toBeUndefined()
    expect(dependencies.versions.design).toBe(1)
    expect(debugEvents.map((event) => `${event.type}:${event.status}`)).toEqual(["save:started", "save:succeeded"])
    expect(dependencies.errors).toEqual([])
  })

  test("reloads by invalidating, reloading, replacing saved cache, clearing pending overlay, and adopting null", async () => {
    const events: string[] = []
    const dependencies = createDependencies()
    dependencies.cache.setResources([summary("design", 1, "old")])
    dependencies.cache.setLiveInstance("design", live("design", 2, "dirty"))
    dependencies.pending.design = overlay("design")

    await reloadArchitectureResourceAction({
      busy: false,
      scope: scope(
        createServerApi({
          reloadInstance: async () => {
            events.push("reload-instance")
            return { source: "live", snapshot: snapshot("design", 5, "reloaded") }
          },
        }),
        "design",
      ),
      cache: dependencies.cache,
      synchronizer: synchronizer(events),
      setBusy: (busy) => events.push(`busy:${busy}`),
      clearPendingOverlay: (id) => (dependencies.pending[id] = undefined),
      bumpLiveInstanceVersion: (id) => (dependencies.versions[id] = (dependencies.versions[id] ?? 0) + 1),
      debug: (event) => events.push(`debug:${event.type}:${event.status}`),
      onError: dependencies.onError,
    })

    expect(events).toEqual(["busy:true", "debug:reload:started", "invalidate", "reload-instance", "adopt:null", "debug:reload:succeeded", "busy:false"])
    expect(dependencies.cache.getSnapshot("design")?.digest).toBe("reloaded")
    expect(dependencies.cache.getLiveInstance("design")).toBeNull()
    expect(dependencies.pending.design).toBeUndefined()
    expect(dependencies.versions.design).toBe(1)
    expect(dependencies.errors).toEqual([])
  })

  test("rolls back resource removal cache, live cache, pending overlay, viewport, and selection when delete fails", async () => {
    const dependencies = createDependencies()
    const events: string[] = []
    const before = snapshot("design", 3, "saved")
    dependencies.cache.setResources([summary("design", 3, "saved")])
    dependencies.cache.setLiveInstance("design", live("design", 4, "live"))
    dependencies.selectedID = "design"
    dependencies.pending.design = overlay("design")
    dependencies.viewports.design = { x: 1, y: 2, zoom: 3 }

    await removeArchitectureResourceAction({
      snapshot: before,
      busy: false,
      scope: scope(
        createServerApi({
          removeResource: async () => {
            events.push("remove-resource")
            throw new Error("nope")
          },
        }),
        "design",
      ),
      cache: dependencies.cache,
      getSelectedID: () => dependencies.selectedID,
      setSelectedID: (id) => (dependencies.selectedID = id),
      getPendingOverlay: (id) => dependencies.pending[id],
      setPendingOverlay: (id, pending) => (dependencies.pending[id] = pending),
      getViewport: (id) => dependencies.viewports[id],
      setViewport: (id, viewport) => (dependencies.viewports[id] = viewport),
      setBusy: (busy) => events.push(`busy:${busy}`),
      setRemovedResourceID: (id, removed) => (dependencies.removed[id] = removed),
      onError: dependencies.onError,
    })

    expect(events).toEqual(["busy:true", "remove-resource", "busy:false"])
    expect(dependencies.removed.design).toBeUndefined()
    expect(dependencies.cache.getResources()).toEqual([summary("design", 3, "saved")])
    expect(dependencies.cache.getLiveInstance("design")?.snapshot.digest).toBe("live")
    expect(dependencies.selectedID).toBe("design")
    expect(dependencies.pending.design).toEqual(overlay("design"))
    expect(dependencies.viewports.design).toEqual({ x: 1, y: 2, zoom: 3 })
    expect(dependencies.errors).toEqual(["remove:design"])
  })

  test("removes resource optimistically and refetches active list on success", async () => {
    const dependencies = createDependencies()
    const events: string[] = []
    dependencies.cache.setResources([summary("design", 3, "saved"), summary("other", 1, "other")])
    dependencies.cache.setLiveInstance("design", live("design", 4, "live"))
    dependencies.selectedID = "design"
    dependencies.pending.design = overlay("design")
    dependencies.viewports.design = { x: 1, y: 2, zoom: 3 }

    await removeArchitectureResourceAction({
      snapshot: snapshot("design", 3, "saved"),
      busy: false,
      scope: scope(
        createServerApi({
          removeResource: async () => {
            events.push("remove-resource")
          },
        }),
        "design",
      ),
      cache: dependencies.cache,
      getSelectedID: () => dependencies.selectedID,
      setSelectedID: (id) => (dependencies.selectedID = id),
      getPendingOverlay: (id) => dependencies.pending[id],
      setPendingOverlay: (id, pending) => (dependencies.pending[id] = pending),
      getViewport: (id) => dependencies.viewports[id],
      setViewport: (id, viewport) => (dependencies.viewports[id] = viewport),
      setBusy: (busy) => events.push(`busy:${busy}`),
      setRemovedResourceID: (id, removed) => (dependencies.removed[id] = removed),
      onError: dependencies.onError,
    })

    expect(events).toEqual(["busy:true", "remove-resource", "busy:false"])
    expect(dependencies.removed.design).toBeTrue()
    expect(dependencies.cache.getResources()).toEqual([summary("other", 1, "other")])
    expect(dependencies.cache.getLiveInstance("design")).toBeNull()
    expect(dependencies.selectedID).toBeUndefined()
    expect(dependencies.pending.design).toBeUndefined()
    expect(dependencies.viewports.design).toBeUndefined()
    expect(dependencies.queryClient.isFetching({ queryKey: dependencies.cache.resourcesKey() })).toBe(0)
    expect(dependencies.errors).toEqual([])
  })

  test("creates and duplicates resources through saved cache replacement and selected ID updates", async () => {
    const dependencies = createDependencies()
    const createApi = createServerApi({
      createResource: async (input) => snapshot(input.name === "New" ? "new" : "copy", 1, input.name),
      patchInstance: async (input) => ({ source: "live", snapshot: snapshot(input.resourceID, 2, "patched") }),
      commitInstance: async (input) => snapshot(input.resourceID, 3, "committed"),
    })

    await createArchitectureResourceAction({
      busy: false,
      persistedReady: true,
      scope: { api: createApi, server: "server", directory: "/repo" },
      cache: dependencies.cache,
      name: "New",
      setBusy: (busy) => dependencies.events.push(`busy:${busy}`),
      setSelectedID: (id) => (dependencies.selectedID = id),
      onError: dependencies.onError,
    })
    await duplicateArchitectureResourceAction({
      change: change(snapshot("source", 1, "source"), resource("source", 1, "duplicate")),
      busy: false,
      persistedReady: true,
      currentServer: "server",
      currentDirectory: "/repo",
      scope: scope(createApi, "source"),
      cache: dependencies.cache,
      name: "Copy",
      setBusy: (busy) => dependencies.events.push(`busy:${busy}`),
      setSelectedID: (id) => (dependencies.selectedID = id),
      onError: dependencies.onError,
    })

    expect(dependencies.cache.getSnapshot("new")?.digest).toBe("New")
    expect(dependencies.cache.getSnapshot("copy")?.digest).toBe("committed")
    expect(dependencies.selectedID).toBe("copy")
    expect(dependencies.errors).toEqual([])
  })
})

function createDependencies() {
  const queryClient = new QueryClient()
  const errors: string[] = []
  return {
    queryClient,
    cache: createArchitectureResourceQueryCache({ queryClient, server: () => "server", directory: () => "/repo" }),
    selectedID: undefined as string | undefined,
    pending: {} as Record<string, ArchitecturePendingOverlay | undefined>,
    viewports: {} as Record<string, ArchitectureViewport | undefined>,
    removed: {} as Record<string, true | undefined>,
    versions: {} as Record<string, number | undefined>,
    errors,
    events: [] as string[],
    onError(error: { readonly action: string; readonly resourceID?: string }) {
      errors.push(`${error.action}:${error.resourceID ?? ""}`)
    },
  }
}

function synchronizer(events: string[]) {
  return {
    invalidate: async () => {
      events.push("invalidate")
    },
    synchronizeAuthoritative: async (observe: () => Promise<{ readonly source: string; readonly snapshot: ArchitectureSnapshot }>) => {
      const observed = await observe()
      events.push("patch-instance")
      return snapshot(observed.snapshot.resource.id, observed.snapshot.resource.revision + 1, "synchronized")
    },
    adopt: async (instance: ArchitectureLiveInstance | null) => {
      events.push(`adopt:${instance?.snapshot.resource.id ?? "null"}`)
      return instance
    },
  }
}

function scope(api: ServerApi, resourceID: string): ArchitectureResourceActionScope {
  return { api, server: "server", directory: "/repo", resourceID }
}

function createServerApi(architecture: {
  readonly createResource?: (input: { readonly name: string }) => Promise<ArchitectureSnapshot>
  readonly getInstance?: () => Promise<{ readonly source: "live"; readonly snapshot: ArchitectureSnapshot }>
  readonly patchInstance?: (input: { readonly resourceID: string; readonly operations: ReadonlyArray<ArchitectureOperation> }) => Promise<{
    readonly source: "live"
    readonly snapshot: ArchitectureSnapshot
  }>
  readonly commitInstance?: (input: { readonly resourceID: string }) => Promise<ArchitectureSnapshot>
  readonly reloadInstance?: () => Promise<{ readonly source: "live"; readonly snapshot: ArchitectureSnapshot }>
  readonly removeResource?: () => Promise<void>
}) {
  return {
    architecture: {
      createResource: (input: { readonly name: string }) => Promise.resolve(architecture.createResource?.(input)).then((data) => ({ data })),
      getInstance: () => Promise.resolve(architecture.getInstance?.()).then((data) => ({ data })),
      patchInstance: (input: { readonly resourceID: string; readonly operations: ReadonlyArray<ArchitectureOperation> }) =>
        Promise.resolve(architecture.patchInstance?.(input)).then((data) => ({ data })),
      commitInstance: (input: { readonly resourceID: string }) =>
        Promise.resolve(architecture.commitInstance?.(input)).then((data) => ({ data })),
      reloadInstance: () => Promise.resolve(architecture.reloadInstance?.()).then((data) => ({ data })),
      removeResource: () => Promise.resolve(architecture.removeResource?.()).then((data) => ({ data })),
    },
  } as unknown as ServerApi
}

function summary(id: string, revision: number, digest: string) {
  return { id, name: id, revision, digest, nodes: 0, edges: 0 }
}

function live(id: string, revision: number, digest: string): ArchitectureLiveInstance {
  return { source: "live", snapshot: snapshot(id, revision, digest) }
}

function overlay(id: string): ArchitecturePendingOverlay {
  return { base: snapshot(id, 1, "base"), origin: snapshot(id, 1, "base"), operations: [], conflicts: [] }
}

function change(base: ArchitectureSnapshot, target: ArchitectureSnapshot["resource"]): ArchitectureInstanceChange {
  return {
    server: "server",
    directory: "/repo",
    base,
    origin: base,
    resource: target,
    operations: [{ id: "op", type: "resource.update", name: target.name }],
    conflicts: [],
  }
}

function snapshot(id: string, revision: number, digest: string): ArchitectureSnapshot {
  return { digest, storage: { root: "/repo/.opencode/architecture", path: `${id}.json` }, resource: resource(id, revision, id) }
}

function resource(id: string, revision: number, name: string) {
  return { version: 2 as const, revision, id, name, nodes: [], edges: [] }
}
