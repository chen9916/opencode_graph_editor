import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/utils/server"
import {
  ARCHITECTURE_RESOURCE_QUERY_REFETCH_INTERVAL,
  architectureLiveInstanceQueryConfig,
  architectureResourceInstanceQueryKey,
  architectureResourceQueryConfig,
  architectureResourceQueryKey,
  architectureResourcesQueryConfig,
  architectureResourcesQueryKey,
  createArchitectureResourceQueryCache,
} from "./architecture-resource-queries"
import type { ArchitectureLiveInstance, ArchitectureSnapshot } from "./contract"

describe("architecture resource queries", () => {
  test("protects selected saved-resource cache from late stale responses", async () => {
    const queryClient = new QueryClient()
    const cache = createArchitectureResourceQueryCache({
      queryClient,
      server: () => "server",
      directory: () => "/repo",
    })
    const pending = deferred<ArchitectureSnapshot>()
    const response = cache.observeSnapshot("design", () => pending.promise)

    cache.replaceSavedResource(snapshot("design", 2, "saved-current"))
    pending.resolve(snapshot("design", 1, "saved-stale"))

    await expect(response).resolves.toEqual(snapshot("design", 2, "saved-current"))
    expect(cache.getSnapshot("design")?.digest).toBe("saved-current")
  })

  test("protects live-instance cache from late event refetch responses", async () => {
    const cache = createArchitectureResourceQueryCache({
      queryClient: new QueryClient(),
      server: () => "server",
      directory: () => "/repo",
    })
    const pending = deferred<ArchitectureLiveInstance>()
    const response = cache.observeLiveInstance("design", () => pending.promise)

    cache.adoptLiveInstance("design", live("design", 2, "authoritative"))
    pending.resolve(live("design", 1, "stale"))

    await expect(response).resolves.toEqual(live("design", 2, "authoritative"))
  })

  test("adopts authoritative live-instance cache over same-revision local cache", () => {
    const cache = createArchitectureResourceQueryCache({
      queryClient: new QueryClient(),
      server: () => "server",
      directory: () => "/repo",
    })

    cache.setLiveInstance("design", live("design", 1, "current"))
    cache.adoptLiveInstance("design", live("design", 1, "authoritative"))

    expect(cache.getLiveInstance("design")?.snapshot.digest).toBe("authoritative")
  })

  test("scopes selected resource and live-instance caches by resource ID and workspace", () => {
    const queryClient = new QueryClient()
    let directory = "/repo"
    const cache = createArchitectureResourceQueryCache({
      queryClient,
      server: () => "server",
      directory: () => directory,
    })

    cache.setSnapshot("design-a", snapshot("design-a", 1, "a"))
    cache.setSnapshot("design-b", snapshot("design-b", 1, "b"))
    cache.setLiveInstance("design-a", live("design-a", 1, "live-a"))
    cache.scope({ server: "server", directory: "/other" }).setSnapshot("design-a", snapshot("design-a", 1, "other-a"))
    directory = "/ignored"
    cache.scope({ server: "server", directory: "/repo" }).setLiveInstance("design-b", live("design-b", 1, "live-b"))

    expect(queryClient.getQueryData<ArchitectureSnapshot>(architectureResourceQueryKey("server", "/repo", "design-a"))?.digest).toBe(
      "a",
    )
    expect(queryClient.getQueryData<ArchitectureSnapshot>(architectureResourceQueryKey("server", "/repo", "design-b"))?.digest).toBe(
      "b",
    )
    expect(
      queryClient.getQueryData<ArchitectureSnapshot>(architectureResourceQueryKey("server", "/other", "design-a"))?.digest,
    ).toBe("other-a")
    expect(
      queryClient.getQueryData<ArchitectureLiveInstance>(
        architectureResourceInstanceQueryKey("server", "/repo", "design-a"),
      )?.snapshot.digest,
    ).toBe("live-a")
    expect(
      queryClient.getQueryData<ArchitectureLiveInstance>(
        architectureResourceInstanceQueryKey("server", "/repo", "design-b"),
      )?.snapshot.digest,
    ).toBe("live-b")
  })

  test("replaces saved resource caches after save or reload", () => {
    const cache = createArchitectureResourceQueryCache({
      queryClient: new QueryClient(),
      server: () => "server",
      directory: () => "/repo",
    })
    cache.setResources([summary("design", 1, "old")])
    cache.setLiveInstance("design", live("design", 1, "dirty"))

    cache.replaceSavedResource(snapshot("design", 2, "saved"))

    expect(cache.getSnapshot("design")?.digest).toBe("saved")
    expect(cache.getLiveInstance("design")).toBeNull()
    expect(cache.getResources()).toEqual([summary("design", 2, "saved")])
  })

  test("keeps canonical query keys, availability guards, and polling behavior in one config boundary", () => {
    const cache = createArchitectureResourceQueryCache({
      queryClient: new QueryClient(),
      server: () => "server",
      directory: () => "/repo",
    })
    const api = {} as ServerApi

    expect(
      architectureResourcesQueryConfig({ api, directory: "/repo", enabled: false, busy: false, cache }),
    ).toMatchObject({
      queryKey: architectureResourcesQueryKey("server", "/repo"),
      enabled: false,
      refetchInterval: ARCHITECTURE_RESOURCE_QUERY_REFETCH_INTERVAL,
      refetchIntervalInBackground: true,
    })
    expect(
      architectureResourceQueryConfig({
        api,
        directory: "/repo",
        resourceID: "design",
        enabled: true,
        busy: false,
        localDirty: true,
        cache,
      }).refetchInterval,
    ).toBe(false)
    expect(
      architectureLiveInstanceQueryConfig({
        api,
        directory: "/repo",
        resourceID: undefined,
        enabled: true,
        busy: true,
        cache,
      }),
    ).toMatchObject({
      queryKey: architectureResourceInstanceQueryKey("server", "/repo", ""),
      enabled: false,
      refetchInterval: false,
    })
  })
})

function summary(id: string, revision: number, digest: string): ArchitectureListResourcesOutput["data"][number] {
  return { id, name: id, revision, digest, nodes: 0, edges: 0 }
}

function live(id: string, revision: number, digest: string): ArchitectureLiveInstance {
  return { source: "live", snapshot: snapshot(id, revision, digest) }
}

function snapshot(id: string, revision: number, digest: string): ArchitectureSnapshot {
  return {
    digest,
    storage: { root: "/repo/.opencode/architecture", path: `.opencode/architecture/resources/${id}.json` },
    resource: { version: 2, revision, id, name: id, nodes: [], edges: [] },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
