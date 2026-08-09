import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { ArchitectureRoot } from "@opencode-ai/core/architecture/root"
import {
  ArchitectureConflictError,
  ArchitectureInvalidGraphError,
  ArchitectureNotFoundError,
  ArchitectureUnavailableError,
} from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const ArchitectureHandler = HttpApiBuilder.group(Api, "server.architecture", (handlers) =>
  Effect.succeed(
    handlers
      .handle("architecture.resource.list", () =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.list()))),
      )
      .handle("architecture.resource.create", (ctx) =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.create(ctx.payload)))),
      )
      .handle("architecture.resource.get", (ctx) =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.load(ctx.params.resourceID)))),
      )
      .handle("architecture.resource.patch", (ctx) =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.patch(ctx.params.resourceID, ctx.payload)))),
      )
      .handle("architecture.resource.remove", (ctx) =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.remove(ctx.params.resourceID, ctx.payload)))),
      )
      .handle("architecture.resource.reset", (ctx) =>
        response(ArchitectureGraph.Service.use((graph) => mapError(graph.reset(ctx.params.resourceID)))),
      ),
  ),
)

function mapError<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.mapError((error) => {
      if (error instanceof ArchitecturePatch.NotFoundError)
        return new ArchitectureNotFoundError({
          entity: error.entity,
          id: error.id,
          message: `${error.entity} not found: ${error.id}`,
        })
      if (error instanceof ArchitecturePatch.ConflictError)
        return new ArchitectureConflictError({ message: error.message, operationIDs: error.operationIDs })
      if (error instanceof ArchitectureGraph.ConflictError)
        return new ArchitectureConflictError({
          message: error.message,
          operationIDs: [],
          expectedRevision: error.expectedRevision,
          expectedDigest: error.expectedDigest,
          currentRevision: error.currentRevision,
          currentDigest: error.currentDigest,
        })
      if (error instanceof ArchitecturePatch.InvalidGraphError)
        return new ArchitectureInvalidGraphError({ message: error.message })
      if (error instanceof ArchitectureGraph.UnsupportedVersionError)
        return new ArchitectureInvalidGraphError({
          message: `Unsupported architecture resource version: ${error.version}`,
          version: error.version,
        })
      if (error instanceof ArchitectureRoot.ResolveError)
        return new ArchitectureUnavailableError({ message: error.message })
      if (error instanceof ArchitectureGraph.StorageError)
        return new ArchitectureUnavailableError({ message: error.message })
      return new ArchitectureUnavailableError({ message: "Graph editor resources are temporarily unavailable" })
    }),
  )
}
