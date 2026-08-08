import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import type { ArchitectureSnapshot } from "./contract"

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

type ArchitectureLocalSave = {
  readonly server: string
  readonly directory: string
  readonly resourceID: string
  readonly revision: number
}

const localSaves = new Map<string, number>()

export function beginArchitectureLocalSave(input: ArchitectureLocalSave) {
  const key = localSaveKey(input)
  localSaves.set(key, (localSaves.get(key) ?? 0) + 1)
  return () => {
    const count = localSaves.get(key)
    if (!count || count === 1) {
      localSaves.delete(key)
      return
    }
    localSaves.set(key, count - 1)
  }
}

export function isArchitectureLocalSaveEvent(input: {
  readonly server: string
  readonly directory: string
  readonly event: ArchitectureResourceEventInfo
}) {
  if (input.event.revision === undefined) return false
  return localSaves.has(
    localSaveKey({
      server: input.server,
      directory: input.directory,
      resourceID: input.event.resourceID,
      revision: input.event.revision,
    }),
  )
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

function architectureEventPayload(event: ArchitectureResourceEvent) {
  const value = event.properties ?? event.data
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

function localSaveKey(input: ArchitectureLocalSave) {
  return `${input.server}\0${input.directory}\0${input.resourceID}\0${input.revision}`
}
