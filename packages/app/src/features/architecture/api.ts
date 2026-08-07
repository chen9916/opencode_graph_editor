import type { ArchitectureGetResourceOutput } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/utils/server"
import type { ArchitectureOperation } from "./contract"

export const architectureResourcesQueryKey = (server: string, directory: string) =>
  ["architecture-resources", server, directory] as const

export const architectureResourceQueryKey = (server: string, directory: string, resourceID: string) =>
  ["architecture-resource", server, directory, resourceID] as const

export function listArchitectureResources(api: ServerApi, directory: string, signal?: AbortSignal) {
  return api.architecture.listResources({ location: { directory } }, { signal }).then((result) => result.data)
}

export function createArchitectureResource(
  api: ServerApi,
  directory: string,
  input: { readonly id?: string; readonly name: string },
) {
  return api.architecture.createResource({ location: { directory }, ...input }).then((result) => result.data)
}

export function loadArchitectureResource(api: ServerApi, directory: string, resourceID: string, signal?: AbortSignal) {
  return api.architecture
    .getResource({ location: { directory }, resourceID }, { signal })
    .then((result: ArchitectureGetResourceOutput) => result.data)
}

export function patchArchitectureResource(
  api: ServerApi,
  directory: string,
  base: ArchitectureGetResourceOutput["data"],
  operations: ReadonlyArray<ArchitectureOperation>,
) {
  return api.architecture
    .patchResource({
      location: { directory },
      resourceID: base.resource.id,
      revision: base.resource.revision,
      digest: base.digest,
      operations: [...operations],
    })
    .then((result) => result.data)
}

export function removeArchitectureResource(
  api: ServerApi,
  directory: string,
  base: ArchitectureGetResourceOutput["data"],
) {
  return api.architecture.removeResource({
    location: { directory },
    resourceID: base.resource.id,
    revision: base.resource.revision,
    digest: base.digest,
  })
}
