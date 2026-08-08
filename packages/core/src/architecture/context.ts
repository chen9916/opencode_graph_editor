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

const emptySummary = "No Architecture graph resources exist yet."
const baseline = (value: typeof Value.Type) =>
  [
    "Architecture graphs are lightweight communication artifacts shared by people and AI, not generated implementation truth. Preserve their authored meaning.",
    "When the user asks to create an architecture graph or design, use the Architecture graph tools to create a managed graph resource.",
    'An @ mention matching a graph name (for example, "@Graph 2") directly references the Architecture resource whose name and exact managed path are shown below. Use that exact resource ID/path with the Architecture tools; do not search ordinary project files, code symbols, or scene/node trees for that display name.',
    "When the user mentions one or more graphs, use only those named resources unless they explicitly ask to compare additional graphs.",
    "To modify a mentioned graph, use the Architecture graph tools with its resource ID; do not inspect the JSON schema or installed OpenCode internals before making normal node and connection edits.",
    "When creating or reorganizing a graph, plan a readable layout before editing: place nodes in spaced layers or clusters, avoid default-origin stacks, and keep related groups visually separated.",
    "Use the durable routing controls available to agents: node positions plus connection sourceHandle/targetHandle sides (top, right, bottom, left). Vary sides for fan-out, feedback, and cross-cluster links so wires do not stack, cross, or overlap unnecessarily.",
    value.summary,
  ].join("\n")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const graph = yield* ArchitectureGraph.Service
    const registry = yield* SystemContextRegistry.Service
    yield* registry.register({
      key: SystemContext.Key.make("architecture/registration"),
      load: graph.list().pipe(
        Effect.flatMap((resources) => {
          const value = (summary: string) => ({
            resources: resources.map((resource) => ({
              id: resource.id,
              revision: resource.revision,
              digest: resource.digest,
            })),
            summary,
          })
          return (resources.length === 0 ? Effect.succeed(emptySummary) : graph.context()).pipe(
            Effect.map((summary) =>
              SystemContext.make({
                key: SystemContext.Key.make("architecture/resources"),
                codec: Schema.toCodecJson(Value),
                load: Effect.succeed(value(summary)),
                baseline,
                update: (_previous, value) => `The project's architecture graphs changed:\n${value.summary}`,
                removed: () => "Architecture graph context is unavailable.",
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
