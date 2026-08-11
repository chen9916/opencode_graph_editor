export * as ArchitectureInstance from "./instance"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"

export interface Entry {
  readonly baseRevision: number
  readonly baseDigest: string
  readonly resource: Architecture.Resource
}

export interface Interface {
  readonly get: (id: Architecture.ResourceID) => Effect.Effect<Entry | undefined>
  readonly list: () => Effect.Effect<ReadonlyArray<Entry>>
  readonly set: (id: Architecture.ResourceID, entry: Entry) => Effect.Effect<void>
  readonly remove: (id: Architecture.ResourceID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ArchitectureInstance") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const instances = new Map<Architecture.ResourceID, Entry>()
    return Service.of({
      get: (id) => Effect.sync(() => instances.get(id)),
      list: () => Effect.sync(() => Array.from(instances.values())),
      set: (id, entry) => Effect.sync(() => instances.set(id, entry)).pipe(Effect.asVoid),
      remove: (id) => Effect.sync(() => instances.delete(id)).pipe(Effect.asVoid),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
