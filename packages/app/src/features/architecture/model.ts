import type { Edge, Node } from "@xyflow/react"
import type { ArchitectureEdge, ArchitectureEdgeStyle, ArchitectureNode, ArchitectureResource } from "./contract"

export type ArchitectureFlowNode = Node<
  {
    readonly node: ArchitectureNode
    readonly onTextChange: (node: ArchitectureNode, text: string) => void
  },
  "architecture"
>

export type ArchitectureFlowEdge = Edge<{
  readonly edge: ArchitectureEdge
}>

export function toReactFlow(
  resource: ArchitectureResource,
  onTextChange: (node: ArchitectureNode, text: string) => void,
  edgeStyles: Readonly<Record<string, ArchitectureEdgeStyle>> = {},
) {
  return {
    nodes: resource.nodes.map(
      (node): ArchitectureFlowNode => ({
        id: node.id,
        type: "architecture",
        position: node.layout.position,
        data: { node, onTextChange },
      }),
    ),
    edges: resource.edges.map(
      (edge): ArchitectureFlowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? "right",
        targetHandle: edge.targetHandle ?? "left",
        type: edgeStyles[edge.id] ?? "smoothstep",
        data: { edge },
      }),
    ),
  }
}

export function architectureNodeClass() {
  return "architecture-node"
}
