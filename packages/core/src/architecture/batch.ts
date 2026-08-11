export * as ArchitectureBatch from "./batch"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { ArchitecturePatch } from "./patch"

const ExpectedDigest = Schema.String.pipe(Schema.optional)

export const NodeCreateInput = Schema.Struct({
  id: Architecture.NodeID.pipe(Schema.optional),
  text: Schema.NonEmptyString,
  tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
  position: Architecture.Position.pipe(Schema.optional),
})

export const NodeUpdateInput = Schema.Struct({
  nodeID: Architecture.NodeID,
  expectedDigest: ExpectedDigest,
  text: Schema.NonEmptyString.pipe(Schema.optional),
  tags: Schema.Array(Architecture.Tag).pipe(Schema.optional),
  position: Architecture.Position.pipe(Schema.optional),
})

export const EdgeCreateInput = Schema.Struct({
  id: Architecture.EdgeID.pipe(Schema.optional),
  source: Architecture.NodeID,
  target: Architecture.NodeID,
  sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  style: Architecture.EdgeStyle.pipe(Schema.optional),
})

export const EdgeUpdateInput = Schema.Struct({
  edgeID: Architecture.EdgeID,
  expectedDigest: ExpectedDigest,
  source: Architecture.NodeID.pipe(Schema.optional),
  target: Architecture.NodeID.pipe(Schema.optional),
  sourceHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  targetHandle: Architecture.ConnectionSide.pipe(Schema.optional),
  style: Architecture.EdgeStyle.pipe(Schema.optional),
})

export const TagColorInput = Schema.Struct({
  tag: Architecture.Tag,
  color: Architecture.TagColor.pipe(Schema.optional),
})

export const Input = Schema.Struct({
  resourceID: Architecture.ResourceID,
  setTagColors: Schema.Array(TagColorInput).pipe(Schema.optional),
  createNodes: Schema.Array(NodeCreateInput).pipe(Schema.optional),
  updateNodes: Schema.Array(NodeUpdateInput).pipe(Schema.optional),
  createEdges: Schema.Array(EdgeCreateInput).pipe(Schema.optional),
  updateEdges: Schema.Array(EdgeUpdateInput).pipe(Schema.optional),
})

export const Output = Schema.Struct({
  resourceID: Architecture.ResourceID,
  revision: NonNegativeInt,
  digest: Schema.String,
  createdNodeIDs: Schema.Array(Architecture.NodeID),
  updatedNodeIDs: Schema.Array(Architecture.NodeID),
  createdEdgeIDs: Schema.Array(Architecture.EdgeID),
  updatedEdgeIDs: Schema.Array(Architecture.EdgeID),
  updatedTagColors: Schema.Array(Architecture.Tag),
})

export function prepare(input: typeof Input.Type, resource: Architecture.Resource) {
  const nodes = new Map(resource.nodes.map((node) => [node.id, node]))
  const edges = new Map(resource.edges.map((edge) => [edge.id, edge]))
  const missingNode = (input.updateNodes ?? []).find((item) => !nodes.has(item.nodeID))
  if (missingNode)
    return {
      ok: false as const,
      error: new ArchitecturePatch.NotFoundError({ entity: "node", id: missingNode.nodeID }),
    }
  const missingEdge = (input.updateEdges ?? []).find((item) => !edges.has(item.edgeID))
  if (missingEdge)
    return {
      ok: false as const,
      error: new ArchitecturePatch.NotFoundError({ entity: "edge", id: missingEdge.edgeID }),
    }

  const createdNodes = (input.createNodes ?? []).map((item): Architecture.Node => ({
    id: item.id ?? Architecture.NodeID.create(),
    text: item.text,
    tags: item.tags ?? [],
    layout: { position: item.position ?? { x: 0, y: 0 } },
  }))
  const createdEdges = (input.createEdges ?? []).map((item): Architecture.Edge => ({
    id: item.id ?? Architecture.EdgeID.create(),
    source: item.source,
    target: item.target,
    sourceHandle: item.sourceHandle ?? "right",
    targetHandle: item.targetHandle ?? "left",
    style: item.style ?? "curved",
  }))
  const updatedNodeOperations = (input.updateNodes ?? []).map((item): Architecture.Operation => {
    const node = nodes.get(item.nodeID)!
    const updated: Architecture.Node = {
      ...node,
      text: item.text ?? node.text,
      tags: item.tags ?? node.tags,
      layout: item.position ? { position: item.position } : node.layout,
    }
    if (item.text !== undefined || item.tags !== undefined)
      return {
        id: Architecture.OperationID.create(),
        type: "node.update",
        node: updated,
        expectedDigest: item.expectedDigest,
      }
    return {
      id: Architecture.OperationID.create(),
      type: "node.position",
      nodeID: node.id,
      position: updated.layout.position,
      expectedDigest: item.expectedDigest,
    }
  })
  const updatedEdgeOperations = (input.updateEdges ?? []).map((item): Architecture.Operation => {
    const edge = edges.get(item.edgeID)!
    return {
      id: Architecture.OperationID.create(),
      type: "edge.update",
      edge: {
        ...edge,
        source: item.source ?? edge.source,
        target: item.target ?? edge.target,
        sourceHandle: item.sourceHandle ?? edge.sourceHandle ?? "right",
        targetHandle: item.targetHandle ?? edge.targetHandle ?? "left",
        style: item.style ?? edge.style ?? "curved",
      },
      expectedDigest: item.expectedDigest,
    }
  })

  return {
    ok: true as const,
    operations: [
      ...(input.setTagColors ?? []).map((item): Architecture.Operation => ({
        id: Architecture.OperationID.create(),
        type: "tag.color",
        tag: item.tag,
        color: item.color,
      })),
      ...createdNodes.map((node): Architecture.Operation => ({
        id: Architecture.OperationID.create(),
        type: "node.create",
        node,
      })),
      ...updatedNodeOperations,
      ...createdEdges.map((edge): Architecture.Operation => ({
        id: Architecture.OperationID.create(),
        type: "edge.create",
        edge,
      })),
      ...updatedEdgeOperations,
    ],
    createdNodeIDs: createdNodes.map((node) => node.id),
    updatedNodeIDs: (input.updateNodes ?? []).map((item) => item.nodeID),
    createdEdgeIDs: createdEdges.map((edge) => edge.id),
    updatedEdgeIDs: (input.updateEdges ?? []).map((item) => item.edgeID),
    updatedTagColors: (input.setTagColors ?? []).map((item) => item.tag),
  }
}
