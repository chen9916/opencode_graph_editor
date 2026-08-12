import { createMemo, type Accessor } from "solid-js"
import { createQuery, type QueryClient } from "@tanstack/solid-query"
import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/utils/server"
import {
  listArchitectureResources,
  loadArchitectureResource,
  loadArchitectureResourceInstance,
} from "./api"
import { createArchitectureCacheOrder, guardedArchitectureCacheResponse } from "./cache-order"
import type { ArchitectureLiveInstanceCache, ArchitectureSnapshot } from "./contract"
import { adoptArchitectureLiveInstanceCache, latestArchitectureLiveInstanceCache } from "./live-instance"
import { architectureResourceSummary, latestArchitectureSnapshot, updateArchitectureResourceSummaries } from "./resource-state"

export const ARCHITECTURE_RESOURCE_QUERY_REFETCH_INTERVAL = 2_000

export const architectureResourcesQueryKey = (server: string, directory: string) =>
  ["architecture-resources", server, directory] as const

export const architectureResourceQueryKey = (server: string, directory: string, resourceID: string) =>
  ["architecture-resource", server, directory, resourceID] as const

export const architectureResourceInstanceQueryKey = (server: string, directory: string, resourceID: string) =>
  ["architecture-resource-instance", server, directory, resourceID] as const

type ArchitectureQueryValue<T> = T | ((current: T | undefined) => T | undefined)

type ArchitectureQueryScope = {
  readonly server: Accessor<string>
  readonly directory: Accessor<string>
}

type ArchitectureQueryCacheScope = {
  readonly server: string
  readonly directory: string
}

export function createArchitectureResourceQueryCache(input: ArchitectureQueryScope & { readonly queryClient: QueryClient }) {
  const cacheOrder = createArchitectureCacheOrder()
  const setQueryData = <T,>(key: readonly unknown[], value: ArchitectureQueryValue<T>) => {
    cacheOrder.mark(key)
    input.queryClient.setQueryData<T>(key, value)
  }

  const currentScope = () => ({ server: input.server(), directory: input.directory() })
  const resourcesKey = (scope: ArchitectureQueryCacheScope) => architectureResourcesQueryKey(scope.server, scope.directory)
  const resourceKey = (scope: ArchitectureQueryCacheScope, resourceID: string) =>
    architectureResourceQueryKey(scope.server, scope.directory, resourceID)
  const liveInstanceKey = (scope: ArchitectureQueryCacheScope, resourceID: string) =>
    architectureResourceInstanceQueryKey(scope.server, scope.directory, resourceID)
  const scoped = (scope: ArchitectureQueryCacheScope) => ({
    resourcesKey: () => resourcesKey(scope),
    resourceKey: (resourceID: string) => resourceKey(scope, resourceID),
    liveInstanceKey: (resourceID: string) => liveInstanceKey(scope, resourceID),
    getResources: () => input.queryClient.getQueryData<ArchitectureListResourcesOutput["data"]>(resourcesKey(scope)),
    getSnapshot: (resourceID: string) => input.queryClient.getQueryData<ArchitectureSnapshot>(resourceKey(scope, resourceID)),
    getLiveInstance: (resourceID: string) =>
      input.queryClient.getQueryData<ArchitectureLiveInstanceCache>(liveInstanceKey(scope, resourceID)),
    setResources: (value: ArchitectureQueryValue<ArchitectureListResourcesOutput["data"]>) =>
      setQueryData(resourcesKey(scope), value),
    setSnapshot: (resourceID: string, value: ArchitectureQueryValue<ArchitectureSnapshot>) =>
      setQueryData(resourceKey(scope, resourceID), value),
    setLiveInstance: (resourceID: string, value: ArchitectureQueryValue<ArchitectureLiveInstanceCache>) =>
      setQueryData(liveInstanceKey(scope, resourceID), value),
    clearLiveInstance: (resourceID: string) => {
      const key = liveInstanceKey(scope, resourceID)
      cacheOrder.mark(key)
      input.queryClient.removeQueries({ queryKey: key, exact: true })
    },
    adoptLiveInstance: (resourceID: string, value: ArchitectureLiveInstanceCache) =>
      setQueryData<ArchitectureLiveInstanceCache>(liveInstanceKey(scope, resourceID), (current) =>
        adoptArchitectureLiveInstanceCache(current, value),
      ),
    setResourceSummary: (snapshot: ArchitectureSnapshot) =>
      setQueryData(resourcesKey(scope), (current: ArchitectureListResourcesOutput["data"] | undefined) =>
        updateArchitectureResourceSummaries(current, architectureResourceSummary(snapshot)),
      ),
    replaceSavedResource: (snapshot: ArchitectureSnapshot) => {
      setQueryData(resourceKey(scope, snapshot.resource.id), snapshot)
      setQueryData<ArchitectureLiveInstanceCache>(liveInstanceKey(scope, snapshot.resource.id), null)
      setQueryData(resourcesKey(scope), (current: ArchitectureListResourcesOutput["data"] | undefined) =>
        updateArchitectureResourceSummaries(current, architectureResourceSummary(snapshot)),
      )
    },
    removeResource: (resourceID: string) => {
      setQueryData(resourcesKey(scope), (current: ArchitectureListResourcesOutput["data"] | undefined) =>
        current?.filter((item) => item.id !== resourceID),
      )
      setQueryData<ArchitectureLiveInstanceCache>(liveInstanceKey(scope, resourceID), null)
    },
    refetchResources: () =>
      void input.queryClient.refetchQueries({ queryKey: resourcesKey(scope), exact: true, type: "active" }),
    refetchResource: (resourceID: string) =>
      void input.queryClient.refetchQueries({ queryKey: resourceKey(scope, resourceID), exact: true, type: "active" }),
    refetchLiveInstance: (resourceID: string) =>
      void input.queryClient.refetchQueries({ queryKey: liveInstanceKey(scope, resourceID), exact: true, type: "active" }),
    observeResources: (observe: () => Promise<ArchitectureListResourcesOutput["data"]>) => {
      const key = resourcesKey(scope)
      return guardedArchitectureCacheResponse({
        cacheOrder,
        key,
        current: () => input.queryClient.getQueryData<ArchitectureListResourcesOutput["data"]>(key),
        observe,
      })
    },
    observeSnapshot: (resourceID: string, observe: () => Promise<ArchitectureSnapshot>) => {
      const key = resourceKey(scope, resourceID)
      return guardedArchitectureCacheResponse({
        cacheOrder,
        key,
        current: () => input.queryClient.getQueryData<ArchitectureSnapshot>(key),
        observe,
      })
    },
    observeLiveInstance: (resourceID: string, observe: () => Promise<ArchitectureLiveInstanceCache>) => {
      const key = liveInstanceKey(scope, resourceID)
      return guardedArchitectureCacheResponse({
        cacheOrder,
        key,
        current: () => input.queryClient.getQueryData<ArchitectureLiveInstanceCache>(key),
        observe,
      })
    },
  })

  return {
    cacheOrder,
    scope: scoped,
    resourcesKey: () => scoped(currentScope()).resourcesKey(),
    resourceKey: (resourceID: string) => scoped(currentScope()).resourceKey(resourceID),
    liveInstanceKey: (resourceID: string) => scoped(currentScope()).liveInstanceKey(resourceID),
    getResources: () => scoped(currentScope()).getResources(),
    getSnapshot: (resourceID: string) => scoped(currentScope()).getSnapshot(resourceID),
    getLiveInstance: (resourceID: string) => scoped(currentScope()).getLiveInstance(resourceID),
    setResources: (value: ArchitectureQueryValue<ArchitectureListResourcesOutput["data"]>) =>
      scoped(currentScope()).setResources(value),
    setSnapshot: (resourceID: string, value: ArchitectureQueryValue<ArchitectureSnapshot>) =>
      scoped(currentScope()).setSnapshot(resourceID, value),
    setLiveInstance: (resourceID: string, value: ArchitectureQueryValue<ArchitectureLiveInstanceCache>) =>
      scoped(currentScope()).setLiveInstance(resourceID, value),
    clearLiveInstance: (resourceID: string) => scoped(currentScope()).clearLiveInstance(resourceID),
    adoptLiveInstance: (resourceID: string, value: ArchitectureLiveInstanceCache) =>
      scoped(currentScope()).adoptLiveInstance(resourceID, value),
    setResourceSummary: (snapshot: ArchitectureSnapshot) => scoped(currentScope()).setResourceSummary(snapshot),
    replaceSavedResource: (snapshot: ArchitectureSnapshot) => scoped(currentScope()).replaceSavedResource(snapshot),
    removeResource: (resourceID: string) => scoped(currentScope()).removeResource(resourceID),
    refetchResources: () => scoped(currentScope()).refetchResources(),
    refetchResource: (resourceID: string) => scoped(currentScope()).refetchResource(resourceID),
    refetchLiveInstance: (resourceID: string) => scoped(currentScope()).refetchLiveInstance(resourceID),
    observeResources: (observe: () => Promise<ArchitectureListResourcesOutput["data"]>) =>
      scoped(currentScope()).observeResources(observe),
    observeSnapshot: (resourceID: string, observe: () => Promise<ArchitectureSnapshot>) =>
      scoped(currentScope()).observeSnapshot(resourceID, observe),
    observeLiveInstance: (resourceID: string, observe: () => Promise<ArchitectureLiveInstanceCache>) =>
      scoped(currentScope()).observeLiveInstance(resourceID, observe),
  }
}

export type ArchitectureResourceQueryCache = ReturnType<typeof createArchitectureResourceQueryCache>

export function architectureResourcesQueryConfig(input: {
  readonly api: ServerApi
  readonly directory: string
  readonly enabled: boolean
  readonly busy: boolean
  readonly cache: ArchitectureResourceQueryCache
}) {
  return {
    queryKey: input.cache.resourcesKey(),
    enabled: input.enabled,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
      input.cache.observeResources(() => listArchitectureResources(input.api, input.directory, signal)),
    refetchInterval: architectureResourcePollingInterval(input.busy),
    refetchIntervalInBackground: true,
  }
}

export function architectureResourceQueryConfig(input: {
  readonly api: ServerApi
  readonly directory: string
  readonly resourceID: string | undefined
  readonly enabled: boolean
  readonly busy: boolean
  readonly localDirty: boolean
  readonly cache: ArchitectureResourceQueryCache
}) {
  const resourceID = input.resourceID ?? ""
  return {
    queryKey: input.cache.resourceKey(resourceID),
    enabled: input.enabled && !!input.resourceID,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
      input.cache.observeSnapshot(resourceID, () => loadArchitectureResource(input.api, input.directory, resourceID, signal)),
    refetchInterval: architectureResourcePollingInterval(input.busy || input.localDirty),
    refetchIntervalInBackground: true,
    reconcile: latestArchitectureSnapshot,
  }
}

export function architectureLiveInstanceQueryConfig(input: {
  readonly api: ServerApi
  readonly directory: string
  readonly resourceID: string | undefined
  readonly enabled: boolean
  readonly busy: boolean
  readonly cache: ArchitectureResourceQueryCache
}) {
  const resourceID = input.resourceID ?? ""
  return {
    queryKey: input.cache.liveInstanceKey(resourceID),
    enabled: input.enabled && !!input.resourceID,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) =>
      input.cache.observeLiveInstance(resourceID, () =>
        loadArchitectureResourceInstance(input.api, input.directory, resourceID, signal),
      ),
    refetchInterval: architectureResourcePollingInterval(input.busy),
    refetchIntervalInBackground: true,
    reconcile: latestArchitectureLiveInstanceCache,
  }
}

export function createArchitectureResourceListQuery(input: {
  readonly api: Accessor<ServerApi>
  readonly directory: Accessor<string>
  readonly available: Accessor<boolean | undefined>
  readonly busy: Accessor<boolean>
  readonly removedResourceIDs: Accessor<Record<string, true | undefined>>
  readonly cache: ArchitectureResourceQueryCache
}) {
  const resources = createQuery(() =>
    architectureResourcesQueryConfig({
      api: input.api(),
      directory: input.directory(),
      enabled: input.available() === true,
      busy: input.busy(),
      cache: input.cache,
    }),
  )
  const selectableResources = createMemo(() =>
    resources.data?.filter((resource) => !input.removedResourceIDs()[resource.id]),
  )

  return { resources, selectableResources }
}

export function createArchitectureSelectedResourceQueries(input: {
  readonly api: Accessor<ServerApi>
  readonly directory: Accessor<string>
  readonly available: Accessor<boolean | undefined>
  readonly busy: Accessor<boolean>
  readonly localDirty: Accessor<boolean>
  readonly selectedResourceID: Accessor<string | undefined>
  readonly cache: ArchitectureResourceQueryCache
}) {
  const enabled = () => input.available() === true
  const resource = createQuery(() =>
    architectureResourceQueryConfig({
      api: input.api(),
      directory: input.directory(),
      resourceID: input.selectedResourceID(),
      enabled: enabled(),
      busy: input.busy(),
      localDirty: input.localDirty(),
      cache: input.cache,
    }),
  )
  const liveInstance = createQuery(() =>
    architectureLiveInstanceQueryConfig({
      api: input.api(),
      directory: input.directory(),
      resourceID: input.selectedResourceID(),
      enabled: enabled(),
      busy: input.busy(),
      cache: input.cache,
    }),
  )

  return { resource, liveInstance }
}

function architectureResourcePollingInterval(paused: boolean): false | number {
  if (paused) return false
  return ARCHITECTURE_RESOURCE_QUERY_REFETCH_INTERVAL
}
