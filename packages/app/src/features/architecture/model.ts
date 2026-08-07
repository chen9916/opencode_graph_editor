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
    edges: resource.edges.map((edge): ArchitectureFlowEdge => {
      const handles = connectionHandles(resource, edge)
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: handles.source,
        targetHandle: handles.target,
        type: edgeStyles[edge.id] ?? "smoothstep",
        data: { edge },
      }
    }),
  }
}

function connectionHandles(resource: ArchitectureResource, edge: ArchitectureEdge) {
  const source = resource.nodes.find((node) => node.id === edge.source)?.layout.position
  const target = resource.nodes.find((node) => node.id === edge.target)?.layout.position
  if (!source || !target) return { source: "right", target: "left" }
  const x = target.x - source.x
  const y = target.y - source.y
  if (Math.abs(x) >= Math.abs(y))
    return x >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" }
  return y >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" }
}

export function architectureNodeClass() {
  return "architecture-node"
}
