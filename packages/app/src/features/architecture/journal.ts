import type { ArchitectureOperation, ArchitectureResource } from "./contract"

export type ArchitectureConflict = {
  readonly operation: ArchitectureOperation
  readonly reason: "changed" | "missing" | "exists"
}

type RebaseState = {
  readonly base: ArchitectureResource
  readonly latest: ArchitectureResource
  readonly operations: ArchitectureOperation[]
  readonly conflicts: ArchitectureConflict[]
}

type Decision = "apply" | ArchitectureConflict["reason"] | "skip"

export function applyOperations(
  graph: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
): ArchitectureResource {
  return operations.reduce(applyOperation, graph)
}

export function flattenJournal(batches: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>) {
  return batches.flatMap((batch) => batch)
}

export function rebaseOperations(
  base: ArchitectureResource,
  latest: ArchitectureResource,
  operations: ReadonlyArray<ArchitectureOperation>,
) {
  return operations.reduce<RebaseState>(
    (state, operation) => {
      const decision = applicable(state.base, state.latest, operation)
      const nextBase = applyOperation(state.base, operation)
      if (decision === "apply") {
        return {
          base: nextBase,
          latest: applyOperation(state.latest, operation),
          operations: [...state.operations, operation],
          conflicts: state.conflicts,
        }
      }
      if (decision === "skip") return { ...state, base: nextBase }
      return {
        ...state,
        base: nextBase,
        conflicts: [...state.conflicts, { operation, reason: decision }],
      }
    },
    {
      base,
      latest,
      operations: [] as ArchitectureOperation[],
      conflicts: [] as ArchitectureConflict[],
    },
  )
}

export function operationID() {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function applyOperation(graph: ArchitectureResource, operation: ArchitectureOperation): ArchitectureResource {
  if (operation.type === "resource.update")
    return {
      ...graph,
      name: operation.name,
    }
  if (operation.type === "tag.color") {
    const tagColors = { ...(graph.tagColors ?? {}) }
    if (operation.color) tagColors[operation.tag] = operation.color
    else delete tagColors[operation.tag]
    return withTagColors(graph, tagColors)
  }
  if (operation.type === "node.create") return { ...graph, nodes: [...graph.nodes, operation.node] }
  if (operation.type === "node.update")
    return {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === operation.node.id ? operation.node : node)),
    }
  if (operation.type === "node.position")
    return {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === operation.nodeID ? { ...node, layout: { position: operation.position } } : node,
      ),
    }
  if (operation.type === "node.remove")
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== operation.nodeID),
      edges: operation.cascade
        ? graph.edges.filter((edge) => edge.source !== operation.nodeID && edge.target !== operation.nodeID)
        : graph.edges,
    }
  if (operation.type === "edge.create") return { ...graph, edges: [...graph.edges, operation.edge] }
  if (operation.type === "edge.update")
    return {
      ...graph,
      edges: graph.edges.map((edge) => (edge.id === operation.edge.id ? operation.edge : edge)),
    }
  if (operation.type === "edge.remove")
    return { ...graph, edges: graph.edges.filter((edge) => edge.id !== operation.edgeID) }
  return graph
}

function applicable(
  base: ArchitectureResource,
  latest: ArchitectureResource,
  operation: ArchitectureOperation,
): Decision {
  if (operation.type === "resource.update") return same(base.name, latest.name) ? "apply" : "changed"
  if (operation.type === "tag.color")
    return same(base.tagColors?.[operation.tag], latest.tagColors?.[operation.tag]) ? "apply" : "changed"
  if (operation.type === "node.create") {
    const current = latest.nodes.find((node) => node.id === operation.node.id)
    if (!current) return "apply"
    return same(current, operation.node) ? "skip" : "exists"
  }
  if (operation.type === "edge.create") {
    const current = latest.edges.find((edge) => edge.id === operation.edge.id)
    if (!current) return "apply"
    return same(current, operation.edge) ? "skip" : "exists"
  }
  if (operation.type === "node.update")
    return entityDecision(
      base.nodes.find((node) => node.id === operation.node.id),
      latest.nodes.find((node) => node.id === operation.node.id),
    )
  if (operation.type === "node.position" || operation.type === "node.remove")
    return entityDecision(
      base.nodes.find((node) => node.id === operation.nodeID),
      latest.nodes.find((node) => node.id === operation.nodeID),
    )
  if (operation.type === "edge.update")
    return entityDecision(
      base.edges.find((edge) => edge.id === operation.edge.id),
      latest.edges.find((edge) => edge.id === operation.edge.id),
    )
  if (operation.type === "edge.remove")
    return entityDecision(
      base.edges.find((edge) => edge.id === operation.edgeID),
      latest.edges.find((edge) => edge.id === operation.edgeID),
    )
  return "skip"
}

function entityDecision(base: unknown, latest: unknown): Decision {
  if (base === undefined && latest === undefined) return "skip"
  if (latest === undefined) return "missing"
  return same(base, latest) ? "apply" : "changed"
}

function same(left: unknown, right: unknown) {
  return canonical(left) === canonical(right)
}

function withTagColors(graph: ArchitectureResource, tagColors: NonNullable<ArchitectureResource["tagColors"]>) {
  if (Object.keys(tagColors).length > 0) return { ...graph, tagColors }
  return {
    version: graph.version,
    revision: graph.revision,
    id: graph.id,
    name: graph.name,
    nodes: graph.nodes,
    edges: graph.edges,
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`
}
