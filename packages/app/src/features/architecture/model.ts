import type { Edge, Node } from "@xyflow/react"
import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureNode,
  ArchitectureResource,
} from "./contract"

type ArchitectureEndpointHandleType = "source" | "target"

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
  const endpointHandles = architectureFlowEndpointHandles(resource.edges)
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
      (edge): ArchitectureFlowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: architectureRenderEdgeHandleID(edge.id, "source", edge.sourceHandle ?? "right"),
        targetHandle: architectureRenderEdgeHandleID(edge.id, "target", edge.targetHandle ?? "left"),
        type: "architecture",
        data: { edge, style: edge.style ?? "rectangular", controls },
      }),
    ),
  }
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

function architectureFlowEndpointHandles(edges: ReadonlyArray<ArchitectureEdge>) {
  const endpoints = edges.flatMap((edge) => [
    {
      edgeID: edge.id,
      nodeID: edge.source,
      type: "source" as const,
      side: edge.sourceHandle ?? "right",
      id: architectureRenderEdgeHandleID(edge.id, "source", edge.sourceHandle ?? "right"),
    },
    {
      edgeID: edge.id,
      nodeID: edge.target,
      type: "target" as const,
      side: edge.targetHandle ?? "left",
      id: architectureRenderEdgeHandleID(edge.id, "target", edge.targetHandle ?? "left"),
    },
  ])
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

function endpointHandleOrder(
  left: { readonly edgeID: string; readonly type: ArchitectureEndpointHandleType; readonly id: string },
  right: { readonly edgeID: string; readonly type: ArchitectureEndpointHandleType; readonly id: string },
) {
  return (
    left.edgeID.localeCompare(right.edgeID) || left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
  )
}
