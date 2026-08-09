import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitectureBatch } from "@opencode-ai/core/architecture/batch"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { ArchitectureTools } from "@opencode-ai/core/architecture/tools"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath, NonNegativeInt } from "@opencode-ai/core/schema"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "./tool"

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
}

export const GraphTools = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service

  const withGraph = <A, E>(use: (graph: ArchitectureGraph.Interface) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const instance = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* ArchitectureGraph.Service.use(use).pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make(instance.directory),
              workspaceID,
            }),
          ),
        ),
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
          Effect.andThen(withGraph((graph) => graph.list())),
          Effect.map((output) => json("Graph resources", output, { count: output.length })),
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
      description: "Reload one managed Graph editor resource by resourceID.",
      parameters: ReloadResourceInput,
      execute: (input, ctx) =>
        authorize(ctx, "read", input.resourceID).pipe(
          Effect.andThen(withGraph((graph) => graph.load(input.resourceID))),
          Effect.map((output) =>
            json(`Graph resource ${output.resource.id}`, { path: `${root}/${output.resource.id}.json`, ...output }, snapshotMetadata(output)),
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
                const current = yield* graph.load(input.resourceID)
                return yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "resource.update",
                      name: input.name,
                    },
                  ],
                })
              }),
            ),
          ),
          Effect.map((output) => json(`Renamed graph resource ${output.resource.id}`, output, snapshotMetadata(output))),
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
                    new Error(
                      `Graph resource ${input.resourceID} changed: expected digest ${input.expectedDigest}, current revision ${current.resource.revision}, current digest ${current.digest}`,
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
          Effect.andThen(withGraph((graph) => graph.query(input))),
          Effect.map((output) =>
            json("Graph query", output, {
              count: output.nodes.length + output.edges.length,
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
                const current = yield* graph.load(input.resourceID)
                const node: Architecture.Node = {
                  id: input.id ?? Architecture.NodeID.create(),
                  text: input.text,
                  tags: input.tags ?? [],
                  layout: { position: input.position ?? { x: 0, y: 0 } },
                }
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [{ id: Architecture.OperationID.create(), type: "node.create", node }],
                })
                return { saved, node }
              }),
            ),
          ),
          Effect.map(({ saved, node }) =>
            json(`Created graph node ${node.id}`, { ...mutation(saved), node }, snapshotMetadata(saved)),
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
                const current = yield* graph.load(input.resourceID)
                const batch = ArchitectureBatch.prepare(input, current.resource)
                if (!batch.ok) return yield* batch.error
                const saved =
                  batch.operations.length > 0
                    ? yield* graph.patch(input.resourceID, {
                        revision: current.resource.revision,
                        digest: current.digest,
                        operations: batch.operations,
                      })
                    : current
                return {
                  ...mutation(saved),
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
                const current = yield* graph.load(input.resourceID)
                const node = current.resource.nodes.find((candidate) => candidate.id === input.nodeID)
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
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [operation],
                })
                return { saved, node: updated }
              }),
            ),
          ),
          Effect.map(({ saved, node }) =>
            json(`Updated graph node ${node.id}`, { ...mutation(saved), node }, snapshotMetadata(saved)),
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
                const current = yield* graph.load(input.resourceID)
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "tag.color",
                      tag: input.tag,
                      color: input.color,
                    },
                  ],
                })
                return saved
              }),
            ),
          ),
          Effect.map((saved) =>
            json(
              input.color ? `Set graph tag ${input.tag} color to ${input.color}` : `Cleared graph tag ${input.tag} color`,
              { ...mutation(saved), tag: input.tag, color: input.color },
              snapshotMetadata(saved),
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
                const current = yield* graph.load(input.resourceID)
                const removedEdgeIDs = current.resource.edges
                  .filter((edge) => edge.source === input.nodeID || edge.target === input.nodeID)
                  .map((edge) => edge.id)
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "node.remove",
                      nodeID: input.nodeID,
                      cascade: input.cascade,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                })
                return { saved, removedEdgeIDs }
              }),
            ),
          ),
          Effect.map(({ saved, removedEdgeIDs }) =>
            json(
              `Deleted graph node ${input.nodeID}`,
              { ...mutation(saved), nodeID: input.nodeID, removedEdgeIDs },
              snapshotMetadata(saved),
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
                const current = yield* graph.load(input.resourceID)
                const edge: Architecture.Edge = {
                  id: input.id ?? Architecture.EdgeID.create(),
                  source: input.source,
                  target: input.target,
                  sourceHandle: input.sourceHandle ?? "right",
                  targetHandle: input.targetHandle ?? "left",
                  style: input.style ?? "rectangular",
                }
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [{ id: Architecture.OperationID.create(), type: "edge.create", edge }],
                })
                return { saved, edge }
              }),
            ),
          ),
          Effect.map(({ saved, edge }) =>
            json(`Connected graph nodes with ${edge.id}`, { ...mutation(saved), edge }, snapshotMetadata(saved)),
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
                const current = yield* graph.load(input.resourceID)
                const edge = current.resource.edges.find((candidate) => candidate.id === input.edgeID)
                if (!edge) return yield* new ArchitecturePatch.NotFoundError({ entity: "edge", id: input.edgeID })
                const updated: Architecture.Edge = {
                  ...edge,
                  source: input.source ?? edge.source,
                  target: input.target ?? edge.target,
                  sourceHandle: input.sourceHandle ?? edge.sourceHandle ?? "right",
                  targetHandle: input.targetHandle ?? edge.targetHandle ?? "left",
                  style: input.style ?? edge.style ?? "rectangular",
                }
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "edge.update",
                      edge: updated,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                })
                return { saved, edge: updated }
              }),
            ),
          ),
          Effect.map(({ saved, edge }) =>
            json(`Updated graph connection ${edge.id}`, { ...mutation(saved), edge }, snapshotMetadata(saved)),
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
                const current = yield* graph.load(input.resourceID)
                const nodeOperations = (input.nodes ?? []).map((item): Architecture.Operation => {
                  const node = current.resource.nodes.find((candidate) => candidate.id === item.nodeID)
                  if (!node) throw new Error(`node not found: ${item.nodeID}`)
                  return {
                    id: Architecture.OperationID.create(),
                    type: "node.position",
                    nodeID: item.nodeID,
                    position: item.position,
                  }
                })
                const edgeOperations = (input.edges ?? []).map((item): Architecture.Operation => {
                  const edge = current.resource.edges.find((candidate) => candidate.id === item.edgeID)
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
                    ? yield* graph.patch(input.resourceID, {
                        revision: current.resource.revision,
                        digest: current.digest,
                        operations,
                      })
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
              { ...mutation(saved), nodeIDs, edgeIDs },
              snapshotMetadata(saved),
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
                const current = yield* graph.load(input.resourceID)
                const saved = yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations: [
                    {
                      id: Architecture.OperationID.create(),
                      type: "edge.remove",
                      edgeID: input.edgeID,
                      expectedDigest: input.expectedDigest,
                    },
                  ],
                })
                return saved
              }),
            ),
          ),
          Effect.map((saved) =>
            json(`Deleted graph connection ${input.edgeID}`, { ...mutation(saved), edgeID: input.edgeID }, snapshotMetadata(saved)),
          ),
        ),
    }),
    graphTool(ArchitectureTools.names.getContext, {
      description: "Return a bounded text summary of selected or all saved Graph editor resources.",
      parameters: GetContextInput,
      execute: (input, ctx) =>
        authorize(ctx, "read").pipe(
          Effect.andThen(withGraph((graph) => graph.context(input.resourceIDs))),
          Effect.map((output) => text("Graph context", { output })),
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

function snapshotMetadata(snapshot: Architecture.ResourceSnapshot): Metadata {
  return {
    resourceID: snapshot.resource.id,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
  }
}

function mutation(snapshot: Architecture.ResourceSnapshot): typeof MutationMetadata.Type {
  return {
    resourceID: snapshot.resource.id,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
  }
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

function text(title: string, input: { output?: string; resourceID?: Architecture.ResourceID }): Tool.ExecuteResult<Metadata> {
  return {
    title,
    metadata: input.resourceID ? { resourceID: input.resourceID } : {},
    output: input.output ?? title,
  }
}
