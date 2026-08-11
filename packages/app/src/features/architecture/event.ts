import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ArchitectureLiveInstance, ArchitectureResource, ArchitectureSnapshot } from "./contract"

export type ArchitectureResourceEvent = {
  readonly type: string
  readonly properties?: unknown
  readonly data?: unknown
}

export type ArchitectureResourceEventInfo = {
  readonly resourceID: string
  readonly revision?: number
  readonly digest?: string
}

export type ArchitectureResourceInstanceEventInfo = {
  readonly resourceID: string
  readonly action: "updated" | "discarded"
  readonly revision?: number
  readonly digest?: string
  readonly baseRevision?: number
  readonly baseDigest?: string
  readonly instance?: ArchitectureLiveInstance
}

type ArchitectureLocalSave = {
  readonly server: string
  readonly directory: string
  readonly resourceID: string
}

type ArchitectureLocalInstanceOperation = ArchitectureLocalSave & {
  readonly operation: "save" | "reload" | "patch"
}

type ArchitectureLocalSaveState = {
  count: number
  event?: ArchitectureResourceEventInfo
}

const localSaves = new Map<string, ArchitectureLocalSaveState>()
const localInstanceOperations = new Map<string, ArchitectureLocalInstanceOperationState>()
const localInstanceEchoes = new Map<string, ArchitectureLocalInstanceEchoState>()

export function beginArchitectureLocalSave(input: ArchitectureLocalSave) {
  const key = localSaveKey(input)
  const current = localSaves.get(key)
  localSaves.set(key, { count: (current?.count ?? 0) + 1, event: current?.event })
  let finished = false
  return () => {
    if (finished) return
    finished = true
    const state = localSaves.get(key)
    if (!state || state.count === 1) {
      localSaves.delete(key)
      return state?.event
    }
    localSaves.set(key, { ...state, count: state.count - 1 })
    return state.event
  }
}

export function isArchitectureLocalSaveEvent(input: {
  readonly server: string
  readonly directory: string
  readonly event: ArchitectureResourceEventInfo
}) {
  const key = localSaveKey({ server: input.server, directory: input.directory, resourceID: input.event.resourceID })
  const state = localSaves.get(key)
  if (!state) return false
  localSaves.set(key, { ...state, event: latestResourceEvent(state.event, input.event) })
  return true
}

export function beginArchitectureLocalInstanceOperation(input: ArchitectureLocalInstanceOperation) {
  const key = localSaveKey(input)
  const current = localInstanceOperations.get(key)
  localInstanceOperations.set(key, {
    count: (current?.count ?? 0) + 1,
    event: current?.event,
  })
  let finished = false
  return () => {
    if (finished) return
    finished = true
    const state = localInstanceOperations.get(key)
    if (!state || state.count === 1) {
      localInstanceOperations.delete(key)
      return state?.event
    }
    localInstanceOperations.set(key, { ...state, count: state.count - 1 })
    return state.event
  }
}

export function captureArchitectureLocalInstanceOperationEvent(input: {
  readonly server: string
  readonly directory: string
  readonly event: ArchitectureResourceInstanceEventInfo
}) {
  const key = localSaveKey({ server: input.server, directory: input.directory, resourceID: input.event.resourceID })
  const state = localInstanceOperations.get(key)
  if (state) {
    localInstanceOperations.set(key, { ...state, event: input.event })
    return true
  }
  return localInstanceEchoes.get(key)?.events.some((event) => sameInstanceEvent(event, input.event)) ?? false
}

export function getArchitectureLocalInstanceOperationEvent(input: ArchitectureLocalSave) {
  return localInstanceOperations.get(localSaveKey(input))?.event
}

export function rememberArchitectureLocalInstanceOperationEvent(input: {
  readonly server: string
  readonly directory: string
  readonly event: ArchitectureResourceInstanceEventInfo
}) {
  const key = localSaveKey({ server: input.server, directory: input.directory, resourceID: input.event.resourceID })
  const current = localInstanceEchoes.get(key)
  if (current) clearTimeout(current.timeout)
  const events = [input.event, ...(current?.events ?? [])].slice(0, 8)
  const timeout = setTimeout(() => localInstanceEchoes.delete(key), 5_000)
  unrefTimeout(timeout)
  localInstanceEchoes.set(key, { events, timeout })
}

export function architectureResourceEventInfo(
  event: ArchitectureResourceEvent,
): ArchitectureResourceEventInfo | undefined {
  if (event.type.startsWith("architecture.resource.instance.")) return
  if (!event.type.startsWith("architecture.resource.")) return
  const payload = architectureEventPayload(event)
  const resourceID = typeof payload?.resourceID === "string" ? payload.resourceID : undefined
  if (!resourceID) return
  const revision = typeof payload?.revision === "number" ? payload.revision : undefined
  const digest = typeof payload?.digest === "string" ? payload.digest : undefined
  return { resourceID, revision, digest }
}

export function architectureResourceInstanceEventInfo(
  event: ArchitectureResourceEvent,
): ArchitectureResourceInstanceEventInfo | undefined {
  if (!event.type.startsWith("architecture.resource.instance.")) return
  const action = event.type.slice("architecture.resource.instance.".length)
  if (action !== "updated" && action !== "discarded") return
  const payload = architectureEventPayload(event)
  const resourceID = typeof payload?.resourceID === "string" ? payload.resourceID : undefined
  if (!resourceID) return
  const revision = typeof payload?.revision === "number" ? payload.revision : undefined
  const digest = typeof payload?.digest === "string" ? payload.digest : undefined
  const baseRevision = typeof payload?.baseRevision === "number" ? payload.baseRevision : undefined
  const baseDigest = typeof payload?.baseDigest === "string" ? payload.baseDigest : undefined
  const instance = architectureEventInstance(payload)
  return {
    resourceID,
    action,
    ...(revision === undefined ? {} : { revision }),
    ...(digest === undefined ? {} : { digest }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(baseDigest === undefined ? {} : { baseDigest }),
    instance,
  }
}

export function architectureResourceInstanceEventCache(event: ArchitectureResourceInstanceEventInfo) {
  if (event.action === "discarded") return null
  return event.instance
}

export function architectureSummaryMatchesEvent(
  list: ArchitectureListResourcesOutput["data"] | undefined,
  event: ArchitectureResourceEventInfo,
) {
  if (event.revision === undefined || event.digest === undefined) return false
  return list?.some(
    (resource) =>
      resource.id === event.resourceID && resource.revision === event.revision && resource.digest === event.digest,
  )
}

export function architectureSnapshotMatchesEvent(
  snapshot: ArchitectureSnapshot | undefined,
  event: ArchitectureResourceEventInfo,
) {
  if (event.revision === undefined || event.digest === undefined) return false
  return (
    snapshot?.resource.id === event.resourceID &&
    snapshot.resource.revision === event.revision &&
    snapshot.digest === event.digest
  )
}

export function architectureSnapshotCoversEvent(
  snapshot: ArchitectureSnapshot | undefined,
  event: ArchitectureResourceEventInfo,
) {
  if (event.revision === undefined) return architectureSnapshotMatchesEvent(snapshot, event)
  if (snapshot?.resource.id !== event.resourceID) return false
  if (snapshot.resource.revision > event.revision) return true
  return architectureSnapshotMatchesEvent(snapshot, event)
}

export function architectureInstanceEventIsStale(
  snapshot: ArchitectureSnapshot | undefined,
  event: ArchitectureResourceInstanceEventInfo,
) {
  if (!snapshot || snapshot.resource.id !== event.resourceID) return false
  if (event.action === "updated") {
    if (event.baseRevision === undefined || event.baseDigest === undefined) return false
    if (snapshot.resource.revision > event.baseRevision) return true
    if (snapshot.resource.revision < event.baseRevision) return false
    return snapshot.digest !== event.baseDigest
  }
  if (event.revision === undefined || event.digest === undefined) return false
  if (snapshot.resource.revision > event.revision) return true
  if (snapshot.resource.revision < event.revision) return false
  return snapshot.digest !== event.digest
}

function architectureEventPayload(event: ArchitectureResourceEvent) {
  const properties = isRecord(event.properties) ? event.properties : undefined
  const data = isRecord(event.data) ? event.data : undefined
  if (!properties && !data) return
  return { ...(data ?? {}), ...(properties ?? {}) }
}

function architectureEventInstance(payload: Record<string, unknown> | undefined): ArchitectureLiveInstance | undefined {
  if (!payload) return
  const instance = isRecord(payload.instance) ? payload.instance : payload
  if (instance.source !== "live") return
  if (!isRecord(instance.snapshot)) return
  if (typeof instance.snapshot.digest !== "string") return
  if (!isRecord(instance.snapshot.storage)) return
  if (typeof instance.snapshot.storage.root !== "string") return
  if (typeof instance.snapshot.storage.path !== "string") return
  if (!isArchitectureResource(instance.snapshot.resource)) return
  return {
    source: "live",
    snapshot: {
      digest: instance.snapshot.digest,
      storage: { root: instance.snapshot.storage.root, path: instance.snapshot.storage.path },
      resource: instance.snapshot.resource,
    },
  }
}

function isArchitectureResource(value: unknown): value is ArchitectureResource {
  if (!isRecord(value)) return false
  if (typeof value.version !== "number") return false
  if (typeof value.revision !== "number") return false
  if (typeof value.id !== "string") return false
  if (typeof value.name !== "string") return false
  if (!Array.isArray(value.nodes)) return false
  return Array.isArray(value.edges)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function localSaveKey(input: ArchitectureLocalSave) {
  return `${input.server}\0${input.directory}\0${input.resourceID}`
}

type ArchitectureLocalInstanceOperationState = {
  count: number
  event?: ArchitectureResourceInstanceEventInfo
}

type ArchitectureLocalInstanceEchoState = {
  readonly events: ReadonlyArray<ArchitectureResourceInstanceEventInfo>
  readonly timeout: ReturnType<typeof setTimeout>
}

function latestResourceEvent(
  current: ArchitectureResourceEventInfo | undefined,
  next: ArchitectureResourceEventInfo,
) {
  if (current?.revision !== undefined && next.revision !== undefined && current.revision > next.revision) return current
  return next
}

function sameInstanceEvent(left: ArchitectureResourceInstanceEventInfo, right: ArchitectureResourceInstanceEventInfo) {
  if (left.resourceID !== right.resourceID || left.action !== right.action) return false
  if (left.revision === undefined || left.digest === undefined) return false
  return left.revision === right.revision && left.digest === right.digest
}

function unrefTimeout(timeout: ReturnType<typeof setTimeout>) {
  if (typeof timeout !== "object" || !timeout || !("unref" in timeout)) return
  const unref = timeout.unref
  if (typeof unref === "function") unref.call(timeout)
}
