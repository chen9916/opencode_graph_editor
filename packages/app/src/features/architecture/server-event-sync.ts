import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import { architectureResourceInstanceQueryKey } from "./api"
import type { ArchitectureCacheOrder } from "./cache-order"
import type { ArchitectureLiveInstanceCache, ArchitectureRuntimeDebugEvent, ArchitectureSnapshot } from "./contract"
import {
  architectureResourceEventInfo,
  architectureResourceInstanceEventInfo,
  type ArchitectureResourceEvent,
  type ArchitectureResourceEventInfo,
  type ArchitectureResourceInstanceEventInfo,
} from "./event"
import { adoptArchitectureLiveInstanceCache } from "./live-instance"
import { syncArchitectureLiveInstanceEventRefetch } from "./live-instance-event-sync"
import { architectureResourceServerDebugEvent, architectureSyncDecisionDebugEvent } from "./runtime-debug"
import { architectureLiveInstanceEventPlan, architectureResourceEventRefreshPlan } from "./sync-events"

export function syncArchitectureServerEvent(input: {
  readonly server: string
  readonly directory: string
  readonly selectedResourceID: string | undefined
  readonly localDirty: boolean
  readonly resources: ArchitectureListResourcesOutput["data"] | undefined
  readonly event: ArchitectureResourceEvent
  readonly cacheOrder: ArchitectureCacheOrder
  readonly snapshot: (resourceID: string) => ArchitectureSnapshot | undefined
  readonly currentInstance: (resourceID: string) => ArchitectureLiveInstanceCache | undefined
  readonly loadInstance: (resourceID: string) => Promise<ArchitectureLiveInstanceCache>
  readonly setInstance: (
    resourceID: string,
    next: (current: ArchitectureLiveInstanceCache | undefined) => ArchitectureLiveInstanceCache | undefined,
  ) => void
  readonly refetchResources: () => void
  readonly refetchResource: (resourceID: string) => void
  readonly removeResource: (resourceID: string) => void
  readonly debug: (event: ArchitectureRuntimeDebugEvent) => void
}) {
  const instanceEventInfo = architectureResourceInstanceEventInfo(input.event)
  if (instanceEventInfo) return syncArchitectureInstanceServerEvent(input, instanceEventInfo)
  const eventInfo = architectureResourceEventInfo(input.event)
  if (!eventInfo) return
  return syncArchitectureResourceServerEvent(input, eventInfo)
}

function syncArchitectureInstanceServerEvent(
  input: Parameters<typeof syncArchitectureServerEvent>[0],
  event: ArchitectureResourceInstanceEventInfo,
) {
  input.debug(architectureResourceServerDebugEvent(event))
  const instanceKey = architectureResourceInstanceQueryKey(input.server, input.directory, event.resourceID)
  const plan = architectureLiveInstanceEventPlan({ snapshot: input.snapshot(event.resourceID), event })
  if (plan.action === "ignore-stale") {
    input.debug(
      architectureSyncDecisionDebugEvent({
        resourceID: event.resourceID,
        revision: event.revision,
        digest: event.digest,
        details: instanceDetails(event, { reason: "ignore-stale" }),
      }),
    )
    return
  }
  if (plan.action === "adopt-cache") {
    input.setInstance(event.resourceID, (current) =>
      plan.cache ? adoptArchitectureLiveInstanceCache(current, plan.cache) : plan.cache,
    )
    input.debug(
      architectureSyncDecisionDebugEvent({
        resourceID: event.resourceID,
        revision: plan.cache?.snapshot.resource.revision ?? event.revision,
        digest: plan.cache?.snapshot.digest ?? event.digest,
        details: instanceDetails(event, {
          reason: plan.cache ? "inline-live-instance" : "discarded-live-instance",
          source: plan.cache?.source ?? "saved",
        }),
      }),
    )
    if (plan.cache === null && event.resourceID === input.selectedResourceID) {
      input.refetchResources()
      input.refetchResource(event.resourceID)
    }
    return
  }
  return syncArchitectureLiveInstanceEventRefetch({
    cacheOrder: input.cacheOrder,
    key: instanceKey,
    event,
    current: () => input.currentInstance(event.resourceID),
    observe: () => input.loadInstance(event.resourceID),
    update: (value) => input.setInstance(event.resourceID, value),
    debug: input.debug,
  })
}

function syncArchitectureResourceServerEvent(
  input: Parameters<typeof syncArchitectureServerEvent>[0],
  event: ArchitectureResourceEventInfo,
) {
  input.debug(architectureResourceServerDebugEvent(event))
  const plan = architectureResourceEventRefreshPlan({
    eventType: input.event.type,
    currentResourceID: input.selectedResourceID,
    localDirty: input.localDirty,
    resources: input.resources,
    snapshot: input.snapshot(event.resourceID),
    event,
  })
  input.debug(
    architectureSyncDecisionDebugEvent({
      resourceID: event.resourceID,
      revision: event.revision,
      digest: event.digest,
      details: {
        kind: "resource-event",
        reason: resourcePlanReason({
          event,
          currentResourceID: input.selectedResourceID,
          localDirty: input.localDirty,
          removed: plan.removed,
          updateResources: plan.updateResources,
          updateResource: plan.updateResource,
        }),
        removed: plan.removed,
        updateResources: plan.updateResources,
        updateResource: plan.updateResource,
        clearLiveInstance: plan.clearLiveInstance,
      },
    }),
  )
  if (plan.removed) {
    input.removeResource(event.resourceID)
    return
  }
  if (plan.updateResources) input.refetchResources()
  if (!plan.updateResource) return
  if (plan.clearLiveInstance) input.setInstance(event.resourceID, () => null)
  input.refetchResource(event.resourceID)
}

function instanceDetails(
  event: ArchitectureResourceInstanceEventInfo,
  details: { readonly reason: string; readonly source?: "live" | "saved" },
) {
  return {
    kind: "instance-event",
    action: event.action,
    reason: details.reason,
    source: details.source,
    eventRevision: event.revision,
    eventDigest: event.digest,
    baseRevision: event.baseRevision,
    baseDigest: event.baseDigest,
  }
}

function resourcePlanReason(input: {
  readonly event: ArchitectureResourceEventInfo
  readonly currentResourceID: string | undefined
  readonly localDirty: boolean
  readonly removed: boolean
  readonly updateResources: boolean
  readonly updateResource: boolean
}) {
  if (input.removed) return "removed"
  if (input.event.resourceID === input.currentResourceID && input.localDirty) return "local-dirty"
  if (input.updateResource) return "refetch-resource"
  if (input.updateResources) return "refetch-resources"
  return "already-current"
}
