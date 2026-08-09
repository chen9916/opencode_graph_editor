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

const emptySummary = "No Graph editor resources exist yet."
const baseline = (value: typeof Value.Type) =>
  [
    "Graph editor resources are lightweight communication artifacts shared by people and AI, not generated implementation truth. Preserve their authored meaning.",
    "A bare @graph mention means the user is targeting OpenCode's Graph editor or its managed resources. Treat it as graph-editor intent, not a request for an external diagram, dependency scanner, or generic chart.",
    "When the user asks to create a graph or design, use the graph_* tools to create a managed graph resource.",
    'An @ mention matching a graph name (for example, "@Graph 2") directly references the graph resource whose name and exact managed path are shown below. Use that exact resource ID/path with the graph_* tools; do not search ordinary project files, code symbols, or scene/node trees for that display name.',
    "When the user mentions one or more graphs, use only those named resources unless they explicitly ask to compare additional graphs.",
    "To modify a mentioned graph, use the graph_* tools with its resource ID; do not edit .opencode/architecture/resources/*.json directly and do not inspect installed OpenCode internals before making normal graph edits.",
    "If the current session does not expose graph_* tools, report that managed graph editing is unavailable in this session instead of editing graph JSON directly, unless the user explicitly asks for raw file edits.",
    "After modifying a graph, use graph_reload_resource when you need to inspect or report the latest saved graph state.",
    "Durable graph data has only these visual structure fields: node text, node tags, per-resource tagColors, node position, connection source, connection target, sourceHandle, targetHandle, and style. Do not invent JSON fields such as sourcePosition, targetPosition, type, status, or edge labels.",
    "Valid connection styles are rectangular, curved, and straight. For visual-clarity requests, prefer graph_update_layout so positions, handles, and styles change together in one graph edit.",
    "When creating or reorganizing a graph, plan a readable layout before editing: place nodes in spaced layers or clusters, avoid default-origin stacks, and keep related groups visually separated.",
    "Use node positions plus connection sourceHandle/targetHandle sides (top, right, bottom, left). Vary sides and styles for fan-out, feedback, and cross-cluster links so wires do not stack, cross, or overlap unnecessarily.",
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
                update: (_previous, value) => `The project's graph resources changed:\n${value.summary}`,
                removed: () => "Graph editor context is unavailable.",
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
                baseline: (message) => `Graph editor context is unavailable: ${message}`,
                update: (_previous, message) => `Graph editor context remains unavailable: ${message}`,
                removed: () => "Graph editor context is available again.",
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
