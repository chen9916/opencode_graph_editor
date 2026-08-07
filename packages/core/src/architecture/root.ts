export * as ArchitectureRoot from "./root"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Location } from "../location"
import { AbsolutePath } from "../schema"

export class ResolveError extends Schema.TaggedErrorClass<ResolveError>()("ArchitectureRoot.ResolveError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Info {
  readonly root: AbsolutePath
  readonly directory: AbsolutePath
  readonly resources: AbsolutePath
  readonly legacyFile: AbsolutePath
}

export interface Interface {
  readonly get: Effect.Effect<Info, ResolveError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ArchitectureRoot") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const location = yield* Location.Service
    const get = Effect.fn("ArchitectureRoot.get")(function* () {
      const repository = yield* git.repo.discover(location.directory)
      const root = repository
        ? yield* git.worktree.list(repository).pipe(
            Effect.map((worktrees) => worktrees.find((worktree) => worktree.kind === "main")?.directory),
            Effect.mapError(
              (cause) => new ResolveError({ message: "Unable to resolve the primary Git worktree", cause }),
            ),
            Effect.flatMap((directory) =>
              directory
                ? Effect.succeed(directory)
                : new ResolveError({ message: "The primary Git worktree is unavailable" }),
            ),
          )
        : location.directory
      const canonical = AbsolutePath.make(yield* fs.resolve(root))
      const directory = AbsolutePath.make(path.join(canonical, ".opencode", "architecture"))
      return {
        root: canonical,
        directory,
        resources: AbsolutePath.make(path.join(directory, "resources")),
        legacyFile: AbsolutePath.make(path.join(directory, "graph.json")),
      }
    })
    return Service.of({ get: get() })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, Git.node, FSUtil.node] })
