import type { ArchitectureDraftChange, ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import type { ArchitectureConflict } from "./journal"

export type ArchitectureEditorHistory = {
  readonly resource: ArchitectureResource
  readonly past: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
  readonly future: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
}

export function architectureEditorInitialKey(input: { readonly base: ArchitectureSnapshot }) {
  return `${input.base.resource.id}:${input.base.digest}`
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
