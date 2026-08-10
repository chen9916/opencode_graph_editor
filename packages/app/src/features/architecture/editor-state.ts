import type { ArchitectureDraftChange, ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import type { ArchitectureConflict } from "./journal"
import { applyOperations } from "./journal"

export function currentArchitectureDraftChange(input: {
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
    )
  return draftChange(
    applyOperations(input.historyBase, input.initialOperations),
    input.initialOperations,
    input.base,
    input.historyOrigin,
    input.conflicts,
  )
}

export function draftChange(
  resource: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
  base: ArchitectureSnapshot,
  origin: ArchitectureSnapshot,
  conflicts: ReadonlyArray<ArchitectureConflict>,
): ArchitectureDraftChange {
  return { base, origin, resource, operations, conflicts }
}
