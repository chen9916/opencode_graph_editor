import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitectureBatch } from "@opencode-ai/core/architecture/batch"
import { ArchitectureConflict } from "@opencode-ai/core/architecture/conflict"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { ArchitectureLayout } from "@opencode-ai/core/architecture/layout"
import { ArchitectureTools } from "@opencode-ai/core/architecture/tools"
import { ArchitectureValidation } from "@opencode-ai/core/architecture/validation"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "./tool"
import { graphLocation } from "./graph-location"

const root = ".opencode/architecture/resources"
const ExpectedDigest = Schema.String.pipe(Schema.optional)
const MutationMetadata = Schema.Struct({
  resourceID: Architecture.ResourceID,
  revision: NonNegativeInt,
  digest: Schema.String,
})

const DeleteResourceInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  expectedDigest: Schema.String,
})
const ReloadResourceInput = Schema.Struct({ resourceID: Architecture.ResourceID })
const SaveResourceInput = Schema.Struct({ resourceID: Architecture.ResourceID, expectedDigest: ExpectedDigest })
const UpdateResourceInput = Schema.Struct({ resourceID: Architecture.ResourceID, name: Schema.NonEmptyString })
const GetContextInput = Schema.Struct({ resourceIDs: Schema.Array(Architecture.ResourceID).pipe(Schema.optional) })
const CreateNodeInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  id: Architecture.NodeID.pipe(Schema.optional),
  text: Schema.NonEmptyString,
  tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
  position: Architecture.Position.pipe(Schema.optional),
})
const UpdateNodeInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  nodeID: Architecture.NodeID,
  expectedDigest: ExpectedDigest,
  text: Schema.NonEmptyString.pipe(Schema.optional),
  tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
  position: Architecture.Position.pipe(Schema.optional),
})
const SetTagColorInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  tag: Architecture.Tag,
  color: Architecture.TagColor.pipe(Schema.optional),
})
const DeleteNodeInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  nodeID: Architecture.NodeID,
  expectedDigest: ExpectedDigest,
  cascade: Schema.Boolean,
})
const ConnectNodesInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  id: Architecture.EdgeID.pipe(Schema.optional),
  source: Architecture.NodeID,
  target: Architecture.NodeID,
  sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  style: Architecture.EdgeStyle.pipe(Schema.optional),
})
const UpdateConnectionInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  edgeID: Architecture.EdgeID,
  expectedDigest: ExpectedDigest,
  source: Architecture.NodeID.pipe(Schema.optional),
  target: Architecture.NodeID.pipe(Schema.optional),
  sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  style: Architecture.EdgeStyle.pipe(Schema.optional),
})
const UpdateLayoutInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  nodes: Schema.Array(
    Schema.Struct({
      nodeID: Architecture.NodeID,
      position: Architecture.Position,
    }),
  ).pipe(Schema.optional),
  edges: Schema.Array(
    Schema.Struct({
      edgeID: Architecture.EdgeID,
      sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
      targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
      style: Architecture.EdgeStyle.pipe(Schema.optional),
    }),
  ).pipe(Schema.optional),
})
const DisconnectNodesInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  edgeID: Architecture.EdgeID,
  expectedDigest: ExpectedDigest,
})

type Metadata = {
  resourceID?: Architecture.ResourceID
  revision?: number
  digest?: string
  count?: number
  source?: ArchitectureGraph.Source
  saved?: boolean
}

export const GraphTools = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service

  const withGraph = <A, E>(use: (graph: ArchitectureGraph.Interface) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      return yield* ArchitectureGraph.Service.use(use).pipe(
        Effect.provide(locations.get(graphLocation(instance.directory))),
      )
    })

  const authorize = (
    ctx: Tool.Context,
    action: "read" | "edit",
    resourceID?: Architecture.ResourceID,
  ) => {
    const resource = resourceID ? `${root}/${resourceID}.json` : root
    return ctx.ask({
      permission: action,
      patterns: [resource],
      always: [resource],
      metadata: {},
    })
  }

  return yield* Effect.all([
    graphTool(ArchitectureTools.names.listResources, {
      description:
        "List saved Graph editor resources, including the resource IDs that correspond to @graph mentions.",
      parameters: Schema.Struct({}),
      execute: (_input, ctx) =>
        authorize(ctx, "read").pipe(
          Effect.andThen(withGraph((graph) => graph.listLive())),
          Effect.map((output) => json("Graph resources", output.resources, { count: output.resources.length, source: output.source })),
        ),
    }),
    graphTool(ArchitectureTools.names.createResource, {
      description: "Create a named Graph editor resource as a lightweight shared communication artifact.",
      parameters: Architecture.ResourceCreateInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.id).pipe(
          Effect.andThen(withGraph((graph) => graph.create(input))),
          Effect.map((output) =>
            json(`Created graph resource ${output.resource.id}`, output, snapshotMetadata(output)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.reloadResource, {
      description: "Reload one managed Graph editor resource from the saved graph file by resourceID.",
      parameters: ReloadResourceInput,
      execute: (input, ctx) =>
        authorize(ctx, "read", input.resourceID).pipe(
          Effect.andThen(withGraph((graph) => graph.reloadSaved(input.resourceID))),
          Effect.map((output) =>
            json(
              `Graph resource ${output.snapshot.resource.id}`,
              { path: `${root}/${output.snapshot.resource.id}.json`, ...output.snapshot, source: output.source },
              snapshotMetadata(output.snapshot, output.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.saveResource, {
      description:
        "Commit one managed Graph editor resource's current live draft to saved storage. This is the explicit Save boundary; if no live draft exists, it returns the saved snapshot without writing.",
      parameters: SaveResourceInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadDraft(input.resourceID)
                if (current.source === "saved") return { snapshot: current.snapshot, source: current.source, saved: false }
                if (input.expectedDigest !== undefined && current.snapshot.digest !== input.expectedDigest)
                  return yield* Effect.fail(
                    conflictError(
                      ArchitectureConflict.make({
                        resourceID: input.resourceID,
                        resourceName: current.snapshot.resource.name,
                        operation: ArchitectureTools.names.saveResource,
                        expected: { digest: input.expectedDigest },
                        actual: { revision: current.snapshot.resource.revision, digest: current.snapshot.digest },
                        safeToRetry: "unknown",
                      }),
                    ),
                  )
                return {
                  snapshot: yield* graph.commitDraft(input.resourceID, {
                    revision: current.snapshot.resource.revision,
                    digest: current.snapshot.digest,
                  }, conflict(ArchitectureTools.names.saveResource, "unknown")),
                  source: "saved" as const,
                  saved: true,
                }
              }),
            ),
          ),
          Effect.map((output) =>
            json(
              output.saved ? `Saved graph resource ${output.snapshot.resource.id}` : `Graph resource ${output.snapshot.resource.id} already saved`,
              { ...output.snapshot, source: output.source, saved: output.saved },
              { ...snapshotMetadata(output.snapshot, output.source), saved: output.saved },
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.updateResource, {
      description: "Rename one Graph editor resource.",
      parameters: UpdateResourceInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                return yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "resource.update",
                      name: input.name,
                    },
                  ],
                }, conflict(ArchitectureTools.names.updateResource, true))
              }),
            ),
          ),
          Effect.map((output) =>
            json(
              `Renamed graph resource ${output.snapshot.resource.id}`,
              sourcedSnapshot(output),
              snapshotMetadata(output.snapshot, output.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.deleteResource, {
      description: "Delete a Graph editor resource only when explicitly requested.",
      parameters: DeleteResourceInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.load(input.resourceID)
                if (current.digest !== input.expectedDigest)
                  return yield* Effect.fail(
                    conflictError(
                      ArchitectureConflict.make({
                        resourceID: input.resourceID,
                        resourceName: current.resource.name,
                        operation: ArchitectureTools.names.deleteResource,
                        expected: { digest: input.expectedDigest },
                        actual: { revision: current.resource.revision, digest: current.digest },
                        safeToRetry: "unknown",
                      }),
                    ),
                  )
                yield* graph.remove(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                })
              }),
            ),
          ),
          Effect.as(text("Deleted graph resource", { resourceID: input.resourceID })),
        ),
    }),
    graphTool(ArchitectureTools.names.query, {
      description: "Query saved Graph editor resources by resource ID, node ID, text, or node tags.",
      parameters: Architecture.QueryInput,
      execute: (input, ctx) =>
        authorize(ctx, "read").pipe(
          Effect.andThen(withGraph((graph) => graph.queryLive(input))),
          Effect.map((output) =>
            json("Graph query", output, {
              count: output.nodes.length + output.edges.length,
              source: output.source,
            }),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.validate, {
      description:
        "Validate one or more managed Graph editor resources without mutating them. Check for broken edges, duplicate IDs, missing tag colors, empty node text, invalid handles or styles, overlapping nodes, and isolated nodes.",
      parameters: ArchitectureValidation.Input,
      execute: (input, ctx) =>
        authorize(ctx, "read").pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const selected = input.resourceIDs && input.resourceIDs.length > 0 ? Array.from(new Set(input.resourceIDs)) : undefined
                const snapshots = selected
                  ? yield* Effect.forEach(selected, (resourceID) => graph.loadLive(resourceID), { concurrency: 8 })
                  : yield* Effect.forEach(
                      (yield* graph.listLive()).resources,
                      (resource) => graph.loadLive(resource.id),
                      { concurrency: 8 },
                    )
                return {
                  output: ArchitectureValidation.validateResources(
                    snapshots.map((item) => ({ resource: item.snapshot.resource, digest: item.snapshot.digest })),
                    input.checks,
                  ),
                  source: mixedSource(snapshots.map((item) => item.source)),
                }
              }),
            ),
          ),
          Effect.map((result) =>
            json("Validated graph resources", result.output, { count: result.output.summary.totalIssues, source: result.source }),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.autoLayout, {
      description:
        "Reorganize one managed Graph editor resource into columns, grids, trees, or tag-group layouts. The tool computes new positions and saves them through the normal optimistic update path.",
      parameters: ArchitectureLayout.Input,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const referenced = new Set(ArchitectureLayout.referencedNodeIDs(input))
                const missing = [...referenced].find((nodeID) => !current.snapshot.resource.nodes.some((node) => node.id === nodeID))
                if (missing) return yield* new ArchitecturePatch.NotFoundError({ entity: "node", id: missing })
                const layout = ArchitectureLayout.plan(current.snapshot.resource, input)
                const operations = layout.positions
                  .filter((item) => {
                    const node = current.snapshot.resource.nodes.find((candidate) => candidate.id === item.nodeID)
                    return node && (node.layout.position.x !== item.position.x || node.layout.position.y !== item.position.y)
                  })
                  .map(
                    (item): Architecture.Operation => ({
                      id: Architecture.OperationID.create(),
                      type: "node.position",
                      nodeID: item.nodeID,
                      position: item.position,
                    }),
                  )
                const saved =
                  input.dryRun || operations.length === 0
                    ? current
                    : yield* graph.patchLive(
                        input.resourceID,
                        {
                          revision: current.snapshot.resource.revision,
                          digest: current.snapshot.digest,
                          operations,
                        },
                        { operation: ArchitectureTools.names.autoLayout, safeToRetry: true },
                      )
                return {
                  resourceID: input.resourceID,
                  revision: input.dryRun ? undefined : saved.snapshot.resource.revision,
                  digest: input.dryRun ? undefined : saved.snapshot.digest,
                  source: saved.source,
                  mode: input.mode,
                  dryRun: input.dryRun ?? false,
                  nodeIDs: layout.nodeIDs,
                  positions: layout.positions,
                }
              }),
            ),
          ),
          Effect.map((output) =>
            json(`Auto-laid out graph resource ${input.resourceID}`, output, {
              resourceID: input.resourceID,
              source: output.source,
              ...(input.dryRun ? {} : { revision: output.revision, digest: output.digest }),
            }),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.createNode, {
      description: "Create a text node with optional free-form tags in a managed graph resource.",
      parameters: CreateNodeInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const node: Architecture.Node = {
                  id: input.id ?? Architecture.NodeID.create(),
                  text: input.text,
                  tags: input.tags ?? [],
                  layout: { position: input.position ?? { x: 0, y: 0 } },
                }
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [{ id: Architecture.OperationID.create(), type: "node.create", node }],
                }, conflict(ArchitectureTools.names.createNode, "unknown"))
                return { saved, node }
              }),
            ),
          ),
          Effect.map(({ saved, node }) =>
            json(`Created graph node ${node.id}`, { ...mutation(saved.snapshot, saved.source), node }, snapshotMetadata(saved.snapshot, saved.source)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.batchEdit, {
      description:
        "Batch set tag colors and create or update many graph nodes and connections in one atomic edit. Use this when creating or revising several nodes, tags, or wires together.",
      parameters: ArchitectureBatch.Input,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const batch = ArchitectureBatch.prepare(input, current.snapshot.resource)
                if (!batch.ok) return yield* batch.error
                const saved =
                  batch.operations.length > 0
                    ? yield* graph.patchLive(input.resourceID, {
                        revision: current.snapshot.resource.revision,
                        digest: current.snapshot.digest,
                        operations: batch.operations,
                      }, conflict(ArchitectureTools.names.batchEdit, "partial"))
                    : current
                return {
                  ...mutation(saved.snapshot, saved.source),
                  createdNodeIDs: batch.createdNodeIDs,
                  updatedNodeIDs: batch.updatedNodeIDs,
                  createdEdgeIDs: batch.createdEdgeIDs,
                  updatedEdgeIDs: batch.updatedEdgeIDs,
                  updatedTagColors: batch.updatedTagColors,
                }
              }),
            ),
          ),
          Effect.map((output) =>
            json(`Batch edited graph ${input.resourceID}`, output, { ...output, count: batchCount(output) }),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.updateNode, {
      description: "Edit a node's text, tags, or position in a managed graph resource.",
      parameters: UpdateNodeInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const node = current.snapshot.resource.nodes.find((candidate) => candidate.id === input.nodeID)
                if (!node) return yield* new ArchitecturePatch.NotFoundError({ entity: "node", id: input.nodeID })
                const updated: Architecture.Node = {
                  ...node,
                  text: input.text ?? node.text,
                  tags: input.tags ?? node.tags,
                  layout: input.position ? { position: input.position } : node.layout,
                }
                const operation: Architecture.Operation =
                  input.text !== undefined || input.tags !== undefined
                    ? {
                        id: Architecture.OperationID.create(),
                        type: "node.update",
                        node: updated,
                        expectedDigest: input.expectedDigest,
                      }
                    : {
                        id: Architecture.OperationID.create(),
                        type: "node.position",
                        nodeID: node.id,
                        position: updated.layout.position,
                        expectedDigest: input.expectedDigest,
                      }
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [operation],
                }, conflict(ArchitectureTools.names.updateNode, true))
                return { saved, node: updated }
              }),
            ),
          ),
          Effect.map(({ saved, node }) =>
            json(`Updated graph node ${node.id}`, { ...mutation(saved.snapshot, saved.source), node }, snapshotMetadata(saved.snapshot, saved.source)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.setTagColor, {
      description: "Set or clear the display color for one free-form node tag in a managed graph resource.",
      parameters: SetTagColorInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "tag.color",
                      tag: input.tag,
                      color: input.color,
                    },
                  ],
                }, conflict(ArchitectureTools.names.setTagColor, true))
                return saved
              }),
            ),
          ),
          Effect.map((saved) =>
            json(
              input.color ? `Set graph tag ${input.tag} color to ${input.color}` : `Cleared graph tag ${input.tag} color`,
              { ...mutation(saved.snapshot, saved.source), tag: input.tag, color: input.color },
              snapshotMetadata(saved.snapshot, saved.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.deleteNode, {
      description: "Delete one graph node by ID. Cascade must be true when it has connections.",
      parameters: DeleteNodeInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const removedEdgeIDs = current.snapshot.resource.edges
                  .filter((edge) => edge.source === input.nodeID || edge.target === input.nodeID)
                  .map((edge) => edge.id)
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "node.remove",
                      nodeID: input.nodeID,
                      cascade: input.cascade,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                }, conflict(ArchitectureTools.names.deleteNode, "unknown"))
                return { saved, removedEdgeIDs }
              }),
            ),
          ),
          Effect.map(({ saved, removedEdgeIDs }) =>
            json(
              `Deleted graph node ${input.nodeID}`,
              { ...mutation(saved.snapshot, saved.source), nodeID: input.nodeID, removedEdgeIDs },
              snapshotMetadata(saved.snapshot, saved.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.connectNodes, {
      description: "Connect two nodes from explicit source and target sides in the same managed graph resource.",
      parameters: ConnectNodesInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const edge: Architecture.Edge = {
                  id: input.id ?? Architecture.EdgeID.create(),
                  source: input.source,
                  target: input.target,
                  sourceHandle: input.sourceHandle ?? "right",
                  targetHandle: input.targetHandle ?? "left",
                  style: input.style ?? "rectangular",
                }
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [{ id: Architecture.OperationID.create(), type: "edge.create", edge }],
                }, conflict(ArchitectureTools.names.connectNodes, "unknown"))
                return { saved, edge }
              }),
            ),
          ),
          Effect.map(({ saved, edge }) =>
            json(`Connected graph nodes with ${edge.id}`, { ...mutation(saved.snapshot, saved.source), edge }, snapshotMetadata(saved.snapshot, saved.source)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.updateConnection, {
      description: "Change a connection's nodes, exact source/target sides, or durable wire style.",
      parameters: UpdateConnectionInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const edge = current.snapshot.resource.edges.find((candidate) => candidate.id === input.edgeID)
                if (!edge) return yield* new ArchitecturePatch.NotFoundError({ entity: "edge", id: input.edgeID })
                const updated: Architecture.Edge = {
                  ...edge,
                  source: input.source ?? edge.source,
                  target: input.target ?? edge.target,
                  sourceHandle: input.sourceHandle ?? edge.sourceHandle ?? "right",
                  targetHandle: input.targetHandle ?? edge.targetHandle ?? "left",
                  style: input.style ?? edge.style ?? "rectangular",
                }
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "edge.update",
                      edge: updated,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                }, conflict(ArchitectureTools.names.updateConnection, "partial"))
                return { saved, edge: updated }
              }),
            ),
          ),
          Effect.map(({ saved, edge }) =>
            json(`Updated graph connection ${edge.id}`, { ...mutation(saved.snapshot, saved.source), edge }, snapshotMetadata(saved.snapshot, saved.source)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.updateLayout, {
      description: "Update graph visual layout by moving nodes and rerouting connections in one edit.",
      parameters: UpdateLayoutInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const nodeOperations = (input.nodes ?? []).map((item): Architecture.Operation => {
                  const node = current.snapshot.resource.nodes.find((candidate) => candidate.id === item.nodeID)
                  if (!node) throw new Error(`node not found: ${item.nodeID}`)
                  return {
                    id: Architecture.OperationID.create(),
                    type: "node.position",
                    nodeID: item.nodeID,
                    position: item.position,
                  }
                })
                const edgeOperations = (input.edges ?? []).map((item): Architecture.Operation => {
                  const edge = current.snapshot.resource.edges.find((candidate) => candidate.id === item.edgeID)
                  if (!edge) throw new Error(`edge not found: ${item.edgeID}`)
                  return {
                    id: Architecture.OperationID.create(),
                    type: "edge.update",
                    edge: {
                      ...edge,
                      sourceHandle: item.sourceHandle ?? edge.sourceHandle ?? "right",
                      targetHandle: item.targetHandle ?? edge.targetHandle ?? "left",
                      style: item.style ?? edge.style ?? "rectangular",
                    },
                  }
                })
                const operations = [...nodeOperations, ...edgeOperations]
                const saved =
                  operations.length > 0
                    ? yield* graph.patchLive(input.resourceID, {
                        revision: current.snapshot.resource.revision,
                        digest: current.snapshot.digest,
                        operations,
                      }, conflict(ArchitectureTools.names.updateLayout, true))
                    : current
                return {
                  saved,
                  nodeIDs: (input.nodes ?? []).map((item) => item.nodeID),
                  edgeIDs: (input.edges ?? []).map((item) => item.edgeID),
                }
              }),
            ),
          ),
          Effect.map(({ saved, nodeIDs, edgeIDs }) =>
            json(
              `Updated graph layout for ${input.resourceID}`,
              { ...mutation(saved.snapshot, saved.source), nodeIDs, edgeIDs },
              snapshotMetadata(saved.snapshot, saved.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.disconnectNodes, {
      description: "Delete one connection by edge ID from a named graph resource.",
      parameters: DisconnectNodesInput,
      execute: (input, ctx) =>
        authorize(ctx, "edit", input.resourceID).pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.gen(function* () {
                const current = yield* graph.loadLive(input.resourceID)
                const saved = yield* graph.patchLive(input.resourceID, {
                  revision: current.snapshot.resource.revision,
                  digest: current.snapshot.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "edge.remove",
                      edgeID: input.edgeID,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                }, conflict(ArchitectureTools.names.disconnectNodes, "unknown"))
                return saved
              }),
            ),
          ),
          Effect.map((saved) =>
            json(
              `Deleted graph connection ${input.edgeID}`,
              { ...mutation(saved.snapshot, saved.source), edgeID: input.edgeID },
              snapshotMetadata(saved.snapshot, saved.source),
            ),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.getContext, {
      description: "Return a bounded text summary of selected or all live Graph editor resources.",
      parameters: GetContextInput,
      execute: (input, ctx) =>
        authorize(ctx, "read").pipe(
          Effect.andThen(
            withGraph((graph) =>
              Effect.all({ output: graph.contextLive(input.resourceIDs), source: liveSource(graph, input.resourceIDs) }),
            ),
          ),
          Effect.map((result) => text("Graph context", { output: result.output, source: result.source })),
        ),
    }),
  ], { concurrency: "unbounded" })
})

function graphTool<Parameters extends Schema.Decoder<unknown>>(id: string, input: {
  description: string
  parameters: Parameters
  execute: (
    params: Schema.Schema.Type<Parameters>,
    ctx: Tool.Context<Metadata>,
  ) => Effect.Effect<Tool.ExecuteResult<Metadata>, unknown>
}) {
  return Tool.define(
    id,
    Effect.succeed({
      description: input.description,
      parameters: input.parameters,
      execute: (params: Schema.Schema.Type<Parameters>, ctx: Tool.Context<Metadata>) =>
        input.execute(params, ctx).pipe(Effect.orDie),
    }),
  )
}

function snapshotMetadata(snapshot: Architecture.ResourceSnapshot, source?: ArchitectureGraph.Source): Metadata {
  return {
    resourceID: snapshot.resource.id,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
    ...(source ? { source } : {}),
  }
}

function mutation(snapshot: Architecture.ResourceSnapshot, source: Exclude<ArchitectureGraph.Source, "mixed">): typeof MutationMetadata.Type & { source: Exclude<ArchitectureGraph.Source, "mixed"> } {
  return {
    resourceID: snapshot.resource.id,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
    source,
  }
}

function sourcedSnapshot(output: ArchitectureGraph.SourcedSnapshot) {
  return { ...output.snapshot, source: output.source }
}

function batchCount(output: typeof ArchitectureBatch.Output.Type) {
  return (
    output.createdNodeIDs.length +
    output.updatedNodeIDs.length +
    output.createdEdgeIDs.length +
    output.updatedEdgeIDs.length +
    output.updatedTagColors.length
  )
}

function json(title: string, value: unknown, metadata: Metadata = {}): Tool.ExecuteResult<Metadata> {
  return {
    title,
    metadata,
    output: JSON.stringify(value),
  }
}

function text(
  title: string,
  input: { output?: string; resourceID?: Architecture.ResourceID; source?: ArchitectureGraph.Source },
): Tool.ExecuteResult<Metadata> {
  return {
    title,
    metadata: { ...(input.resourceID ? { resourceID: input.resourceID } : {}), ...(input.source ? { source: input.source } : {}) },
    output: input.output ?? title,
  }
}

function liveSource(graph: ArchitectureGraph.Interface, ids?: ReadonlyArray<Architecture.ResourceID>) {
  return graph.listLive().pipe(
    Effect.map((output) => {
      const selected = ids && ids.length > 0 ? output.resources.filter((resource) => ids.includes(resource.id)) : output.resources
      return mixedSource(selected.map((resource) => resource.source))
    }),
  )
}

function mixedSource(sources: ReadonlyArray<Exclude<ArchitectureGraph.Source, "mixed">>): ArchitectureGraph.Source {
  if (sources.some((source) => source === "live") && sources.some((source) => source === "saved")) return "mixed"
  if (sources.some((source) => source === "live")) return "live"
  return "saved"
}

function conflict(operation: string, safeToRetry: ArchitectureConflict.SafeToRetry) {
  return { operation, safeToRetry }
}

function conflictError(details: ArchitectureConflict.Details) {
  return Object.assign(new Error(ArchitectureConflict.describe(details)), {
    conflict: ArchitectureConflict.payload(details),
  })
}
