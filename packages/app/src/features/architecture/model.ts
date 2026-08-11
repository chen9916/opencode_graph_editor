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
  const source = nodes.find((node) => node.id === edge.source)?.layout.position
  const target = nodes.find((node) => node.id === edge.target)?.layout.position
  const saved = { sourceHandle: edge.sourceHandle ?? "right", targetHandle: edge.targetHandle ?? "left" }
  if (!source || !target || samePosition(source, target))
    return saved
  // Keep explicit non-default endpoint choices stable; legacy/default right-left
  // anchors are the ones we reflow from layout to reduce crossed wires.
  if (hasExplicitConnectionSides(edge)) return saved
  const delta = { x: target.x - source.x, y: target.y - source.y }
  if (Math.abs(delta.x) >= Math.abs(delta.y))
    return delta.x >= 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" }
  return delta.y >= 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" }
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
  const endpoints = edges.flatMap((edge) => {
    const sides = architectureRenderedConnectionSides(edge, nodes)
    return [
      {
        edgeID: edge.id,
        nodeID: edge.source,
        type: "source" as const,
        side: sides.sourceHandle,
        id: architectureRenderEdgeHandleID(edge.id, "source", sides.sourceHandle),
      },
      {
        edgeID: edge.id,
        nodeID: edge.target,
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

function hasExplicitConnectionSides(edge: ArchitectureEdge) {
  return (!!edge.sourceHandle && edge.sourceHandle !== "right") || (!!edge.targetHandle && edge.targetHandle !== "left")
}

function endpointHandleOrder(
  left: { readonly edgeID: string; readonly type: ArchitectureEndpointHandleType; readonly id: string },
  right: { readonly edgeID: string; readonly type: ArchitectureEndpointHandleType; readonly id: string },
) {
  return (
    left.edgeID.localeCompare(right.edgeID) || left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
  )
}
