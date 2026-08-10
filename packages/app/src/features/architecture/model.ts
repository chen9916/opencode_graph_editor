import type { Edge, Node } from "@xyflow/react"
import type { ArchitectureEdge, ArchitectureEdgeStyle, ArchitectureNode, ArchitectureResource } from "./contract"

export type ArchitectureFlowNode = Node<
  {
    readonly node: ArchitectureNode
    readonly tagColors?: ArchitectureResource["tagColors"]
    readonly tagColorsKey: string
    readonly dimmed?: boolean
    readonly editedHint?: boolean
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

export function toReactFlow(
  resource: ArchitectureResource,
  onTextChange: (node: ArchitectureNode, text: string) => void,
  controls?: ArchitectureFlowEdgeControls,
) {
  const colorsKey = tagColorsKey(resource.tagColors)
  return {
    nodes: resource.nodes.map(
      (node): ArchitectureFlowNode => ({
        id: node.id,
        type: "architecture",
        position: node.layout.position,
        data: { node, tagColors: resource.tagColors, tagColorsKey: colorsKey, onTextChange },
      }),
    ),
    edges: resource.edges.map(
      (edge): ArchitectureFlowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? "right",
        targetHandle: edge.targetHandle ?? "left",
        type: "architecture",
        data: { edge, style: edge.style ?? "rectangular", controls },
      }),
    ),
  }
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
