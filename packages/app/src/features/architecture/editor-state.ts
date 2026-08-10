import type { ArchitectureDraftChange, ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import type { ArchitectureConflict } from "./journal"
import { applyOperations } from "./journal"

export type ArchitectureEditorHistory = {
  readonly resource: ArchitectureResource
  readonly past: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
  readonly future: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
}

export type ArchitectureEditorLoadPlan =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "sync" | "resource" | "reload"
      readonly loadedKey: string
      readonly loadedResourceID: string
      readonly loadedReloadGeneration: number
      readonly editor: ArchitectureEditorHistory
      readonly transient: {
        readonly clearSelection: boolean
        readonly clearEditedHints: boolean
        readonly closePanels: boolean
        readonly preserveViewport: boolean
      }
    }

export function architectureEditorInitialKey(input: {
  readonly base: ArchitectureSnapshot
  readonly liveSnapshot?: ArchitectureSnapshot
  readonly initialOperations: ReadonlyArray<ArchitectureOperation>
  readonly reloadGeneration: number
}) {
  const operationsKey = JSON.stringify(input.initialOperations)
  const snapshotKey = input.liveSnapshot
    ? `${input.base.resource.id}:live:${input.base.digest}:${input.liveSnapshot.digest}:${JSON.stringify(input.liveSnapshot.resource)}:${operationsKey}`
    : `${input.base.resource.id}:${input.base.digest}:${operationsKey}`
  return `${snapshotKey}:reload:${input.reloadGeneration}`
}

export function architectureEditorLoadPlan(input: {
  readonly loadedKey: string
  readonly loadedResourceID: string
  readonly loadedReloadGeneration: number
  readonly initialKey: string
  readonly resourceID: string
  readonly reloadGeneration: number
  readonly historyBase: ArchitectureResource
  readonly initialOperations: ReadonlyArray<ArchitectureOperation>
}): ArchitectureEditorLoadPlan {
  if (input.loadedKey === input.initialKey && input.loadedReloadGeneration === input.reloadGeneration)
    return { kind: "unchanged" }
  const resourceChanged = input.loadedResourceID !== input.resourceID
  const reloadChanged = input.loadedReloadGeneration !== input.reloadGeneration
  return {
    kind: resourceChanged ? "resource" : reloadChanged ? "reload" : "sync",
    loadedKey: input.initialKey,
    loadedResourceID: input.resourceID,
    loadedReloadGeneration: input.reloadGeneration,
    editor: {
      resource: applyOperations(input.historyBase, input.initialOperations),
      past: input.initialOperations.map((operation) => [operation]),
      future: [],
    },
    transient: {
      clearSelection: resourceChanged || reloadChanged,
      clearEditedHints: resourceChanged || reloadChanged,
      closePanels: resourceChanged,
      // Reload replaces the canvas with the authoritative saved graph, but the user's view into the canvas is not saved-state.
      preserveViewport: true,
    },
  }
}

export function currentArchitectureDraftChange(input: {
  readonly server: string
  readonly directory: string
  readonly base: ArchitectureSnapshot
  readonly historyOrigin: ArchitectureSnapshot
  readonly historyBase: ArchitectureResource
  readonly initialOperations: ReadonlyArray<ArchitectureOperation>
  readonly loadedKey: string
  readonly initialKey: string
  readonly editorResource: ArchitectureResource
  readonly editorOperations: ReadonlyArray<ArchitectureOperation>
  readonly conflicts: ReadonlyArray<ArchitectureConflict>
}): ArchitectureDraftChange {
  if (input.loadedKey === input.initialKey)
    return draftChange(
      input.editorResource,
      input.editorOperations,
      input.base,
      input.historyOrigin,
      input.conflicts,
      input.server,
      input.directory,
    )
  return draftChange(
    applyOperations(input.historyBase, input.initialOperations),
    input.initialOperations,
    input.base,
    input.historyOrigin,
    input.conflicts,
    input.server,
    input.directory,
  )
}

export function draftChange(
  resource: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
  base: ArchitectureSnapshot,
  origin: ArchitectureSnapshot,
  conflicts: ReadonlyArray<ArchitectureConflict>,
  server: string,
  directory: string,
): ArchitectureDraftChange {
  return { server, directory, base, origin, resource, operations, conflicts }
}
