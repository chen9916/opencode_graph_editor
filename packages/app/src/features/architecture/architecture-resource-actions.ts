import { batch } from "solid-js"
import type { ServerApi } from "@/utils/server"
import {
  commitArchitectureResourceInstance,
  createArchitectureResource,
  loadArchitectureResourceInstanceSnapshot,
  reloadArchitectureResourceInstance,
  removeArchitectureResource,
  updateArchitectureResourceInstance,
} from "./api"
import type { ArchitectureResourceQueryCache } from "./architecture-resource-queries"
import type {
  ArchitectureInstanceChange,
  ArchitectureLiveInstance,
  ArchitecturePendingOverlay,
  ArchitectureRuntimeDebugEvent,
  ArchitectureSnapshot,
  ArchitectureViewport,
} from "./contract"
import { type createArchitectureInstanceSynchronizer, reconcileArchitectureInstanceChange } from "./live-instance"
import { architectureInstanceCanSkipSave, architectureInstanceResourceID } from "./resource-state"
import {
  architectureFailedDebugEvent,
  architectureReloadStartedDebugEvent,
  architectureSaveStartedDebugEvent,
  architectureSnapshotDebugEvent,
} from "./runtime-debug"

export type ArchitectureResourceActionName = "save" | "reload" | "create" | "duplicate" | "remove"

export type ArchitectureResourceActionError = {
  readonly action: ArchitectureResourceActionName
  readonly resourceID?: string
  readonly error: unknown
}

export type ArchitectureResourceActionResult = {
  readonly ok: boolean
  readonly resource?: ArchitectureSnapshot
}

export type ArchitectureResourceActionScope = {
  readonly api: ServerApi
  readonly server: string
  readonly directory: string
  readonly resourceID: string
}

export type ArchitectureResourceWorkspaceActionScope = Omit<ArchitectureResourceActionScope, "resourceID">

export type ArchitectureResourceActionSynchronizer = Pick<
  ReturnType<typeof createArchitectureInstanceSynchronizer>,
  "invalidate" | "synchronizeAuthoritative" | "adopt"
>

export async function saveArchitectureResourceAction(input: {
  readonly change: ArchitectureInstanceChange
  readonly busy: boolean
  readonly currentServer: string
  readonly currentDirectory: string
  readonly currentLivePending: ArchitectureLiveInstance | undefined
  readonly scope: ArchitectureResourceActionScope
  readonly cache: ArchitectureResourceQueryCache
  readonly synchronizer: ArchitectureResourceActionSynchronizer
  readonly setBusy: (busy: boolean) => void
  readonly clearPendingOverlay: (resourceID: string) => void
  readonly bumpLiveInstanceVersion: (resourceID: string) => void
  readonly debug: (event: ArchitectureRuntimeDebugEvent) => void
  readonly onError: (error: ArchitectureResourceActionError) => void
}): Promise<ArchitectureResourceActionResult> {
  const id = architectureInstanceResourceID(input.change)
  if (input.busy) return { ok: false }
  if (architectureInstanceCanSkipSave(input.change) && !input.currentLivePending) return { ok: true }
  if (input.change.server !== input.currentServer || input.change.directory !== input.currentDirectory) return { ok: false }
  const scopeQueries = input.cache.scope({ server: input.scope.server, directory: input.scope.directory })
  input.setBusy(true)
  input.debug(architectureSaveStartedDebugEvent(input.change))
  try {
    await input.synchronizer.invalidate()
    const synchronized = await input.synchronizer.synchronizeAuthoritative(
      () => loadArchitectureResourceInstanceSnapshot(input.scope.api, input.scope.directory, id),
      input.change.resource,
    )
    const saved = await commitArchitectureResourceInstance(input.scope.api, input.scope.directory, synchronized)
    batch(() => {
      scopeQueries.replaceSavedResource(saved)
      input.clearPendingOverlay(id)
      input.bumpLiveInstanceVersion(id)
    })
    void input.synchronizer.adopt(null).catch(() => undefined)
    input.debug(architectureSnapshotDebugEvent({ resourceID: id, type: "save", status: "succeeded", snapshot: saved }))
    return { ok: true, resource: saved }
  } catch (error) {
    input.debug(architectureFailedDebugEvent({ resourceID: id, type: "save" }))
    input.onError({ action: "save", resourceID: id, error })
    return { ok: false }
  } finally {
    input.setBusy(false)
  }
}

export async function reloadArchitectureResourceAction(input: {
  readonly busy: boolean
  readonly scope: ArchitectureResourceActionScope
  readonly cache: ArchitectureResourceQueryCache
  readonly synchronizer: ArchitectureResourceActionSynchronizer
  readonly setBusy: (busy: boolean) => void
  readonly clearPendingOverlay: (resourceID: string) => void
  readonly bumpLiveInstanceVersion: (resourceID: string) => void
  readonly debug: (event: ArchitectureRuntimeDebugEvent) => void
  readonly onError: (error: ArchitectureResourceActionError) => void
}): Promise<ArchitectureResourceActionResult> {
  const id = input.scope.resourceID
  if (input.busy) return { ok: false }
  const scopeQueries = input.cache.scope({ server: input.scope.server, directory: input.scope.directory })
  input.setBusy(true)
  input.debug(architectureReloadStartedDebugEvent(id))
  try {
    await input.synchronizer.invalidate()
    const reloaded = await reloadArchitectureResourceInstance(input.scope.api, input.scope.directory, id)
    batch(() => {
      scopeQueries.replaceSavedResource(reloaded.snapshot)
      input.clearPendingOverlay(id)
      input.bumpLiveInstanceVersion(id)
    })
    void input.synchronizer.adopt(null).catch(() => undefined)
    input.debug(
      architectureSnapshotDebugEvent({ resourceID: id, type: "reload", status: "succeeded", snapshot: reloaded.snapshot }),
    )
    return { ok: true, resource: reloaded.snapshot }
  } catch (error) {
    input.debug(architectureFailedDebugEvent({ resourceID: id, type: "reload" }))
    input.onError({ action: "reload", resourceID: id, error })
    return { ok: false }
  } finally {
    input.setBusy(false)
  }
}

export async function createArchitectureResourceAction(input: {
  readonly busy: boolean
  readonly persistedReady: boolean
  readonly scope: ArchitectureResourceWorkspaceActionScope
  readonly cache: ArchitectureResourceQueryCache
  readonly name: string
  readonly setBusy: (busy: boolean) => void
  readonly setSelectedID: (resourceID: string | undefined) => void
  readonly onError: (error: ArchitectureResourceActionError) => void
}): Promise<ArchitectureResourceActionResult> {
  if (input.busy || !input.persistedReady) return { ok: false }
  const scopeQueries = input.cache.scope({ server: input.scope.server, directory: input.scope.directory })
  input.setBusy(true)
  try {
    const created = await createArchitectureResource(input.scope.api, input.scope.directory, { name: input.name })
    batch(() => {
      scopeQueries.replaceSavedResource(created)
      input.setSelectedID(created.resource.id)
    })
    return { ok: true, resource: created }
  } catch (error) {
    input.onError({ action: "create", error })
    return { ok: false }
  } finally {
    input.setBusy(false)
  }
}

export async function duplicateArchitectureResourceAction(input: {
  readonly change: ArchitectureInstanceChange
  readonly busy: boolean
  readonly persistedReady: boolean
  readonly currentServer: string
  readonly currentDirectory: string
  readonly scope: ArchitectureResourceActionScope
  readonly cache: ArchitectureResourceQueryCache
  readonly name: string
  readonly setBusy: (busy: boolean) => void
  readonly setSelectedID: (resourceID: string | undefined) => void
  readonly onError: (error: ArchitectureResourceActionError) => void
}): Promise<ArchitectureResourceActionResult> {
  const id = architectureInstanceResourceID(input.change)
  if (input.busy || !input.persistedReady) return { ok: false }
  if (input.change.server !== input.currentServer || input.change.directory !== input.currentDirectory) return { ok: false }
  const scopeQueries = input.cache.scope({ server: input.scope.server, directory: input.scope.directory })
  input.setBusy(true)
  try {
    const created = await createArchitectureResource(input.scope.api, input.scope.directory, { name: input.name })
    const patched = await updateArchitectureResourceInstance(
      input.scope.api,
      input.scope.directory,
      created,
      reconcileArchitectureInstanceChange(created.resource, input.change.resource),
    )
    if (!patched) throw new Error("Architecture instance patch did not return a live instance")
    const copy = await commitArchitectureResourceInstance(input.scope.api, input.scope.directory, patched.snapshot)
    batch(() => {
      scopeQueries.replaceSavedResource(copy)
      input.setSelectedID(copy.resource.id)
    })
    return { ok: true, resource: copy }
  } catch (error) {
    input.onError({ action: "duplicate", resourceID: id, error })
    return { ok: false }
  } finally {
    input.setBusy(false)
  }
}

export async function removeArchitectureResourceAction(input: {
  readonly snapshot: ArchitectureSnapshot
  readonly busy: boolean
  readonly scope: ArchitectureResourceActionScope
  readonly cache: ArchitectureResourceQueryCache
  readonly getSelectedID: () => string | undefined
  readonly setSelectedID: (resourceID: string | undefined) => void
  readonly getPendingOverlay: (resourceID: string) => ArchitecturePendingOverlay | undefined
  readonly setPendingOverlay: (resourceID: string, pending: ArchitecturePendingOverlay | undefined) => void
  readonly getViewport: (resourceID: string) => ArchitectureViewport | undefined
  readonly setViewport: (resourceID: string, viewport: ArchitectureViewport | undefined) => void
  readonly setBusy: (busy: boolean) => void
  readonly setRemovedResourceID: (resourceID: string, removed: true | undefined) => void
  readonly onError: (error: ArchitectureResourceActionError) => void
}): Promise<ArchitectureResourceActionResult> {
  const id = input.snapshot.resource.id
  if (input.busy) return { ok: false }
  const scopeQueries = input.cache.scope({ server: input.scope.server, directory: input.scope.directory })
  const previousSelectedID = input.getSelectedID()
  const previousPending = input.getPendingOverlay(id)
  const previousViewport = input.getViewport(id)
  const previousLive = scopeQueries.getLiveInstance(id)
  batch(() => {
    input.setBusy(true)
    input.setRemovedResourceID(id, true)
    scopeQueries.removeResource(id)
    input.setPendingOverlay(id, undefined)
    input.setViewport(id, undefined)
    input.setSelectedID(undefined)
  })
  try {
    await removeArchitectureResource(input.scope.api, input.scope.directory, input.snapshot)
    scopeQueries.refetchResources()
    return { ok: true, resource: input.snapshot }
  } catch (error) {
    batch(() => {
      input.setRemovedResourceID(id, undefined)
      scopeQueries.setResourceSummary(input.snapshot)
      input.setPendingOverlay(id, previousPending)
      if (previousLive === undefined) scopeQueries.clearLiveInstance(id)
      if (previousLive !== undefined) scopeQueries.setLiveInstance(id, previousLive)
      input.setViewport(id, previousViewport)
      input.setSelectedID(previousSelectedID)
    })
    input.onError({ action: "remove", resourceID: id, error })
    return { ok: false }
  } finally {
    input.setBusy(false)
  }
}
