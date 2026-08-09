import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ArchitectureLiveDraft, ArchitectureResource, ArchitectureSnapshot } from "./contract"

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

export type ArchitectureResourceDraftEventInfo = {
  readonly resourceID: string
  readonly action: "updated" | "discarded"
  readonly draft?: ArchitectureLiveDraft
}

type ArchitectureLocalSave = {
  readonly server: string
  readonly directory: string
  readonly resourceID: string
}

type ArchitectureLocalSaveState = {
  count: number
  event?: ArchitectureResourceEventInfo
}

const localSaves = new Map<string, ArchitectureLocalSaveState>()

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

export function architectureResourceEventInfo(
  event: ArchitectureResourceEvent,
): ArchitectureResourceEventInfo | undefined {
  if (!event.type.startsWith("architecture.resource.")) return
  const payload = architectureEventPayload(event)
  const resourceID = typeof payload?.resourceID === "string" ? payload.resourceID : undefined
  if (!resourceID) return
  const revision = typeof payload?.revision === "number" ? payload.revision : undefined
  const digest = typeof payload?.digest === "string" ? payload.digest : undefined
  return { resourceID, revision, digest }
}

export function architectureResourceDraftEventInfo(
  event: ArchitectureResourceEvent,
): ArchitectureResourceDraftEventInfo | undefined {
  if (!event.type.startsWith("architecture.resource.draft.")) return
  const action = event.type.slice("architecture.resource.draft.".length)
  if (action !== "updated" && action !== "discarded") return
  const payload = architectureEventPayload(event)
  const resourceID = typeof payload?.resourceID === "string" ? payload.resourceID : undefined
  if (!resourceID) return
  const draft = architectureEventDraft(payload)
  return { resourceID, action, draft }
}

export function architectureResourceDraftEventCache(event: ArchitectureResourceDraftEventInfo) {
  if (event.action === "discarded") return null
  return event.draft
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

function architectureEventPayload(event: ArchitectureResourceEvent) {
  const value = event.properties ?? event.data
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

function architectureEventDraft(payload: Record<string, unknown> | undefined): ArchitectureLiveDraft | undefined {
  if (!payload) return
  const draft = isRecord(payload.draft) ? payload.draft : payload
  if (draft.source !== "live") return
  if (!isRecord(draft.snapshot)) return
  if (typeof draft.snapshot.digest !== "string") return
  if (!isRecord(draft.snapshot.storage)) return
  if (typeof draft.snapshot.storage.root !== "string") return
  if (typeof draft.snapshot.storage.path !== "string") return
  if (!isArchitectureResource(draft.snapshot.resource)) return
  return {
    source: "live",
    snapshot: {
      digest: draft.snapshot.digest,
      storage: { root: draft.snapshot.storage.root, path: draft.snapshot.storage.path },
      resource: draft.snapshot.resource,
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

function latestResourceEvent(
  current: ArchitectureResourceEventInfo | undefined,
  next: ArchitectureResourceEventInfo,
) {
  if (current?.revision !== undefined && next.revision !== undefined && current.revision > next.revision) return current
  return next
}
