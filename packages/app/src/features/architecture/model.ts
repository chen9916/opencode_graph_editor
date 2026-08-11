import type { Edge, Node } from "@xyflow/react"
import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureNode,
  ArchitectureResource,
} from "./contract"

type ArchitectureEndpointHandleType = "source" | "target"
type Position = { readonly x: number; readonly y: number }

export type ArchitectureFlowEndpointHandle = {
  readonly id: string
  readonly side: ArchitectureConnectionSide
  readonly type: ArchitectureEndpointHandleType
  readonly offset: number
}

export type ArchitectureFlowNode = Node<
  {
    readonly node: ArchitectureNode
    readonly tagColors?: ArchitectureResource["tagColors"]
    readonly tagColorsKey: string
    readonly dimmed?: boolean
    readonly editedHint?: boolean
    readonly edgeHandles?: ReadonlyArray<ArchitectureFlowEndpointHandle>
    readonly preview?: boolean
    readonly onTextChange: (node: ArchitectureNode, text: string) => void
    readonly onEditedHintSeen?: (nodeID: string) => void
  },
  "architecture"
>

export type ArchitectureFlowEdgeControls = {
  readonly label: string
  readonly styles: Readonly<Record<ArchitectureEdgeStyle, string>>
  readonly onChange: (edgeID: string, style: ArchitectureEdgeStyle) => void
}

export type ArchitectureFlowEdge = Edge<
  {
    readonly edge: ArchitectureEdge
    readonly style: ArchitectureEdgeStyle
    readonly dimmed?: boolean
    readonly controls?: ArchitectureFlowEdgeControls
  },
  "architecture"
>

const connectionSides = ["top", "right", "bottom", "left"] as const satisfies ReadonlyArray<ArchitectureConnectionSide>
const renderEdgeHandlePrefix = "architecture-edge-anchor:"

export function toReactFlow(
  resource: ArchitectureResource,
  onTextChange: (node: ArchitectureNode, text: string) => void,
  controls?: ArchitectureFlowEdgeControls,
) {
  const colorsKey = tagColorsKey(resource.tagColors)
  const endpointHandles = architectureFlowEndpointHandles(resource.edges, resource.nodes)
  return {
    nodes: resource.nodes.map(
      (node): ArchitectureFlowNode => ({
        id: node.id,
        type: "architecture",
        position: node.layout.position,
        data: {
          node,
          tagColors: resource.tagColors,
          tagColorsKey: colorsKey,
          edgeHandles: endpointHandles
            .filter((handle) => handle.nodeID === node.id)
            .map((handle) => ({ id: handle.id, side: handle.side, type: handle.type, offset: handle.offset })),
          onTextChange,
        },
      }),
    ),
    edges: resource.edges.map(
      (edge): ArchitectureFlowEdge => {
        const sides = architectureRenderedConnectionSides(edge, resource.nodes)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: architectureRenderEdgeHandleID(edge.id, "source", sides.sourceHandle),
          targetHandle: architectureRenderEdgeHandleID(edge.id, "target", sides.targetHandle),
          type: "architecture",
          data: { edge, style: edge.style ?? "rectangular", controls },
        }
      },
    ),
  }
}

export function architectureRenderedConnectionSides(
  edge: ArchitectureEdge,
  nodes: ReadonlyArray<ArchitectureNode>,
): { readonly sourceHandle: ArchitectureConnectionSide; readonly targetHandle: ArchitectureConnectionSide } {
  const saved = savedConnectionSides(edge)
  if (hasExplicitConnectionSides(edge)) return saved
  return architectureAutoConnectionSides(edge, nodes)
}

export function architectureAutoConnectionSides(
  edge: ArchitectureEdge,
  nodes: ReadonlyArray<ArchitectureNode>,
): { readonly sourceHandle: ArchitectureConnectionSide; readonly targetHandle: ArchitectureConnectionSide } {
  const source = nodes.find((node) => node.id === edge.source)?.layout.position
  const target = nodes.find((node) => node.id === edge.target)?.layout.position
  const saved = savedConnectionSides(edge)
  if (!source || !target || samePosition(source, target))
    return saved
  return architectureConnectionSidesFromPositions(source, target)
}

export function architectureRenderEdgeHandleID(
  edgeID: string,
  type: ArchitectureEndpointHandleType,
  side: ArchitectureConnectionSide,
) {
  return `${renderEdgeHandlePrefix}${type}:${side}:${edgeID}`
}

export function architectureRenderEdgeHandleSide(value: string | null | undefined) {
  if (!value?.startsWith(renderEdgeHandlePrefix)) return
  const side = value.slice(renderEdgeHandlePrefix.length).split(":")[1]
  return connectionSides.find((candidate) => candidate === side)
}

export function tagColorsKey(tagColors: ArchitectureResource["tagColors"] | undefined) {
  return Object.entries(tagColors ?? {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([tag, color]) => `${tag}:${color}`)
    .join("\u001f")
}

export function architectureNodeClass() {
  return "architecture-node"
}

function architectureFlowEndpointHandles(edges: ReadonlyArray<ArchitectureEdge>, nodes: ReadonlyArray<ArchitectureNode>) {
  const positions = new Map(nodes.map((node) => [node.id, node.layout.position] as const))
  const endpoints = edges.flatMap((edge) => {
    const sides = architectureRenderedConnectionSides(edge, nodes)
    return [
      {
        edgeID: edge.id,
        nodeID: edge.source,
        connectedPosition: positions.get(edge.target),
        type: "source" as const,
        side: sides.sourceHandle,
        id: architectureRenderEdgeHandleID(edge.id, "source", sides.sourceHandle),
      },
      {
        edgeID: edge.id,
        nodeID: edge.target,
        connectedPosition: positions.get(edge.source),
        type: "target" as const,
        side: sides.targetHandle,
        id: architectureRenderEdgeHandleID(edge.id, "target", sides.targetHandle),
      },
    ]
  })
  return endpoints.map((endpoint) => {
    const siblings = endpoints
      .filter((candidate) => candidate.nodeID === endpoint.nodeID && candidate.side === endpoint.side)
      .toSorted(endpointHandleOrder)
    return {
      ...endpoint,
      offset:
        ((siblings.findIndex((candidate) => candidate.id === endpoint.id) + 1) / (siblings.length + 1)) * 100,
    }
  })
}

function samePosition(left: Position, right: Position) {
  return left.x === right.x && left.y === right.y
}

function savedConnectionSides(edge: ArchitectureEdge) {
  return { sourceHandle: edge.sourceHandle ?? "right", targetHandle: edge.targetHandle ?? "left" }
}

function architectureConnectionSidesFromPositions(source: Position, target: Position) {
  const delta = { x: target.x - source.x, y: target.y - source.y }
  if (Math.abs(delta.x) >= Math.abs(delta.y))
    return delta.x >= 0
      ? { sourceHandle: "right" as const, targetHandle: "left" as const }
      : { sourceHandle: "left" as const, targetHandle: "right" as const }
  return delta.y >= 0
    ? { sourceHandle: "bottom" as const, targetHandle: "top" as const }
    : { sourceHandle: "top" as const, targetHandle: "bottom" as const }
}

function hasExplicitConnectionSides(edge: ArchitectureEdge) {
  return (!!edge.sourceHandle && edge.sourceHandle !== "right") || (!!edge.targetHandle && edge.targetHandle !== "left")
}

function endpointHandleOrder(
  left: {
    readonly edgeID: string
    readonly type: ArchitectureEndpointHandleType
    readonly id: string
    readonly side: ArchitectureConnectionSide
    readonly connectedPosition?: Position
  },
  right: {
    readonly edgeID: string
    readonly type: ArchitectureEndpointHandleType
    readonly id: string
    readonly side: ArchitectureConnectionSide
    readonly connectedPosition?: Position
  },
) {
  return (
    endpointHandlePosition(left) - endpointHandlePosition(right) ||
    endpointHandleSecondaryPosition(left) - endpointHandleSecondaryPosition(right) ||
    left.edgeID.localeCompare(right.edgeID) ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  )
}

function endpointHandlePosition(endpoint: { readonly side: ArchitectureConnectionSide; readonly connectedPosition?: Position }) {
  if (!endpoint.connectedPosition) return 0
  if (endpoint.side === "top" || endpoint.side === "bottom") return endpoint.connectedPosition.x
  return endpoint.connectedPosition.y
}

function endpointHandleSecondaryPosition(endpoint: {
  readonly side: ArchitectureConnectionSide
  readonly connectedPosition?: Position
}) {
  if (!endpoint.connectedPosition) return 0
  if (endpoint.side === "top" || endpoint.side === "bottom") return endpoint.connectedPosition.y
  return endpoint.connectedPosition.x
}
