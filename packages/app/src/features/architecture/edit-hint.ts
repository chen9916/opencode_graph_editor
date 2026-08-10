import type { ArchitectureOperation, ArchitectureResource } from "./contract"

export function architectureTouchedNodeIDs(operations: ReadonlyArray<ArchitectureOperation>) {
  return Array.from(
    operations.reduce((nodeIDs, operation) => {
      if (operation.type === "node.create" || operation.type === "node.update") nodeIDs.add(operation.node.id)
      if (operation.type === "node.position") nodeIDs.add(operation.nodeID)
      return nodeIDs
    }, new Set<string>()),
  )
}

export function architectureExternallyChangedNodeIDs(previous: ArchitectureResource, next: ArchitectureResource) {
  return next.nodes
    .filter((node) => {
      const existing = previous.nodes.find((candidate) => candidate.id === node.id)
      return !existing || canonical(existing) !== canonical(node)
    })
    .map((node) => node.id)
    .toSorted((left, right) => left.localeCompare(right))
}

export function architectureResourceHintKey(resource: ArchitectureResource) {
  return canonical({
    id: resource.id,
    name: resource.name,
    nodes: resource.nodes,
    edges: resource.edges,
    tagColors: resource.tagColors,
  })
}

export function architectureEditedNodeHintsForResourceSync(input: {
  readonly current: ReadonlyArray<string>
  readonly previous: ArchitectureResource
  readonly next: ArchitectureResource
  readonly external: boolean
}) {
  if (!input.external)
    return filterArchitectureEditedNodeHints(
      input.current,
      input.next.nodes.map((node) => node.id),
    )
  return mergeArchitectureEditedNodeHints(
    input.current,
    architectureExternallyChangedNodeIDs(input.previous, input.next),
    input.next.nodes.map((node) => node.id),
  )
}

export function mergeArchitectureEditedNodeHints(
  current: ReadonlyArray<string>,
  nodeIDs: ReadonlyArray<string>,
  availableNodeIDs: ReadonlyArray<string>,
) {
  const available = new Set(availableNodeIDs)
  return filterArchitectureEditedNodeHints(Array.from(new Set([...current, ...nodeIDs])), available)
}

export function clearArchitectureEditedNodeHint(current: ReadonlyArray<string>, nodeID: string) {
  if (!current.includes(nodeID)) return current
  return current.filter((currentNodeID) => currentNodeID !== nodeID)
}

export function filterArchitectureEditedNodeHints(
  current: ReadonlyArray<string>,
  availableNodeIDs: ReadonlyArray<string> | ReadonlySet<string>,
) {
  const available = availableNodeIDs instanceof Set ? availableNodeIDs : new Set(availableNodeIDs)
  return current.filter((nodeID) => available.has(nodeID)).toSorted((left, right) => left.localeCompare(right))
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
