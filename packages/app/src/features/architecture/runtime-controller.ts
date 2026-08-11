import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type {
  ArchitectureLiveInstanceCache,
  ArchitecturePendingOverlay,
  ArchitectureRuntimeDebugEvent,
  ArchitectureSnapshot,
} from "./contract"
import {
  architectureResourceSelectionOptions,
  selectedArchitectureResourceSummary,
} from "./resource-state"
import { architectureRuntimeView } from "./runtime-view"

export function architectureRuntimeController(input: {
  readonly selectedResourceID: string | undefined
  readonly resources: ArchitectureListResourcesOutput["data"] | undefined
  readonly saved: ArchitectureSnapshot | undefined
  readonly live: ArchitectureLiveInstanceCache | undefined
  readonly pending: ArchitecturePendingOverlay | undefined
  readonly debugEvents: ReadonlyArray<ArchitectureRuntimeDebugEvent> | undefined
}) {
  const view = architectureRuntimeView({
    selectedResourceID: input.selectedResourceID,
    saved: input.saved,
    live: input.live,
    pending: input.pending,
  })
  const runtimeView = { ...view, debugEvents: input.selectedResourceID ? (input.debugEvents ?? []) : [] }
  const resourceOptions = architectureResourceSelectionOptions(input.resources, runtimeView.visibleSnapshot)
  return {
    runtimeView,
    pending: runtimeView.pending,
    dirty: runtimeView.dirty,
    resourceOptions,
    selectedResource: selectedArchitectureResourceSummary(input.selectedResourceID, resourceOptions),
    pendingCoveredResourceID: runtimeView.pendingCovered ? input.selectedResourceID : undefined,
  }
}

export type ArchitectureRuntimeController = ReturnType<typeof architectureRuntimeController>
