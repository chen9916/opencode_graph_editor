export * as ArchitectureContext from "./context"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "../system-context"
import { SystemContextRegistry } from "../system-context/registry"
import { ArchitectureGraph } from "./graph"
import { ArchitecturePatch } from "./patch"

const Value = Schema.Struct({
  resources: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      revision: Schema.Int,
      digest: Schema.String,
    }),
  ),
  summary: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const graph = yield* ArchitectureGraph.Service
    const registry = yield* SystemContextRegistry.Service
    yield* registry.register({
      key: SystemContext.Key.make("architecture/registration"),
      load: graph.list().pipe(
        Effect.flatMap((resources) => {
          if (resources.length === 0) return Effect.succeed(SystemContext.empty)
          return graph.context().pipe(
            Effect.map((summary) =>
              SystemContext.make({
                key: SystemContext.Key.make("architecture/resources"),
                codec: Schema.toCodecJson(Value),
                load: Effect.succeed({
                  resources: resources.map((resource) => ({
                    id: resource.id,
                    revision: resource.revision,
                    digest: resource.digest,
                  })),
                  summary,
                }),
                baseline: (value) =>
                  [
                    "Architecture graphs are lightweight communication artifacts shared by people and AI, not generated implementation truth. Preserve their authored meaning.",
                    'An @ mention matching a graph name (for example, "@Graph 2") directly references the Architecture resource whose name is shown below. Resolve it here or with the Architecture tools; do not search ordinary project files, code symbols, or scene/node trees for that display name.',
                    "When the user mentions one or more graphs, use only those named resources unless they explicitly ask to compare additional graphs.",
                    value.summary,
                  ].join("\n"),
                update: (_previous, value) => `The project's architecture graphs changed:\n${value.summary}`,
                removed: () => "The project no longer has architecture graphs.",
              }),
            ),
          )
        }),
        Effect.catchIf(
          (error) =>
            error instanceof ArchitecturePatch.InvalidGraphError ||
            error instanceof ArchitectureGraph.UnsupportedVersionError,
          (error) =>
            Effect.succeed(
              SystemContext.make({
                key: SystemContext.Key.make("architecture/resource-warning"),
                codec: Schema.toCodecJson(Schema.String),
                load: Effect.succeed(error.message),
                baseline: (message) => `Architecture context is unavailable: ${message}`,
                update: (_previous, message) => `Architecture context remains unavailable: ${message}`,
                removed: () => "Architecture context is available again.",
              }),
            ),
        ),
        Effect.catch(() => Effect.succeed(SystemContext.empty)),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "architecture-context",
  layer,
  deps: [ArchitectureGraph.node, SystemContextRegistry.node],
})
