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
