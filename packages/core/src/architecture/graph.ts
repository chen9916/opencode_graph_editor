export * as ArchitectureGraph from "./graph"

import { Architecture } from "@opencode-ai/schema/architecture"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { NonNegativeInt, RelativePath, optional } from "../schema"
import { EffectFlock } from "../util/effect-flock"
import { ArchitectureConflict } from "./conflict"
import { ArchitectureInstance } from "./instance"
import { ArchitecturePatch } from "./patch"
import { ArchitectureRoot } from "./root"

export const Resource = Architecture.Resource
export type Resource = Architecture.Resource
export const PatchInput = Architecture.PatchInput
export type PatchInput = Architecture.PatchInput

export class UnsupportedVersionError extends Schema.TaggedErrorClass<UnsupportedVersionError>()(
  "Architecture.UnsupportedVersionError",
  { version: Schema.String },
) {}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("Architecture.StorageError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("Architecture.GraphConflictError", {
  message: Schema.String,
  resourceID: Architecture.ResourceID,
  resourceName: Schema.String.pipe(optional),
  operation: Schema.String,
  expected: ArchitectureConflict.Expected.pipe(optional),
  actual: ArchitectureConflict.Actual,
  expectedRevision: Schema.Int.pipe(optional),
  currentRevision: Schema.Int,
  expectedDigest: Schema.String.pipe(optional),
  currentDigest: Schema.String,
  safeToRetry: ArchitectureConflict.SafeToRetry,
  conflictKind: ArchitectureConflict.Kind.pipe(optional),
  retryHint: Schema.String,
  operationIDs: Schema.Array(Architecture.OperationID),
}) {}

export type Error =
  | ArchitectureRoot.ResolveError
  | ArchitecturePatch.Error
  | UnsupportedVersionError
  | StorageError
  | ConflictError
  | EffectFlock.LockError

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Architecture.ResourceSummary>, Error>
  readonly listInstances: () => Effect.Effect<SourcedSummaries, Error>
  readonly create: (input: Architecture.ResourceCreateInput) => Effect.Effect<Architecture.ResourceSnapshot, Error>
  readonly duplicate: (
    id: Architecture.ResourceID,
    input: Architecture.ResourceDuplicateInput,
  ) => Effect.Effect<Architecture.ResourceSnapshot, Error>
  readonly load: (id: Architecture.ResourceID) => Effect.Effect<Architecture.ResourceSnapshot, Error>
  readonly loadInstance: (id: Architecture.ResourceID) => Effect.Effect<Architecture.LiveInstanceSnapshot, Error>
  readonly patchInstance: (
    id: Architecture.ResourceID,
    input: Architecture.PatchInput,
    conflict?: ConflictContext,
  ) => Effect.Effect<Architecture.LiveInstanceSnapshot, Error>
  readonly commitInstance: (
    id: Architecture.ResourceID,
    input: Architecture.LiveInstanceCommitInput,
    conflict?: ConflictContext,
  ) => Effect.Effect<Architecture.ResourceSnapshot, Error>
  readonly discardInstance: (id: Architecture.ResourceID) => Effect.Effect<Architecture.LiveInstanceSnapshot, Error>
  readonly reloadInstance: (id: Architecture.ResourceID) => Effect.Effect<Architecture.LiveInstanceSnapshot, Error>
  readonly remove: (
    id: Architecture.ResourceID,
    input: Architecture.ResourceRemoveInput,
    conflict?: ConflictContext,
  ) => Effect.Effect<void, Error>
  readonly reset: (id: Architecture.ResourceID) => Effect.Effect<Architecture.ResourceSnapshot, Error>
  readonly query: (input: Architecture.QueryInput) => Effect.Effect<Architecture.QueryResult, Error>
  readonly queryInstances: (input: Architecture.QueryInput) => Effect.Effect<SourcedQueryResult, Error>
  readonly context: (ids?: ReadonlyArray<Architecture.ResourceID>) => Effect.Effect<string, Error>
  readonly contextInstances: (ids?: ReadonlyArray<Architecture.ResourceID>) => Effect.Effect<string, Error>
}

export type Source = "live" | "saved" | "mixed"
export interface SourcedSnapshot {
  readonly snapshot: Architecture.ResourceSnapshot
  readonly source: Exclude<Source, "mixed">
}
export interface SourcedSummary extends Architecture.ResourceSummary {
  readonly source: Exclude<Source, "mixed">
}
export interface SourcedSummaries {
  readonly resources: ReadonlyArray<SourcedSummary>
  readonly source: Source
}
export interface SourcedQueryResult extends Architecture.QueryResult {
  readonly source: Source
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ArchitectureGraph") {}

type ConflictContext = {
  readonly operation?: string
  readonly safeToRetry?: ArchitectureConflict.SafeToRetry
}

const LegacyNode = Schema.Struct({
  id: Architecture.NodeID,
  name: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  description: Schema.String.pipe(optional),
  status: Schema.NonEmptyString,
  layout: Schema.Struct({ position: Architecture.Position }),
})

const LegacyEdge = Schema.Struct({
  id: Architecture.EdgeID,
  source: Architecture.NodeID,
  target: Architecture.NodeID,
})

const LegacyGraph = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  nodes: Schema.Array(LegacyNode),
  edges: Schema.Array(LegacyEdge),
})

const PreviousResource = Schema.Struct({
  version: Schema.Literal(2),
  revision: NonNegativeInt,
  id: Architecture.ResourceID,
  name: Schema.NonEmptyString,
  nodes: Schema.Array(LegacyNode),
  edges: Schema.Array(LegacyEdge),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const roots = yield* ArchitectureRoot.Service
    const flock = yield* EffectFlock.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const instances = yield* ArchitectureInstance.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)
    const decodeLegacy = Schema.decodeUnknownEffect(LegacyGraph)
    const decodePrevious = Schema.decodeUnknownEffect(PreviousResource)

    const file = (storage: ArchitectureRoot.Info, id: Architecture.ResourceID) =>
      path.join(storage.resources, `${id}.json`)
    const lockKey = (storage: ArchitectureRoot.Info) => path.join(storage.directory, "resources")
    const locked = <A, E, R>(storage: ArchitectureRoot.Info, effect: Effect.Effect<A, E, R>) =>
      locks.withLock(lockKey(storage))(flock.withLock(effect, lockKey(storage)))

    const parse = Effect.fn("ArchitectureGraph.parse")(function* (raw: string, source: string) {
      const value = yield* decodeJson(raw).pipe(
        Effect.mapError(
          (cause) =>
            new ArchitecturePatch.InvalidGraphError({
              message: `Graph resource ${source} is not valid JSON: ${cause}`,
            }),
        ),
      )
      const candidate = sanitizeResource(value)
      if (typeof candidate === "object" && candidate !== null && "version" in candidate && candidate.version !== 2)
        return yield* new UnsupportedVersionError({ version: String(candidate.version) })
      if (Schema.is(Architecture.Resource)(candidate)) return yield* ArchitecturePatch.validate(candidate)
      const resource = yield* decodePrevious(candidate).pipe(
        Effect.mapError(
          (cause) =>
            new ArchitecturePatch.InvalidGraphError({
              message: `Graph resource ${source} is invalid: ${cause}`,
            }),
        ),
      )
      return yield* ArchitecturePatch.validate(migrate(resource))
    })

    const legacy = Effect.fn("ArchitectureGraph.legacy")(function* (storage: ArchitectureRoot.Info) {
      const raw = yield* fs.readFileString(storage.legacyFile).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        Effect.mapError(
          (cause) => new StorageError({ operation: "read", message: "Unable to read legacy graph", cause }),
        ),
      )
      if (raw === undefined) return
      const value = yield* decodeJson(raw).pipe(
        Effect.mapError(
          (cause) =>
            new ArchitecturePatch.InvalidGraphError({
              message: `Legacy graph is not valid JSON: ${cause}`,
            }),
        ),
      )
      if (typeof value === "object" && value !== null && "version" in value && value.version !== 1)
        return yield* new UnsupportedVersionError({ version: String(value.version) })
      const graph = yield* decodeLegacy(value).pipe(
        Effect.mapError(
          (cause) => new ArchitecturePatch.InvalidGraphError({ message: `Legacy graph is invalid: ${cause}` }),
        ),
      )
      return yield* ArchitecturePatch.validate({
        version: 2,
        revision: graph.revision,
        id: Architecture.ResourceID.make("overview"),
        name: "Project architecture",
        nodes: graph.nodes.map(migrateNode),
        edges: graph.edges,
      })
    })

    const read = Effect.fn("ArchitectureGraph.read")(function* (
      storage: ArchitectureRoot.Info,
      id: Architecture.ResourceID,
    ) {
      const source = file(storage, id)
      const raw = yield* fs.readFileString(source).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        Effect.mapError(
          (cause) => new StorageError({ operation: "read", message: `Unable to read graph resource ${id}`, cause }),
        ),
      )
      if (raw !== undefined) return { resource: yield* parse(raw, id), source }
      if (id === "overview") {
        const resource = yield* legacy(storage)
        if (resource) return { resource, source: storage.legacyFile }
      }
      return yield* new ArchitecturePatch.NotFoundError({ entity: "resource", id })
    })

    const resourcePath = (resourceID: Architecture.ResourceID) => `.opencode/architecture/resources/${resourceID}.json`

    const snapshot = (storage: ArchitectureRoot.Info, resource: Architecture.Resource) => ({
      resource: ArchitecturePatch.normalize(resource),
      digest: ArchitecturePatch.digest(resource),
      storage: {
        root: storage.root,
        path: RelativePath.make(resourcePath(resource.id)),
      },
    })

    const summary = (resource: Architecture.Resource): Architecture.ResourceSummary => ({
      id: resource.id,
      name: resource.name,
      revision: resource.revision,
      digest: ArchitecturePatch.digest(resource),
      nodes: resource.nodes.length,
      edges: resource.edges.length,
    })

    const sourcedSummary = (resource: Architecture.Resource, source: Exclude<Source, "mixed">): SourcedSummary => ({
      ...summary(resource),
      source,
    })

    const publish = (value: Architecture.ResourceSnapshot) =>
      events
        .publish(
          Architecture.Event.ResourceUpdated,
          {
            resourceID: value.resource.id,
            revision: value.resource.revision,
            digest: value.digest,
          },
          {
            location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          },
        )
        .pipe(Effect.asVoid)

    const publishInstanceUpdated = (
      value: Architecture.ResourceSnapshot,
      base: { readonly revision: number; readonly digest: string },
    ) =>
      events
        .publish(
          Architecture.Event.ResourceInstanceUpdated,
          {
            resourceID: value.resource.id,
            revision: value.resource.revision,
            digest: value.digest,
            baseRevision: base.revision,
            baseDigest: base.digest,
          },
          {
            location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          },
        )
        .pipe(Effect.asVoid)

    const publishInstanceDiscarded = (value: Architecture.ResourceSnapshot) =>
      events
        .publish(
          Architecture.Event.ResourceInstanceDiscarded,
          {
            resourceID: value.resource.id,
            revision: value.resource.revision,
            digest: value.digest,
          },
          {
            location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          },
        )
        .pipe(Effect.asVoid)

    const write = Effect.fn("ArchitectureGraph.write")(function* (
      storage: ArchitectureRoot.Info,
      resource: Architecture.Resource,
      expected?: { readonly revision: number; readonly digest: string },
      conflict?: ConflictContext,
      settle?: Effect.Effect<void>,
    ) {
      const encoded = JSON.stringify(ArchitecturePatch.normalize(resource), null, 2) + "\n"
      const target = file(storage, resource.id)
      const temporary = path.join(storage.resources, `.${resource.id}.${process.pid}.${Date.now()}.tmp`)
      yield* fs
        .ensureDir(storage.resources)
        .pipe(
          Effect.mapError(
            (cause) => new StorageError({ operation: "mkdir", message: "Unable to create graph resources", cause }),
          ),
        )
      yield* fs.writeFileString(temporary, encoded, { flag: "wx" }).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              operation: "write",
              message: `Unable to save graph resource ${resource.id}`,
              cause,
            }),
        ),
        Effect.andThen(
          expected
            ? read(storage, resource.id).pipe(
                Effect.flatMap((current) => {
                  const currentDigest = ArchitecturePatch.digest(current.resource)
                  if (current.resource.revision === expected.revision && currentDigest === expected.digest)
                    return Effect.void
                  return graphConflict(
                    resource.id,
                    current.resource.name,
                    { revision: expected.revision, digest: expected.digest },
                    { revision: current.resource.revision, digest: currentDigest },
                    conflict,
                    "graph_patch",
                  )
                }),
              )
            : Effect.void,
        ),
        Effect.andThen(
          fs.rename(temporary, target).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: "write",
                  message: `Unable to save graph resource ${resource.id}`,
                  cause,
                }),
            ),
            Effect.andThen(settle ?? Effect.void),
            Effect.uninterruptible,
          ),
        ),
        Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
      )
      const result = snapshot(storage, resource)
      yield* publish(result)
      return result
    })

    const readAll = Effect.fn("ArchitectureGraph.readAll")(function* (storage: ArchitectureRoot.Info) {
      const entries = (yield* fs.glob("*.json", { cwd: storage.resources }).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])),
        Effect.mapError(
          (cause) => new StorageError({ operation: "list", message: "Unable to list graph resources", cause }),
        ),
      )).toSorted()
      if (entries.length === 0) {
        const resource = yield* legacy(storage)
        return resource ? [resource] : []
      }
      return yield* Effect.forEach(
        entries,
        (entry) =>
          fs.readFileString(path.join(storage.resources, entry)).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: "read",
                  message: `Unable to read graph resource ${entry}`,
                  cause,
                }),
            ),
            Effect.flatMap((raw) => parse(raw, entry)),
          ),
        { concurrency: 8 },
      )
    })

    const liveResource = Effect.fn("ArchitectureGraph.liveResource")(function* (
      storage: ArchitectureRoot.Info,
      saved: Architecture.Resource,
      source: Exclude<Source, "mixed"> = "saved",
    ) {
      const entry = yield* instances.get(saved.id)
      if (!entry) return { resource: saved, source }
      const savedDigest = ArchitecturePatch.digest(saved)
      if (entry.baseRevision === saved.revision && entry.baseDigest === savedDigest)
        return { resource: entry.resource, source: "live" as const }
      return yield* graphConflict(
        saved.id,
        saved.name,
        { revision: entry.baseRevision, digest: entry.baseDigest },
        { revision: saved.revision, digest: savedDigest },
        undefined,
        "graph_instance_load",
      )
    })

    const readLive = Effect.fn("ArchitectureGraph.readLive")(function* (
      storage: ArchitectureRoot.Info,
      id: Architecture.ResourceID,
    ) {
      const saved = (yield* read(storage, id)).resource
      return yield* liveResource(storage, saved)
    })

    const readAllLive = Effect.fn("ArchitectureGraph.readAllLive")(function* (storage: ArchitectureRoot.Info) {
      const resources = yield* readAll(storage)
      return yield* Effect.forEach(resources, (resource) => liveResource(storage, resource), { concurrency: 8 })
    })

    const migrateLegacy = Effect.fn("ArchitectureGraph.migrateLegacy")(function* (storage: ArchitectureRoot.Info) {
      if (yield* fs.existsSafe(file(storage, Architecture.ResourceID.make("overview")))) return
      const resource = yield* legacy(storage)
      if (resource) yield* write(storage, resource)
    })

    const list = Effect.fn("ArchitectureGraph.list")(function* () {
      return (yield* readAll(yield* roots.get)).map(summary).toSorted((a, b) => a.name.localeCompare(b.name))
    })

    const listInstances = Effect.fn("ArchitectureGraph.listInstances")(function* () {
      const resources = (yield* readAllLive(yield* roots.get))
        .map((item) => sourcedSummary(item.resource, item.source))
        .toSorted((a, b) => a.name.localeCompare(b.name))
      return { resources, source: mixedSource(resources.map((item) => item.source)) }
    })

    const create = Effect.fn("ArchitectureGraph.create")(function* (input: Architecture.ResourceCreateInput) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          yield* migrateLegacy(storage)
          const resource = ArchitecturePatch.empty(input)
          if (yield* fs.existsSafe(file(storage, resource.id)))
            return yield* new ArchitecturePatch.ConflictError({
              message: `Graph resource already exists: ${resource.id}`,
              operationIDs: [],
            })
          return yield* write(storage, resource)
        }),
      )
    })

    const duplicate = Effect.fn("ArchitectureGraph.duplicate")(function* (
      id: Architecture.ResourceID,
      input: Architecture.ResourceDuplicateInput,
    ) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          yield* migrateLegacy(storage)
          const source = (yield* readLive(storage, id)).resource
          const resource = yield* ArchitecturePatch.validate(
            ArchitecturePatch.normalize({
              version: 2,
              revision: 0,
              id: input.id ?? Architecture.ResourceID.create(),
              name: input.name ?? `${source.name} copy`,
              tagColors: source.tagColors,
              nodes: source.nodes,
              edges: source.edges,
            }),
          )
          if (yield* fs.existsSafe(file(storage, resource.id)))
            return yield* new ArchitecturePatch.ConflictError({
              message: `Graph resource already exists: ${resource.id}`,
              operationIDs: [],
            })
          return yield* write(storage, resource)
        }),
      )
    })

    const load = Effect.fn("ArchitectureGraph.load")(function* (id: Architecture.ResourceID) {
      const storage = yield* roots.get
      return snapshot(storage, (yield* read(storage, id)).resource)
    })

    const loadInstance = Effect.fn("ArchitectureGraph.loadInstance")(function* (id: Architecture.ResourceID) {
      const storage = yield* roots.get
      const current = yield* readLive(storage, id)
      return { snapshot: snapshot(storage, current.resource), source: current.source }
    })

    const patchInstance = Effect.fn("ArchitectureGraph.patchInstance")(function* (
      id: Architecture.ResourceID,
      input: Architecture.PatchInput,
      conflict?: ConflictContext,
    ) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          const saved = (yield* read(storage, id)).resource
          const savedDigest = ArchitecturePatch.digest(saved)
          const entry = yield* instances.get(id)
          if (entry && (entry.baseRevision !== saved.revision || entry.baseDigest !== savedDigest)) {
            return yield* graphConflict(
              id,
              saved.name,
              { revision: entry.baseRevision, digest: entry.baseDigest },
              { revision: saved.revision, digest: savedDigest },
              conflict,
              "graph_instance_patch",
            )
          }
          const current = entry?.resource ?? saved
          const currentDigest = ArchitecturePatch.digest(current)
          if (current.revision !== input.revision || currentDigest !== input.digest)
            return yield* graphConflict(
              id,
              current.name,
              { revision: input.revision, digest: input.digest },
              { revision: current.revision, digest: currentDigest },
              conflict,
              "graph_instance_patch",
            )
          const patched = yield* ArchitecturePatch.apply(current, input.operations).pipe(
            Effect.mapError((error) =>
              error instanceof ArchitecturePatch.ConflictError
                ? graphConflict(
                    id,
                    current.name,
                    { revision: input.revision, digest: input.digest },
                    { revision: current.revision, digest: currentDigest },
                    conflict,
                    "graph_instance_patch",
                    error.operationIDs,
                  )
                : error,
            ),
          )
          yield* instances.set(id, {
            baseRevision: entry?.baseRevision ?? saved.revision,
            baseDigest: entry?.baseDigest ?? savedDigest,
            resource: patched,
          })
          const result = snapshot(storage, patched)
          yield* publishInstanceUpdated(result, {
            revision: entry?.baseRevision ?? saved.revision,
            digest: entry?.baseDigest ?? savedDigest,
          })
          return { snapshot: result, source: "live" as const }
        }),
      )
    })

    const commitInstance = Effect.fn("ArchitectureGraph.commitInstance")(function* (
      id: Architecture.ResourceID,
      input: Architecture.LiveInstanceCommitInput,
      conflict?: ConflictContext,
    ) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          const saved = (yield* read(storage, id)).resource
          const savedDigest = ArchitecturePatch.digest(saved)
          const entry = yield* instances.get(id)
          if (!entry)
            return yield* graphConflict(
              id,
              saved.name,
              input,
              { revision: saved.revision, digest: savedDigest },
              conflict,
              "graph_instance_commit",
              [],
              "instance_missing",
            )
          const instanceDigest = ArchitecturePatch.digest(entry.resource)
          if (entry.resource.revision !== input.revision || instanceDigest !== input.digest)
            return yield* graphConflict(
              id,
              saved.name,
              input,
              { revision: entry.resource.revision, digest: instanceDigest },
              conflict,
              "graph_instance_commit",
              [],
              "instance_changed",
            )
          if (entry.baseRevision !== saved.revision || entry.baseDigest !== savedDigest) {
            return yield* graphConflict(
              id,
              saved.name,
              { revision: entry.baseRevision, digest: entry.baseDigest },
              { revision: saved.revision, digest: savedDigest },
              conflict,
              "graph_instance_commit",
            )
          }
          const result = yield* write(
            storage,
            { ...entry.resource, revision: saved.revision + 1 },
            { revision: entry.baseRevision, digest: entry.baseDigest },
            conflict,
            instances.remove(id),
          )
          yield* publishInstanceDiscarded(result)
          return result
        }),
      )
    })

    const discardInstance = Effect.fn("ArchitectureGraph.discardInstance")(function* (id: Architecture.ResourceID) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          const saved = snapshot(storage, (yield* read(storage, id)).resource)
          const entry = yield* instances.get(id)
          yield* instances.remove(id)
          if (entry) yield* publishInstanceDiscarded(saved)
          return { snapshot: saved, source: "saved" as const }
        }),
      )
    })

    const reloadInstance = Effect.fn("ArchitectureGraph.reloadInstance")(function* (id: Architecture.ResourceID) {
      return yield* discardInstance(id)
    })

    const remove = Effect.fn("ArchitectureGraph.remove")(function* (
      id: Architecture.ResourceID,
      input: Architecture.ResourceRemoveInput,
      conflict?: ConflictContext,
    ) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          const current = yield* read(storage, id)
          const currentDigest = ArchitecturePatch.digest(current.resource)
          if (current.resource.revision !== input.revision || currentDigest !== input.digest)
            return yield* graphConflict(
              id,
              current.resource.name,
              { revision: input.revision, digest: input.digest },
              { revision: current.resource.revision, digest: currentDigest },
              conflict,
              "graph_delete_resource",
            )
          yield* fs.remove(current.source).pipe(
            Effect.mapError(
              (cause) =>
                new StorageError({
                  operation: "remove",
                  message: `Unable to remove graph resource ${id}`,
                  cause,
                }),
            ),
            Effect.andThen(instances.remove(id)),
            Effect.uninterruptible,
          )
          yield* events.publish(
            Architecture.Event.ResourceRemoved,
            { resourceID: id },
            { location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }) },
          )
        }),
      )
    })

    const reset = Effect.fn("ArchitectureGraph.reset")(function* (id: Architecture.ResourceID) {
      const storage = yield* roots.get
      return yield* locked(
        storage,
        Effect.gen(function* () {
          const current = yield* read(storage, id).pipe(Effect.option)
          const source =
            current._tag === "Some"
              ? current.value.source
              : id === "overview" && (yield* fs.existsSafe(storage.legacyFile))
                ? storage.legacyFile
                : file(storage, id)
          const exists = yield* fs.existsSafe(source)
          yield* Effect.gen(function* () {
            if (exists) {
              yield* fs
                .ensureDir(storage.resources)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new StorageError({ operation: "mkdir", message: "Unable to create graph resources", cause }),
                  ),
                )
              yield* fs.rename(source, path.join(storage.resources, `${id}.invalid.${Date.now()}.json`)).pipe(
                Effect.mapError(
                  (cause) =>
                    new StorageError({
                      operation: "backup",
                      message: `Unable to preserve graph resource ${id}`,
                      cause,
                    }),
                ),
              )
            }
            yield* instances.remove(id)
          }).pipe(Effect.uninterruptible)
          return yield* write(
            storage,
            ArchitecturePatch.empty({
              id,
              name: current._tag === "Some" ? current.value.resource.name : id,
            }),
          )
        }),
      )
    })

    const query = Effect.fn("ArchitectureGraph.query")(function* (input: Architecture.QueryInput) {
      const selected = new Set(input.resourceIDs)
      const resources = (yield* readAll(yield* roots.get)).filter(
        (resource) => selected.size === 0 || selected.has(resource.id),
      )
      return queryResources(resources, input, summary)
    })

    const queryInstances = Effect.fn("ArchitectureGraph.queryInstances")(function* (input: Architecture.QueryInput) {
      const selected = new Set(input.resourceIDs)
      const resources = (yield* readAllLive(yield* roots.get)).filter(
        (item) => selected.size === 0 || selected.has(item.resource.id),
      )
      return {
        ...queryResources(
          resources.map((item) => item.resource),
          input,
          summary,
        ),
        source: mixedSource(resources.map((item) => item.source)),
      }
    })

    const context = Effect.fn("ArchitectureGraph.context")(function* (ids?: ReadonlyArray<Architecture.ResourceID>) {
      const selected = new Set(ids)
      const resources = (yield* readAll(yield* roots.get)).filter(
        (resource) => selected.size === 0 || selected.has(resource.id),
      )
      return formatContext(resources, resourcePath)
    })

    const contextInstances = Effect.fn("ArchitectureGraph.contextInstances")(function* (
      ids?: ReadonlyArray<Architecture.ResourceID>,
    ) {
      const selected = new Set(ids)
      const resources = (yield* readAllLive(yield* roots.get)).filter(
        (item) => selected.size === 0 || selected.has(item.resource.id),
      )
      const context = formatContext(
        resources.map((item) => item.resource),
        resourcePath,
      )
      if (context === "") return context
      return `Graph source: ${mixedSource(resources.map((item) => item.source))}\n${context}`
    })

    return Service.of({
      list,
      listInstances,
      create,
      duplicate,
      load,
      loadInstance,
      patchInstance,
      commitInstance,
      discardInstance,
      reloadInstance,
      remove,
      reset,
      query,
      queryInstances,
      context,
      contextInstances,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ArchitectureRoot.node, ArchitectureInstance.node, FSUtil.node, EffectFlock.node, EventV2.node, Location.node],
})

function migrate(resource: typeof PreviousResource.Type): Architecture.Resource {
  return {
    version: 2,
    revision: resource.revision,
    id: resource.id,
    name: resource.name,
    nodes: resource.nodes.map(migrateNode),
    edges: resource.edges,
  }
}

function migrateNode(node: typeof LegacyNode.Type): Architecture.Node {
  return {
    id: node.id,
    text: node.description ? `${node.name}\n\n${node.description}` : node.name,
    tags: Array.from(new Set([node.type, node.status])),
    layout: node.layout,
  }
}

function sanitizeResource(value: unknown) {
  if (value === null || typeof value !== "object" || !("version" in value) || value.version !== 2) return value
  const resource = value as Record<string, unknown>
  return {
    ...resource,
    tagColors: resource.tagColors,
    edges: Array.isArray(resource.edges) ? resource.edges.map(sanitizeEdge) : resource.edges,
  }
}

function formatTags(resource: Architecture.Resource, node: Architecture.Node) {
  if (node.tags.length === 0) return ""
  return ` [${node.tags
    .map((tag) => (resource.tagColors?.[tag] ? `${tag} ${resource.tagColors[tag]}` : tag))
    .join(", ")}]`
}

function sanitizeEdge(value: unknown) {
  if (value === null || typeof value !== "object") return value
  const edge = value as Record<string, unknown>
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: connectionSide(edge.sourceHandle) ?? connectionSide(edge.sourcePosition),
    targetHandle: connectionSide(edge.targetHandle) ?? connectionSide(edge.targetPosition),
    style: edgeStyle(edge.style) ?? edgeStyle(edge.type),
  }
}

function connectionSide(value: unknown) {
  if (value === "top" || value === "right" || value === "bottom" || value === "left") return value
  return undefined
}

function edgeStyle(value: unknown) {
  if (value === "rectangular" || value === "step" || value === "smoothstep") return "rectangular"
  if (value === "curved" || value === "default") return "curved"
  if (value === "straight") return "straight"
  return undefined
}

function mixedSource(sources: ReadonlyArray<Exclude<Source, "mixed">>): Source {
  if (sources.some((source) => source === "live") && sources.some((source) => source === "saved")) return "mixed"
  if (sources.some((source) => source === "live")) return "live"
  return "saved"
}

function queryResources(
  resources: ReadonlyArray<Architecture.Resource>,
  input: Architecture.QueryInput,
  summary: (resource: Architecture.Resource) => Architecture.ResourceSummary,
): Architecture.QueryResult {
  const text = input.text?.toLowerCase()
  const ids = new Set(input.nodeIDs)
  const tags = new Set(input.tags)
  const matches = (node: Architecture.Node) => {
    if (ids.size > 0 && !ids.has(node.id)) return false
    if (tags.size > 0 && !Array.from(tags).every((tag) => node.tags.includes(tag))) return false
    if (!text) return true
    return [node.id, node.text, ...node.tags].join("\n").toLowerCase().includes(text)
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const depth = Math.min(input.depth ?? 0, 5)
  const results = resources.map((resource) => {
    const matched = resource.nodes.filter(matches)
    const traversal = traverse(resource.edges, new Set(matched.slice(0, limit).map((node) => node.id)), depth, limit)
    return { resource, matched, traversal }
  })
  const nodes = results
    .flatMap((result) =>
      result.resource.nodes
        .filter((node) => result.traversal.included.has(node.id))
        .map((node) => ({ resourceID: result.resource.id, node })),
    )
    .slice(0, limit)
  const included = new Set(nodes.map((item) => `${item.resourceID}\0${item.node.id}`))
  return {
    resources: resources.map(summary),
    nodes,
    edges: results.flatMap((result) =>
      result.resource.edges
        .filter(
          (edge) =>
            included.has(`${result.resource.id}\0${edge.source}`) &&
            included.has(`${result.resource.id}\0${edge.target}`),
        )
        .map((edge) => ({ resourceID: result.resource.id, edge })),
    ),
    truncated:
      results.some((result) => result.matched.length > limit || result.traversal.truncated) ||
      results.reduce((count, result) => count + result.traversal.included.size, 0) > limit,
  }
}

function formatContext(
  resources: ReadonlyArray<Architecture.Resource>,
  resourcePath: (resourceID: Architecture.ResourceID) => string,
) {
  if (resources.length === 0) return ""
  return resources
    .slice(0, 20)
    .flatMap((resource) => {
      const tagColors = Object.entries(resource.tagColors ?? {})
        .slice(0, 50)
        .map(([tag, color]) => `- ${tag}: ${color}`)
      const nodes = resource.nodes
        .slice(0, 50)
        .map(
          (node) =>
            `- ${node.id}: ${node.text.replace(/\s+/g, " ")}${formatTags(resource, node)} (position: ${node.layout.position.x}, ${node.layout.position.y})`,
        )
      const edges = resource.edges
        .slice(0, 75)
        .map(
          (edge) =>
            `- ${edge.source}.${edge.sourceHandle ?? "right"} -> ${edge.target}.${edge.targetHandle ?? "left"} (style: ${edge.style ?? "curved"})`,
        )
      const compactMention = `@${resource.name.replace(/\s+/g, "")}`
      const lowerCompactMention = compactMention.toLowerCase()
      const aliases =
        compactMention === `@${resource.name}`
          ? ""
          : `; mention aliases: ${compactMention}${lowerCompactMention === compactMention ? "" : `, ${lowerCompactMention}`}`
      return [
        `Graph resource @${resource.name} (resource ID: ${resource.id}; path: ${resourcePath(resource.id)}${aliases}; revision ${resource.revision}; digest ${ArchitecturePatch.digest(resource).slice(0, 12)})`,
        ...(tagColors.length > 0 ? ["Tag colors:", ...tagColors] : []),
        ...(nodes.length > 0 ? ["Elements:", ...nodes] : []),
        ...(resource.nodes.length > nodes.length ? ["- additional elements omitted"] : []),
        ...(edges.length > 0 ? ["Relationships:", ...edges] : []),
        ...(resource.edges.length > edges.length ? ["- additional relationships omitted"] : []),
      ]
    })
    .join("\n")
}

function graphConflict(
  resourceID: Architecture.ResourceID,
  resourceName: string | undefined,
  expected: { readonly revision: number; readonly digest: string },
  actual: { readonly revision: number; readonly digest: string },
  conflict: ConflictContext | undefined,
  operation: string,
  operationIDs: ReadonlyArray<Architecture.OperationID> = [],
  conflictKind?: ArchitectureConflict.Kind,
) {
  const details = ArchitectureConflict.make({
    resourceID,
    resourceName,
    operation: conflict?.operation ?? operation,
    expected,
    actual,
    safeToRetry: conflict?.safeToRetry,
    conflictKind,
    operationIDs,
  })
  return new ConflictError({
    ...details,
    message: ArchitectureConflict.describe(details),
  })
}

function traverse(
  edges: ReadonlyArray<Architecture.Edge>,
  included: ReadonlySet<Architecture.NodeID>,
  depth: number,
  limit: number,
  frontier: ReadonlySet<Architecture.NodeID> = included,
  truncated = false,
): { readonly included: ReadonlySet<Architecture.NodeID>; readonly truncated: boolean } {
  if (depth === 0 || frontier.size === 0) return { included, truncated }
  const candidates = Array.from(
    new Set(
      edges.flatMap((edge) => {
        if (frontier.has(edge.source) && !included.has(edge.target)) return [edge.target]
        if (frontier.has(edge.target) && !included.has(edge.source)) return [edge.source]
        return []
      }),
    ),
  )
  const next = candidates.slice(0, Math.max(limit - included.size, 0))
  return traverse(
    edges,
    new Set([...included, ...next]),
    depth - 1,
    limit,
    new Set(next),
    truncated || next.length < candidates.length,
  )
}
