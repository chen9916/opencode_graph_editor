import type { ArchitectureGetResourceOutput } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/utils/server"
import type { ArchitectureOperation } from "./contract"
import { architectureLiveInstanceCache } from "./live-instance"

export const architectureResourcesQueryKey = (server: string, directory: string) =>
  ["architecture-resources", server, directory] as const

export const architectureResourceQueryKey = (server: string, directory: string, resourceID: string) =>
  ["architecture-resource", server, directory, resourceID] as const

export const architectureResourceInstanceQueryKey = (server: string, directory: string, resourceID: string) =>
  ["architecture-resource-instance", server, directory, resourceID] as const

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

export function duplicateArchitectureResource(
  api: ServerApi,
  directory: string,
  resourceID: string,
  input: { readonly id?: string; readonly name?: string },
) {
  return api.architecture.duplicateResource({ location: { directory }, resourceID, ...input }).then((result) => result.data)
}

export function loadArchitectureResource(api: ServerApi, directory: string, resourceID: string, signal?: AbortSignal) {
  return api.architecture
    .getResource({ location: { directory }, resourceID }, { signal })
    .then((result: ArchitectureGetResourceOutput) => result.data)
}

export function loadArchitectureResourceInstance(
  api: ServerApi,
  directory: string,
  resourceID: string,
  signal?: AbortSignal,
) {
  return loadArchitectureResourceInstanceSnapshot(api, directory, resourceID, signal).then(architectureLiveInstanceCache)
}

export function loadArchitectureResourceInstanceSnapshot(
  api: ServerApi,
  directory: string,
  resourceID: string,
  signal?: AbortSignal,
) {
  return api.architecture.getInstance({ location: { directory }, resourceID }, { signal }).then((result) => result.data)
}

export function updateArchitectureResourceInstance(
  api: ServerApi,
  directory: string,
  base: ArchitectureGetResourceOutput["data"],
  operations: ReadonlyArray<ArchitectureOperation>,
) {
  return api.architecture
    .patchInstance({
      location: { directory },
      resourceID: base.resource.id,
      revision: base.resource.revision,
      digest: base.digest,
      operations: [...operations],
    })
    .then((result) => architectureLiveInstanceCache(result.data))
}

export function commitArchitectureResourceInstance(
  api: ServerApi,
  directory: string,
  instance: ArchitectureGetResourceOutput["data"],
) {
  return api.architecture
    .commitInstance({
      location: { directory },
      resourceID: instance.resource.id,
      revision: instance.resource.revision,
      digest: instance.digest,
    })
    .then((result) => result.data)
}

export function discardArchitectureResourceInstance(api: ServerApi, directory: string, resourceID: string) {
  return api.architecture.discardInstance({ location: { directory }, resourceID }).then((result) => result.data)
}

export function reloadArchitectureResourceInstance(api: ServerApi, directory: string, resourceID: string) {
  return api.architecture.reloadInstance({ location: { directory }, resourceID }).then((result) => result.data)
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
