import type { ArchitectureOperation, ArchitectureResource, ArchitectureRuntimeView, ArchitectureSnapshot } from "./contract"
import { syncArchitectureEditorHistorySource, type ArchitectureEditorHistory } from "./editor-state"

export type ArchitectureCanvasSourceKind = "saved" | "live"
export type ArchitectureCanvasSourceAction = "initial" | "replace" | "rebase" | "unchanged"
export type ArchitectureCanvasSourceReason =
  | "initial-mount"
  | "resource-switch"
  | "pending-rebase"
  | "newer-source"
  | "same-revision-digest-change"
  | "source-change"
  | "digest-change"
  | "unchanged"

export type ArchitectureCanvasSourceMetadata = {
  readonly resourceID: string
  readonly revision: number
  readonly digest: string
  readonly source: ArchitectureCanvasSourceKind
}

export type ArchitectureCanvasSourceTransition = {
  readonly action: ArchitectureCanvasSourceAction
  readonly reason: ArchitectureCanvasSourceReason
  readonly resourceID: string
  readonly source: ArchitectureCanvasSourceKind
  readonly from?: ArchitectureCanvasSourceMetadata
  readonly to: ArchitectureCanvasSourceMetadata
}

export function syncArchitectureCanvasSource(input: {
  readonly history: ArchitectureEditorHistory
  readonly source: ArchitectureResource
  readonly operations: ReadonlyArray<ArchitectureOperation>
  readonly snapshot: ArchitectureSnapshot
  readonly runtimeView: ArchitectureRuntimeView
  readonly previous?: ArchitectureCanvasSourceMetadata
}) {
  const metadata = architectureCanvasSourceMetadata({ snapshot: input.snapshot, runtimeView: input.runtimeView })
  return {
    history: syncArchitectureEditorHistorySource(input.history, input.source, input.operations),
    metadata,
    transition: architectureCanvasSourceTransition({
      previous: input.previous,
      current: metadata,
      operations: input.operations,
    }),
  }
}

export function architectureCanvasSourceMetadata(input: {
  readonly snapshot: ArchitectureSnapshot
  readonly runtimeView: ArchitectureRuntimeView
}): ArchitectureCanvasSourceMetadata {
  return {
    resourceID: input.runtimeView.selectedResourceID ?? input.snapshot.resource.id,
    revision: input.runtimeView.visibleRevision ?? input.snapshot.resource.revision,
    digest: input.runtimeView.visibleDigest ?? input.snapshot.digest,
    source: input.runtimeView.hasLiveInstance ? "live" : "saved",
  }
}

function architectureCanvasSourceTransition(input: {
  readonly previous?: ArchitectureCanvasSourceMetadata
  readonly current: ArchitectureCanvasSourceMetadata
  readonly operations: ReadonlyArray<ArchitectureOperation>
}): ArchitectureCanvasSourceTransition {
  if (!input.previous)
    return transition({ action: "initial", reason: "initial-mount", current: input.current, previous: input.previous })
  if (input.previous.resourceID !== input.current.resourceID)
    return transition({ action: "replace", reason: "resource-switch", current: input.current, previous: input.previous })
  if (input.operations.length > 0)
    return transition({ action: "rebase", reason: "pending-rebase", current: input.current, previous: input.previous })
  if (sameMetadata(input.previous, input.current))
    return transition({ action: "unchanged", reason: "unchanged", current: input.current, previous: input.previous })
  if (input.previous.revision === input.current.revision && input.previous.digest !== input.current.digest)
    return transition({
      action: "replace",
      reason: "same-revision-digest-change",
      current: input.current,
      previous: input.previous,
    })
  if (input.current.revision > input.previous.revision)
    return transition({ action: "replace", reason: "newer-source", current: input.current, previous: input.previous })
  if (input.previous.source !== input.current.source)
    return transition({ action: "replace", reason: "source-change", current: input.current, previous: input.previous })
  return transition({ action: "replace", reason: "digest-change", current: input.current, previous: input.previous })
}

function transition(input: {
  readonly action: ArchitectureCanvasSourceAction
  readonly reason: ArchitectureCanvasSourceReason
  readonly current: ArchitectureCanvasSourceMetadata
  readonly previous?: ArchitectureCanvasSourceMetadata
}): ArchitectureCanvasSourceTransition {
  return {
    action: input.action,
    reason: input.reason,
    resourceID: input.current.resourceID,
    source: input.current.source,
    from: input.previous,
    to: input.current,
  }
}

function sameMetadata(left: ArchitectureCanvasSourceMetadata, right: ArchitectureCanvasSourceMetadata) {
  return (
    left.resourceID === right.resourceID &&
    left.revision === right.revision &&
    left.digest === right.digest &&
    left.source === right.source
  )
}
