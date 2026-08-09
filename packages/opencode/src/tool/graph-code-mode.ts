import { Tool } from "@opencode-ai/codemode"
import { ArchitectureBatch } from "@opencode-ai/core/architecture/batch"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitectureTools } from "@opencode-ai/core/architecture/tools"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Schema } from "effect"

export type CodeModeNativeTool = {
  readonly kind: "native"
  readonly key: string
  readonly server: string
  readonly local: string
  readonly permission: "read" | "edit"
  readonly definition: Tool.Definition<ArchitectureGraph.Service>
  readonly patterns: (input: unknown) => string[]
}

const root = ".opencode/architecture/resources"
const ExpectedDigest = Schema.String.pipe(Schema.optional)
const MutationOutput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  revision: NonNegativeInt,
  digest: Schema.String,
})

const ResourceIDInput = Schema.Struct({ resourceID: Architecture.ResourceID })
const DeleteResourceInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  expectedDigest: Schema.String,
})
const UpdateResourceInput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  name: Schema.NonEmptyString,
})
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
const GetContextInput = Schema.Struct({
  resourceIDs: Schema.Array(Architecture.ResourceID).pipe(Schema.optional),
})

export function graphCodeModeTools(): CodeModeNativeTool[] {
  return [
    graphTool({
      key: ArchitectureTools.names.listResources,
      permission: "read",
      input: Schema.Struct({}),
      output: Schema.Array(Architecture.ResourceSummary),
      description:
        "Native graph_list_resources. List the project's saved Graph editor resources, including IDs for @graph mentions. Use this instead of searching workspace files for graph display names.",
      run: () =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          return yield* graph.list()
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.createResource,
      permission: "edit",
      input: Architecture.ResourceCreateInput,
      output: Architecture.ResourceSnapshot,
      description:
        "Native graph_create_resource. Create a named Graph editor resource as a lightweight shared communication artifact.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          return yield* graph.create(input)
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.reloadResource,
      permission: "read",
      input: ResourceIDInput,
      output: Architecture.ResourceSnapshot,
      description:
        "Native graph_reload_resource. Reload one managed Graph editor resource by resourceID after creating, editing, or laying out a graph.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          return yield* graph.load(input.resourceID)
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.updateResource,
      permission: "edit",
      input: UpdateResourceInput,
      output: Architecture.ResourceSnapshot,
      description: "Native graph_update_resource. Rename one managed Graph editor resource.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          return yield* graph.patch(input.resourceID, {
            revision: current.resource.revision,
            digest: current.digest,
            operations: [{ id: Architecture.OperationID.create(), type: "resource.update", name: input.name }],
          })
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.deleteResource,
      permission: "edit",
      input: DeleteResourceInput,
      output: Schema.Void,
      description:
        "Native graph_delete_resource. Delete a Graph editor resource only when explicitly requested and the expected digest still matches.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          if (current.digest !== input.expectedDigest)
            return yield* Effect.fail(
              new Error(
                `Graph resource ${input.resourceID} changed: expected digest ${input.expectedDigest}, current revision ${current.resource.revision}, current digest ${current.digest}`,
              ),
            )
          return yield* graph.remove(input.resourceID, {
            revision: current.resource.revision,
            digest: current.digest,
          })
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.query,
      permission: "read",
      input: Architecture.QueryInput,
      output: Architecture.QueryResult,
      description:
        "Native graph_query. Query saved Graph editor resources by resource ID, node ID, text, or node tags instead of reading graph JSON files directly.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          return yield* graph.query(input)
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.createNode,
      permission: "edit",
      input: CreateNodeInput,
      output: Schema.Struct({ ...MutationOutput.fields, node: Architecture.Node }),
      description:
        "Native graph_create_node. Create a text node with optional free-form tags in a managed graph resource. Provide deliberate readable positions.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
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
          return { resourceID: input.resourceID, revision: saved.resource.revision, digest: saved.digest, node }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.batchEdit,
      permission: "edit",
      input: ArchitectureBatch.Input,
      output: ArchitectureBatch.Output,
      description:
        "Native graph_batch_edit. Batch set tag colors and create or update many graph nodes and connections in one atomic edit. Use this for multi-node, tag-color, or multi-wire graph edits.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
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
            resourceID: input.resourceID,
            revision: saved.resource.revision,
            digest: saved.digest,
            createdNodeIDs: batch.createdNodeIDs,
            updatedNodeIDs: batch.updatedNodeIDs,
            createdEdgeIDs: batch.createdEdgeIDs,
            updatedEdgeIDs: batch.updatedEdgeIDs,
            updatedTagColors: batch.updatedTagColors,
          }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.updateNode,
      permission: "edit",
      input: UpdateNodeInput,
      output: Schema.Struct({ ...MutationOutput.fields, node: Architecture.Node }),
      description:
        "Native graph_update_node. Edit a node's text, tags, or position in a managed graph resource. Use position updates to improve readability.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          const node = current.resource.nodes.find((candidate) => candidate.id === input.nodeID)
          if (!node) return yield* Effect.fail(new Error(`Graph node not found: ${input.nodeID}`))
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
          return { resourceID: input.resourceID, revision: saved.resource.revision, digest: saved.digest, node: updated }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.setTagColor,
      permission: "edit",
      input: SetTagColorInput,
      output: Schema.Struct({
        ...MutationOutput.fields,
        tag: Architecture.Tag,
        color: Architecture.TagColor.pipe(Schema.optional),
      }),
      description:
        "Native graph_set_tag_color. Set or clear the display color for one free-form node tag in a managed graph resource. Use #RRGGBB colors.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          const saved = yield* graph.patch(input.resourceID, {
            revision: current.resource.revision,
            digest: current.digest,
            operations: [
              { id: Architecture.OperationID.create(), type: "tag.color", tag: input.tag, color: input.color },
            ],
          })
          return {
            resourceID: input.resourceID,
            revision: saved.resource.revision,
            digest: saved.digest,
            tag: input.tag,
            color: input.color,
          }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.deleteNode,
      permission: "edit",
      input: DeleteNodeInput,
      output: Schema.Struct({
        ...MutationOutput.fields,
        nodeID: Architecture.NodeID,
        removedEdgeIDs: Schema.Array(Architecture.EdgeID),
      }),
      description: "Native graph_delete_node. Delete one graph node by ID. Cascade must be true when it has wires.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
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
          return {
            resourceID: input.resourceID,
            revision: saved.resource.revision,
            digest: saved.digest,
            nodeID: input.nodeID,
            removedEdgeIDs,
          }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.connectNodes,
      permission: "edit",
      input: ConnectNodesInput,
      output: Schema.Struct({ ...MutationOutput.fields, edge: Architecture.Edge }),
      description:
        "Native graph_connect_nodes. Connect two nodes with explicit source/target sides and wire style to reduce crossing or overlapping wires.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
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
          return { resourceID: input.resourceID, revision: saved.resource.revision, digest: saved.digest, edge }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.updateConnection,
      permission: "edit",
      input: UpdateConnectionInput,
      output: Schema.Struct({ ...MutationOutput.fields, edge: Architecture.Edge }),
      description:
        "Native graph_update_connection. Change a connection's nodes, exact source/target sides, or durable wire style. Valid styles: rectangular, curved, straight.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          const edge = current.resource.edges.find((candidate) => candidate.id === input.edgeID)
          if (!edge) return yield* Effect.fail(new Error(`Graph connection not found: ${input.edgeID}`))
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
          return { resourceID: input.resourceID, revision: saved.resource.revision, digest: saved.digest, edge: updated }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.updateLayout,
      permission: "edit",
      input: UpdateLayoutInput,
      output: Schema.Struct({
        ...MutationOutput.fields,
        nodeIDs: Schema.Array(Architecture.NodeID),
        edgeIDs: Schema.Array(Architecture.EdgeID),
      }),
      description:
        "Native graph_update_layout. Move multiple nodes and reroute multiple wires in one edit. Valid styles: rectangular, curved, straight.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          const current = yield* graph.load(input.resourceID)
          const nodeOperations = yield* Effect.forEach(input.nodes ?? [], (item) => {
            const node = current.resource.nodes.find((candidate) => candidate.id === item.nodeID)
            if (!node) return Effect.fail(new Error(`Graph node not found: ${item.nodeID}`))
            return Effect.succeed({
              id: Architecture.OperationID.create(),
              type: "node.position" as const,
              nodeID: item.nodeID,
              position: item.position,
            })
          })
          const edgeOperations = yield* Effect.forEach(input.edges ?? [], (item) => {
            const edge = current.resource.edges.find((candidate) => candidate.id === item.edgeID)
            if (!edge) return Effect.fail(new Error(`Graph connection not found: ${item.edgeID}`))
            return Effect.succeed({
              id: Architecture.OperationID.create(),
              type: "edge.update" as const,
              edge: {
                ...edge,
                sourceHandle: item.sourceHandle ?? edge.sourceHandle ?? "right",
                targetHandle: item.targetHandle ?? edge.targetHandle ?? "left",
                style: item.style ?? edge.style ?? "rectangular",
              },
            })
          })
          const operations: Architecture.Operation[] = [...nodeOperations, ...edgeOperations]
          const saved =
            operations.length > 0
              ? yield* graph.patch(input.resourceID, {
                  revision: current.resource.revision,
                  digest: current.digest,
                  operations,
                })
              : current
          return {
            resourceID: input.resourceID,
            revision: saved.resource.revision,
            digest: saved.digest,
            nodeIDs: (input.nodes ?? []).map((item) => item.nodeID),
            edgeIDs: (input.edges ?? []).map((item) => item.edgeID),
          }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.disconnectNodes,
      permission: "edit",
      input: DisconnectNodesInput,
      output: Schema.Struct({ ...MutationOutput.fields, edgeID: Architecture.EdgeID }),
      description: "Native graph_disconnect_nodes. Delete one connection by edge ID from a managed graph resource.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
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
          return { resourceID: input.resourceID, revision: saved.resource.revision, digest: saved.digest, edgeID: input.edgeID }
        }),
    }),
    graphTool({
      key: ArchitectureTools.names.getContext,
      permission: "read",
      input: GetContextInput,
      output: Schema.String,
      description:
        "Native graph_get_context. Return a bounded text summary of selected or all saved Graph editor resources, including exact managed file paths and layout fields.",
      run: (input) =>
        Effect.gen(function* () {
          const graph = yield* ArchitectureGraph.Service
          return yield* graph.context(input.resourceIDs)
        }),
    }),
  ]
}

function graphTool<const I extends Schema.Decoder<unknown>, const O extends Tool.SchemaType | undefined = undefined>(input: {
  readonly key: string
  readonly permission: "read" | "edit"
  readonly input: I
  readonly output?: O
  readonly description: string
  readonly run: (input: Schema.Schema.Type<I>) => Effect.Effect<unknown, unknown, ArchitectureGraph.Service>
}): CodeModeNativeTool {
  const local = input.key.startsWith("graph_") ? input.key.slice("graph_".length) : input.key
  return {
    kind: "native",
    key: input.key,
    server: "graph",
    local,
    permission: input.permission,
    definition: Tool.make({
      description: input.description,
      input: input.input,
      output: input.output,
      run: input.run as Tool.Options<I, O, ArchitectureGraph.Service>["run"],
    }),
    patterns: graphPatterns,
  }
}

function graphPatterns(input: unknown) {
  if (input === null || typeof input !== "object") return [root]
  const value = input as Record<string, unknown>
  if (typeof value.resourceID === "string") return [resourcePath(value.resourceID)]
  if (Array.isArray(value.resourceIDs)) {
    const paths = value.resourceIDs.filter((id): id is string => typeof id === "string").map(resourcePath)
    return paths.length > 0 ? paths : [root]
  }
  return [root]
}

function resourcePath(resourceID: string) {
  return `${root}/${resourceID}.json`
}
