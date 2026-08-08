export * as ArchitectureTools from "./tools"

import { ToolFailure } from "@opencode-ai/llm"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { NonNegativeInt } from "../schema"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"
import { ArchitectureGraph } from "./graph"
import { ArchitecturePatch } from "./patch"

export const names = {
  listResources: "graph_list_resources",
  createResource: "graph_create_resource",
  reloadResource: "graph_reload_resource",
  updateResource: "graph_update_resource",
  deleteResource: "graph_delete_resource",
  query: "graph_query",
  createNode: "graph_create_node",
  updateNode: "graph_update_node",
  setTagColor: "graph_set_tag_color",
  deleteNode: "graph_delete_node",
  connectNodes: "graph_connect_nodes",
  updateConnection: "graph_update_connection",
  updateLayout: "graph_update_layout",
  disconnectNodes: "graph_disconnect_nodes",
  getContext: "graph_get_context",
} as const

const root = ".opencode/architecture/resources"

const MutationOutput = Schema.Struct({
  resourceID: Architecture.ResourceID,
  revision: NonNegativeInt,
  digest: Schema.String,
})

const ExpectedDigest = Schema.String.pipe(Schema.optional)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const graph = yield* ArchitectureGraph.Service
    const permission = yield* PermissionV2.Service

    const authorize = (action: "read" | "edit", context: Tool.Context, resourceID?: Architecture.ResourceID) => {
      const resource = resourceID ? `${root}/${resourceID}.json` : root
      return permission.assert({
        action,
        resources: [resource],
        save: [resource],
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
      })
    }

    const register = {
      [names.listResources]: Tool.withPermission(
        Tool.make({
          description:
            "List the project's saved Graph editor resources, including the resource IDs that correspond to @graph mentions. Use this instead of searching workspace files for graph display names.",
          input: Schema.Struct({}),
          output: Schema.Array(Architecture.ResourceSummary),
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
          execute: (_input, context) =>
            authorize("read", context).pipe(
              Effect.andThen(graph.list()),
              Effect.mapError((error) => failure("Unable to list graph resources", error)),
            ),
        }),
        "read",
      ),
      [names.createResource]: Tool.withPermission(
        Tool.make({
          description: "Create a named Graph editor resource as a lightweight shared communication artifact.",
          input: Architecture.ResourceCreateInput,
          output: Architecture.ResourceSnapshot,
          toModelOutput: ({ output }) => [
            { type: "text", text: `Created graph resource ${output.resource.id}: ${output.resource.name}` },
          ],
          execute: (input, context) =>
            authorize("edit", context, input.id).pipe(
              Effect.andThen(graph.create(input)),
              Effect.mapError((error) => failure(`Unable to create graph resource ${input.name}`, error)),
            ),
        }),
        "edit",
      ),
      [names.reloadResource]: Tool.withPermission(
        Tool.make({
          description:
            "Reload one managed Graph editor resource by resourceID after creating, editing, or laying out a graph. Use this to inspect the latest saved graph state instead of reading JSON files directly.",
          input: Schema.Struct({ resourceID: Architecture.ResourceID }),
          output: Architecture.ResourceSnapshot,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: JSON.stringify({
                path: `${root}/${output.resource.id}.json`,
                ...output,
              }),
            },
          ],
          execute: (input, context) =>
            authorize("read", context, input.resourceID).pipe(
              Effect.andThen(graph.load(input.resourceID)),
              Effect.mapError((error) => failure(`Unable to reload graph resource ${input.resourceID}`, error)),
            ),
        }),
        "read",
      ),
      [names.updateResource]: Tool.withPermission(
        Tool.make({
          description: "Rename one Graph editor resource.",
          input: Schema.Struct({ resourceID: Architecture.ResourceID, name: Schema.NonEmptyString }),
          output: Architecture.ResourceSnapshot,
          toModelOutput: ({ output }) => [{ type: "text", text: `Renamed graph resource ${output.resource.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
            }).pipe(
              Effect.mapError((error) => failure(`Unable to rename graph resource ${input.resourceID}`, error)),
            ),
        }),
        "edit",
      ),
      [names.deleteResource]: Tool.withPermission(
        Tool.make({
          description: "Delete a Graph editor resource only when explicitly requested.",
          input: Schema.Struct({ resourceID: Architecture.ResourceID, expectedDigest: Schema.String }),
          output: Schema.Void,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
              const current = yield* graph.load(input.resourceID)
              if (current.digest !== input.expectedDigest)
                return yield* new ToolFailure({ message: `Graph resource ${input.resourceID} changed` })
              yield* graph.remove(input.resourceID, {
                revision: current.resource.revision,
                digest: current.digest,
              })
            }).pipe(
              Effect.mapError((error) => failure(`Unable to delete graph resource ${input.resourceID}`, error)),
            ),
        }),
        "edit",
      ),
      [names.query]: Tool.withPermission(
        Tool.make({
          description:
            "Query saved Graph editor resources by resource ID, node ID, text, or node tags. Use this for user mentions like @Graph 1 after resolving the resource ID/path from Graph editor context, rather than reading JSON files directly.",
          input: Architecture.QueryInput,
          output: Architecture.QueryResult,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
          execute: (input, context) =>
            authorize("read", context).pipe(
              Effect.andThen(graph.query(input)),
              Effect.mapError((error) => failure("Unable to query graph resources", error)),
            ),
        }),
        "read",
      ),
      [names.createNode]: Tool.withPermission(
        Tool.make({
          description:
            "Create a text node with optional free-form tags in a managed graph resource identified by resourceID. Provide deliberate positions that form readable spaced layers or clusters instead of leaving nodes at the default origin.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            id: Architecture.NodeID.pipe(Schema.optional),
            text: Schema.NonEmptyString,
            tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
            position: Architecture.Position.pipe(Schema.optional),
          }),
          output: Schema.Struct({ ...MutationOutput.fields, node: Architecture.Node }),
          toModelOutput: ({ output }) => [{ type: "text", text: `Created graph node ${output.node.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                node,
              }
            }).pipe(
              Effect.mapError((error) => failure(`Unable to create graph node in ${input.resourceID}`, error)),
            ),
        }),
        "edit",
      ),
      [names.updateNode]: Tool.withPermission(
        Tool.make({
          description:
            "Edit a node's text, tags, or position in a managed graph resource identified by resourceID. Use position updates to improve readability and separate crowded nodes.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            nodeID: Architecture.NodeID,
            expectedDigest: ExpectedDigest,
            text: Schema.NonEmptyString.pipe(Schema.optional),
            tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
            position: Architecture.Position.pipe(Schema.optional),
          }),
          output: Schema.Struct({ ...MutationOutput.fields, node: Architecture.Node }),
          toModelOutput: ({ output }) => [{ type: "text", text: `Updated graph node ${output.node.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                node: updated,
              }
            }).pipe(Effect.mapError((error) => failure(`Unable to update graph node ${input.nodeID}`, error))),
        }),
        "edit",
      ),
      [names.setTagColor]: Tool.withPermission(
        Tool.make({
          description:
            "Set or clear the display color for one free-form node tag in a managed graph resource. Use #RRGGBB colors; tags remain ordinary node labels.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            tag: Architecture.Tag,
            color: Architecture.TagColor.pipe(Schema.optional),
          }),
          output: Schema.Struct({
            ...MutationOutput.fields,
            tag: Architecture.Tag,
            color: Architecture.TagColor.pipe(Schema.optional),
          }),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output.color
                ? `Set graph tag ${output.tag} color to ${output.color}`
                : `Cleared graph tag ${output.tag} color`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                tag: input.tag,
                color: input.color,
              }
            }).pipe(
              Effect.mapError((error) => failure(`Unable to update graph tag ${input.tag}`, error)),
            ),
        }),
        "edit",
      ),
      [names.deleteNode]: Tool.withPermission(
        Tool.make({
          description: "Delete one graph node by ID. Cascade must be true when it has connections.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            nodeID: Architecture.NodeID,
            expectedDigest: ExpectedDigest,
            cascade: Schema.Boolean,
          }),
          output: Schema.Struct({
            ...MutationOutput.fields,
            nodeID: Architecture.NodeID,
            removedEdgeIDs: Schema.Array(Architecture.EdgeID),
          }),
          toModelOutput: ({ output }) => [{ type: "text", text: `Deleted graph node ${output.nodeID}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
            }).pipe(Effect.mapError((error) => failure(`Unable to delete graph node ${input.nodeID}`, error))),
        }),
        "edit",
      ),
      [names.connectNodes]: Tool.withPermission(
        Tool.make({
          description:
            "Connect two nodes from explicit source and target sides in the same managed graph resource. Choose sourceHandle and targetHandle sides plus style to reduce crossing or overlapping wires; vary top/right/bottom/left handles and rectangular/curved/straight styles for fan-out, feedback, and cross-cluster links instead of routing everything right-to-left.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            id: Architecture.EdgeID.pipe(Schema.optional),
            source: Architecture.NodeID,
            target: Architecture.NodeID,
            sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
            targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
            style: Architecture.EdgeStyle.pipe(Schema.optional),
          }),
          output: Schema.Struct({ ...MutationOutput.fields, edge: Architecture.Edge }),
          toModelOutput: ({ output }) => [
            { type: "text", text: `Connected graph nodes with ${output.edge.id}` },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                edge,
              }
            }).pipe(Effect.mapError((error) => failure("Unable to connect graph nodes", error))),
        }),
        "edit",
      ),
      [names.updateConnection]: Tool.withPermission(
        Tool.make({
          description:
            "Change a connection's nodes, exact source/target sides, or durable wire style in a managed graph resource. Re-route crowded diagrams by changing sourceHandle, targetHandle, and style. Valid styles: rectangular, curved, straight.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            edgeID: Architecture.EdgeID,
            expectedDigest: ExpectedDigest,
            source: Architecture.NodeID.pipe(Schema.optional),
            target: Architecture.NodeID.pipe(Schema.optional),
            sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
            targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
            style: Architecture.EdgeStyle.pipe(Schema.optional),
          }),
          output: Schema.Struct({ ...MutationOutput.fields, edge: Architecture.Edge }),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Updated graph connection ${output.edge.id} (${output.edge.sourceHandle} to ${output.edge.targetHandle}; ${output.edge.style ?? "rectangular"})`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                edge: updated,
              }
            }).pipe(
              Effect.mapError((error) => failure(`Unable to update graph connection ${input.edgeID}`, error)),
            ),
        }),
        "edit",
      ),
      [names.updateLayout]: Tool.withPermission(
        Tool.make({
          description:
            "Update graph visual layout in one edit. Use this for requests to make a graph clearer: move multiple nodes and reroute multiple connections by changing sourceHandle, targetHandle, and style. Do not edit graph JSON directly. Valid styles: rectangular, curved, straight.",
          input: Schema.Struct({
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
          }),
          output: Schema.Struct({
            ...MutationOutput.fields,
            nodeIDs: Schema.Array(Architecture.NodeID),
            edgeIDs: Schema.Array(Architecture.EdgeID),
          }),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Updated graph layout for ${output.resourceID}: ${output.nodeIDs.length} nodes, ${output.edgeIDs.length} connections`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
              const current = yield* graph.load(input.resourceID)
              const nodeOperations: Architecture.Operation[] = []
              for (const item of input.nodes ?? []) {
                const node = current.resource.nodes.find((candidate) => candidate.id === item.nodeID)
                if (!node) return yield* new ArchitecturePatch.NotFoundError({ entity: "node", id: item.nodeID })
                nodeOperations.push({
                  id: Architecture.OperationID.create(),
                  type: "node.position" as const,
                  nodeID: item.nodeID,
                  position: item.position,
                })
              }
              const edgeOperations: Architecture.Operation[] = []
              for (const item of input.edges ?? []) {
                const edge = current.resource.edges.find((candidate) => candidate.id === item.edgeID)
                if (!edge) return yield* new ArchitecturePatch.NotFoundError({ entity: "edge", id: item.edgeID })
                edgeOperations.push({
                  id: Architecture.OperationID.create(),
                  type: "edge.update" as const,
                  edge: {
                    ...edge,
                    sourceHandle: item.sourceHandle ?? edge.sourceHandle ?? "right",
                    targetHandle: item.targetHandle ?? edge.targetHandle ?? "left",
                    style: item.style ?? edge.style ?? "rectangular",
                  },
                })
              }
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
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                nodeIDs: (input.nodes ?? []).map((item) => item.nodeID),
                edgeIDs: (input.edges ?? []).map((item) => item.edgeID),
              }
            }).pipe(Effect.mapError((error) => failure(`Unable to update graph layout ${input.resourceID}`, error))),
        }),
        "edit",
      ),
      [names.disconnectNodes]: Tool.withPermission(
        Tool.make({
          description: "Delete one connection by edge ID from a named graph resource.",
          input: Schema.Struct({
            resourceID: Architecture.ResourceID,
            edgeID: Architecture.EdgeID,
            expectedDigest: ExpectedDigest,
          }),
          output: Schema.Struct({ ...MutationOutput.fields, edgeID: Architecture.EdgeID }),
          toModelOutput: ({ output }) => [{ type: "text", text: `Deleted graph connection ${output.edgeID}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize("edit", context, input.resourceID)
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
              return {
                resourceID: input.resourceID,
                revision: saved.resource.revision,
                digest: saved.digest,
                edgeID: input.edgeID,
              }
            }).pipe(
              Effect.mapError((error) => failure(`Unable to delete graph connection ${input.edgeID}`, error)),
            ),
        }),
        "edit",
      ),
      [names.getContext]: Tool.withPermission(
        Tool.make({
          description:
            "Return a bounded text summary of selected or all saved Graph editor resources, including their exact managed file paths and valid layout fields.",
          input: Schema.Struct({ resourceIDs: Schema.Array(Architecture.ResourceID).pipe(Schema.optional) }),
          output: Schema.String,
          execute: (input, context) =>
            authorize("read", context).pipe(
              Effect.andThen(graph.context(input.resourceIDs)),
              Effect.mapError((error) => failure("Unable to load graph context", error)),
            ),
        }),
        "read",
      ),
    }

    yield* tools.register(register).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "architecture-tools",
  layer,
  deps: [ToolRegistry.node, ArchitectureGraph.node, PermissionV2.node],
})

function failure(message: string, error: unknown) {
  if (error instanceof ToolFailure) return error
  return new ToolFailure({ message: `${message}: ${error instanceof Error ? error.message : String(error)}` })
}
