import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureNode,
  ArchitectureOperation,
  ArchitectureResource,
} from "./contract"
import { operationID } from "./journal"

type Position = { readonly x: number; readonly y: number }
type ConnectionInput = {
  readonly source?: string | null
  readonly target?: string | null
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}
type SelectionInput = {
  readonly nodeIDs: ReadonlyArray<string>
  readonly edgeIDs: ReadonlyArray<string>
}

export function architectureCreateNodeOperation(
  resource: ArchitectureResource,
  input: { readonly text: string; readonly position?: Position },
) {
  const id = `node_${Date.now().toString(36)}`
  return {
    id,
    operation: architectureNodeCreateOperation({
      id,
      text: input.text,
      tags: [],
      position: {
        x: input.position?.x ?? (resource.nodes.length % 4) * 260,
        y: input.position?.y ?? Math.floor(resource.nodes.length / 4) * 170,
      },
    }),
  }
}

export function architectureDuplicateNodeOperation(resource: ArchitectureResource, nodeID: string) {
  const current = resource.nodes.find((node) => node.id === nodeID)
  if (!current) return
  const id = `node_${Date.now().toString(36)}`
  return {
    id,
    operation: architectureNodeCreateOperation({
      ...current,
      id,
      position: { x: current.layout.position.x + 36, y: current.layout.position.y + 36 },
    }),
  }
}

export function architectureNodeTextOperation(node: ArchitectureNode, text: string) {
  if (text === node.text) return
  return architectureNodeUpdateOperation({ ...node, text })
}

export function architectureNodeUpdateOperation(node: ArchitectureNode): ArchitectureOperation {
  return { id: operationID(), type: "node.update", node }
}

export function architectureNodePositionOperations(
  resource: ArchitectureResource,
  nodeIDs: ReadonlyArray<string>,
  movedNodes: ReadonlyArray<{ readonly id: string; readonly position: Position }>,
) {
  return nodeIDs.flatMap((nodeID): ArchitectureOperation[] => {
    const current = resource.nodes.find((node) => node.id === nodeID)
    const moved = movedNodes.find((node) => node.id === nodeID)
    if (!moved || !current || samePosition(moved.position, current.layout.position)) return []
    return [{ id: operationID(), type: "node.position", nodeID, position: moved.position }]
  })
}

export function architectureNodeRemoveOperation(nodeID: string): ArchitectureOperation {
  return { id: operationID(), type: "node.remove", nodeID, cascade: true }
}

export function architectureEdgeCreateOperation(connection: ConnectionInput) {
  if (!connection.source || !connection.target) return
  const edge: ArchitectureEdge = {
    id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: architectureConnectionSide(connection.sourceHandle, "right"),
    targetHandle: architectureConnectionSide(connection.targetHandle, "left"),
    style: "rectangular",
  }
  return { id: edge.id, operation: architectureEdgeCreateOperationForEdge(edge) }
}

export function architectureEdgeReconnectOperation(
  resource: ArchitectureResource,
  edgeID: string,
  connection: ConnectionInput,
) {
  if (!connection.source || !connection.target) return
  const edge = resource.edges.find((candidate) => candidate.id === edgeID)
  if (!edge) return
  return architectureEdgeUpdateOperation({
    ...edge,
    source: connection.source,
    target: connection.target,
    sourceHandle: architectureConnectionSide(connection.sourceHandle, edge.sourceHandle ?? "right"),
    targetHandle: architectureConnectionSide(connection.targetHandle, edge.targetHandle ?? "left"),
  })
}

export function architectureEdgeStyleOperation(
  resource: ArchitectureResource,
  edgeID: string,
  style: ArchitectureEdgeStyle,
) {
  const edge = resource.edges.find((candidate) => candidate.id === edgeID)
  if (!edge || (edge.style ?? "rectangular") === style) return
  return architectureEdgeUpdateOperation({ ...edge, style })
}

export function architectureEdgeHandleOperation(
  edge: ArchitectureEdge,
  field: "sourceHandle" | "targetHandle",
  side: ArchitectureConnectionSide,
) {
  return architectureEdgeUpdateOperation({ ...edge, [field]: side })
}

export function architectureEdgeUpdateOperation(edge: ArchitectureEdge): ArchitectureOperation {
  return { id: operationID(), type: "edge.update", edge }
}

export function architectureEdgeRemoveOperation(edgeID: string): ArchitectureOperation {
  return { id: operationID(), type: "edge.remove", edgeID }
}

export function architectureResourceRenameOperation(name: string): ArchitectureOperation {
  return { id: operationID(), type: "resource.update", name }
}

export function architectureTagColorOperation(tag: string, color: string | undefined): ArchitectureOperation {
  return { id: operationID(), type: "tag.color", tag, color }
}

export function architectureRenameTagOperations(resource: ArchitectureResource, current: string, next: string) {
  const targetExists = resource.nodes.some((node) => node.tags.includes(next))
  const operations = resource.nodes.flatMap((node): ArchitectureOperation[] => {
    if (!node.tags.includes(current)) return []
    return [architectureNodeUpdateOperation({ ...node, tags: unique(node.tags.map((tag) => (tag === current ? next : tag))) })]
  })
  const color = resource.tagColors?.[current]
  if (!color) return operations
  return [
    architectureTagColorOperation(current, undefined),
    ...operations,
    ...(targetExists || resource.tagColors?.[next] ? [] : [architectureTagColorOperation(next, color)]),
  ]
}

export function architectureSelectionDeleteOperations(resource: ArchitectureResource, selection: SelectionInput) {
  const selectedNodeIDs = new Set(selection.nodeIDs)
  const cascadedEdgeIDs = resource.edges
    .filter((edge) => selectedNodeIDs.has(edge.source) || selectedNodeIDs.has(edge.target))
    .map((edge) => edge.id)
  return [
    ...selection.nodeIDs.map((nodeID) => architectureNodeRemoveOperation(nodeID)),
    ...selection.edgeIDs
      .filter((edgeID) => !cascadedEdgeIDs.includes(edgeID))
      .map((edgeID) => architectureEdgeRemoveOperation(edgeID)),
  ]
}

export function architectureConnectionSide(value: string | null | undefined, fallback: ArchitectureConnectionSide) {
  return (["top", "right", "bottom", "left"] as const).find((side) => side === value) ?? fallback
}

function architectureNodeCreateOperation(input: {
  readonly id: string
  readonly text: string
  readonly tags: ReadonlyArray<string>
  readonly position: Position
}): ArchitectureOperation {
  return {
    id: operationID(),
    type: "node.create",
    node: {
      id: input.id,
      text: input.text,
      tags: input.tags,
      layout: { position: input.position },
    },
  }
}

function architectureEdgeCreateOperationForEdge(edge: ArchitectureEdge): ArchitectureOperation {
  return { id: operationID(), type: "edge.create", edge }
}

function samePosition(left: Position, right: Position) {
  return left.x === right.x && left.y === right.y
}

function unique(values: ReadonlyArray<string>) {
  return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right))
}
