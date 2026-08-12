import type { ArchitectureLiveInstanceCache, ArchitectureRuntimeDebugEvent } from "./contract"
import type { ArchitectureResourceInstanceEventInfo } from "./event"
import { adoptArchitectureLiveInstanceCache } from "./live-instance"
import {
  architectureInstanceRefetchFinishedDebugEvent,
  architectureInstanceRefetchStartedDebugEvent,
} from "./runtime-debug"
import { architectureFetchedLiveInstanceEventPlan } from "./sync-events"

export function syncArchitectureLiveInstanceEventRefetch(input: {
  readonly event: ArchitectureResourceInstanceEventInfo
  readonly current: () => ArchitectureLiveInstanceCache | undefined
  readonly observe: () => Promise<ArchitectureLiveInstanceCache>
  readonly update: (
    next: (current: ArchitectureLiveInstanceCache | undefined) => ArchitectureLiveInstanceCache | undefined,
  ) => void
  readonly debug: (event: ArchitectureRuntimeDebugEvent) => void
}) {
  input.debug(architectureInstanceRefetchStartedDebugEvent(input.event))
  return input
    .observe()
    .then((cache) => {
      const plan = architectureFetchedLiveInstanceEventPlan({ event: input.event, cache })
      const adopted = plan.action === "adopt-cache" ? plan.cache : undefined
      input.debug(
        architectureInstanceRefetchFinishedDebugEvent({
          event: input.event,
          status: plan.action === "adopt-cache" ? "succeeded" : "failed",
          revision: adopted?.snapshot.resource.revision,
          digest: adopted?.snapshot.digest,
          source: adopted ? adopted.source : cache === null ? "saved" : undefined,
          reason: plan.reason,
        }),
      )
      if (plan.action !== "adopt-cache") return
      input.update((current) => (plan.cache ? adoptArchitectureLiveInstanceCache(current, plan.cache) : plan.cache))
    })
    .catch(() => {
      input.debug(
        architectureInstanceRefetchFinishedDebugEvent({
          event: input.event,
          status: "failed",
          reason: "request-failed",
        }),
      )
    })
}
