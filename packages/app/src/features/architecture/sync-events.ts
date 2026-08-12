import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ArchitectureLiveInstanceCache, ArchitectureSnapshot } from "./contract"
import {
  architectureInstanceEventIsStale,
  architectureResourceInstanceEventCache,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
  type ArchitectureResourceEventInfo,
  type ArchitectureResourceInstanceEventInfo,
} from "./event"

export function architectureLiveInstanceEventPlan(input: {
  readonly snapshot: ArchitectureSnapshot | undefined
  readonly event: ArchitectureResourceInstanceEventInfo
}):
  | { readonly action: "ignore-stale" }
  | { readonly action: "adopt-cache"; readonly cache: ArchitectureLiveInstanceCache }
  | { readonly action: "refetch" } {
  if (architectureInstanceEventIsStale(input.snapshot, input.event)) return { action: "ignore-stale" }
  const cache = architectureResourceInstanceEventCache(input.event)
  if (cache !== undefined) return { action: "adopt-cache", cache }
  return { action: "refetch" }
}

export function architectureFetchedLiveInstanceEventPlan(input: {
  readonly event: ArchitectureResourceInstanceEventInfo
  readonly cache: ArchitectureLiveInstanceCache | undefined
}):
  | { readonly action: "adopt-cache"; readonly cache: ArchitectureLiveInstanceCache; readonly reason: "event-discarded" | "live-response" }
  | {
      readonly action: "ignore"
      readonly reason: "missing-response" | "saved-response" | "resource-mismatch" | "older-than-event" | "digest-mismatch"
    } {
  if (input.event.action === "discarded") return { action: "adopt-cache", cache: null, reason: "event-discarded" }
  if (input.cache === undefined) return { action: "ignore", reason: "missing-response" }
  if (input.cache === null) return { action: "ignore", reason: "saved-response" }
  if (input.cache.snapshot.resource.id !== input.event.resourceID) return { action: "ignore", reason: "resource-mismatch" }
  if (input.event.revision !== undefined && input.cache.snapshot.resource.revision < input.event.revision)
    return { action: "ignore", reason: "older-than-event" }
  if (
    input.event.revision !== undefined &&
    input.event.digest !== undefined &&
    input.cache.snapshot.resource.revision === input.event.revision &&
    input.cache.snapshot.digest !== input.event.digest
  )
    return { action: "ignore", reason: "digest-mismatch" }
  return { action: "adopt-cache", cache: input.cache, reason: "live-response" }
}

export function architectureResourceEventRefreshPlan(input: {
  readonly eventType: string
  readonly currentResourceID: string | undefined
  readonly localDirty: boolean
  readonly resources: ArchitectureListResourcesOutput["data"] | undefined
  readonly snapshot: ArchitectureSnapshot | undefined
  readonly event: ArchitectureResourceEventInfo
}): {
  readonly removed: boolean
  readonly updateResources: boolean
  readonly updateResource: boolean
  readonly clearLocalState: boolean
  readonly clearLiveInstance: boolean
} {
  if (input.eventType === "architecture.resource.removed")
    return { removed: true, updateResources: true, updateResource: false, clearLocalState: true, clearLiveInstance: true }
  if (input.event.resourceID === input.currentResourceID && input.localDirty)
    return {
      removed: false,
      updateResources: false,
      updateResource: false,
      clearLocalState: false,
      clearLiveInstance: false,
    }
  const updateResource =
    input.event.resourceID === input.currentResourceID && !architectureSnapshotMatchesEvent(input.snapshot, input.event)
  return {
    removed: false,
    updateResources: !architectureSummaryMatchesEvent(input.resources, input.event),
    updateResource,
    clearLocalState: false,
    clearLiveInstance: updateResource,
  }
}
