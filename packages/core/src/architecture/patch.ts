export * as ArchitecturePatch from "./patch"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Schema } from "effect"
import { Hash } from "../util/hash"

export class InvalidGraphError extends Schema.TaggedErrorClass<InvalidGraphError>()("Architecture.InvalidGraphError", {
  message: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("Architecture.ConflictError", {
  message: Schema.String,
  operationIDs: Schema.Array(Architecture.OperationID),
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Architecture.NotFoundError", {
  entity: Schema.Literals(["resource", "node", "edge"]),
  id: Schema.String,
}) {}

export type Error = InvalidGraphError | ConflictError | NotFoundError

export const empty = (input: Architecture.ResourceCreateInput): Architecture.Resource => ({
  version: 2,
  revision: 0,
  id: input.id ?? Architecture.ResourceID.create(),
  name: input.name,
  nodes: [],
  edges: [],
})

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`
}

export const digest = (resource: Architecture.Resource) => Hash.sha256(canonical(normalize(resource)))
export const entityDigest = (entity: Architecture.Node | Architecture.Edge) => Hash.sha256(canonical(entity))

export function normalize(resource: Architecture.Resource): Architecture.Resource {
  const tagColors = normalizeTagColors(resource)
  return {
    version: 2,
    revision: resource.revision,
    id: resource.id,
    name: resource.name,
    ...(tagColors ? { tagColors } : {}),
    nodes: resource.nodes
      .map((node) => ({
        id: node.id,
        text: node.text,
        tags: Array.from(new Set(node.tags)).toSorted(),
        layout: { position: node.layout.position },
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    edges: resource.edges
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        style: edge.style,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  }
}

export const validate = Effect.fn("ArchitecturePatch.validate")(function* (resource: Architecture.Resource) {
  if (resource.name.length > 256)
    return yield* new InvalidGraphError({ message: `Graph resource name is too long: ${resource.id}` })
  if (resource.nodes.length > 10_000)
    return yield* new InvalidGraphError({ message: "Graph resource exceeds 10,000 nodes" })
  if (resource.edges.length > 20_000)
    return yield* new InvalidGraphError({ message: "Graph resource exceeds 20,000 edges" })
  if (Object.keys(resource.tagColors ?? {}).length > 100)
    return yield* new InvalidGraphError({ message: "Graph resource exceeds 100 tag colors" })
  const nodes = new Set<string>()
  for (const node of resource.nodes) {
    if (nodes.has(node.id)) return yield* new InvalidGraphError({ message: `Duplicate node ID: ${node.id}` })
    nodes.add(node.id)
    if (node.text.length > 20_000) return yield* new InvalidGraphError({ message: `Node text is too long: ${node.id}` })
    if (node.tags.length > 100) return yield* new InvalidGraphError({ message: `Node has too many tags: ${node.id}` })
  }
  const edges = new Set<string>()
  const relationships = new Set<string>()
  for (const edge of resource.edges) {
    if (edges.has(edge.id)) return yield* new InvalidGraphError({ message: `Duplicate edge ID: ${edge.id}` })
    edges.add(edge.id)
    if (!nodes.has(edge.source))
      return yield* new InvalidGraphError({ message: `Edge ${edge.id} has unknown source ${edge.source}` })
    if (!nodes.has(edge.target))
      return yield* new InvalidGraphError({ message: `Edge ${edge.id} has unknown target ${edge.target}` })
    if (edge.source === edge.target)
      return yield* new InvalidGraphError({ message: `Edge ${edge.id} cannot connect a node to itself` })
    const relationship = `${edge.source}\0${edge.target}`
    if (relationships.has(relationship))
      return yield* new InvalidGraphError({
        message: `Duplicate relationship from ${edge.source} to ${edge.target}`,
      })
    relationships.add(relationship)
  }
  return resource
})

function conflict(operation: Architecture.Operation, message: string) {
  return new ConflictError({ message, operationIDs: [operation.id] })
}

function checkExpected(operation: Architecture.Operation, current: Architecture.Node | Architecture.Edge) {
  if (!("expectedDigest" in operation) || !operation.expectedDigest) return Effect.void
  const currentDigest = entityDigest(current)
  return operation.expectedDigest === currentDigest
    ? Effect.void
    : conflict(
        operation,
        `The target of ${operation.id} changed: expected digest ${operation.expectedDigest}, current digest ${currentDigest}`,
      )
}

export const apply = Effect.fn("ArchitecturePatch.apply")(function* (
  resource: Architecture.Resource,
  operations: ReadonlyArray<Architecture.Operation>,
) {
  const next = {
    name: resource.name,
    tagColors: resource.tagColors,
    nodes: [...resource.nodes],
    edges: [...resource.edges],
  }
  for (const operation of operations) {
    if (operation.type === "resource.update") {
      next.name = operation.name
      continue
    }
    if (operation.type === "tag.color") {
      const tagColors = { ...(next.tagColors ?? {}) }
      if (operation.color) tagColors[operation.tag] = operation.color
      else delete tagColors[operation.tag]
      next.tagColors = Object.keys(tagColors).length ? tagColors : undefined
      continue
    }
    if (operation.type === "node.create") {
      if (next.nodes.some((node) => node.id === operation.node.id))
        return yield* conflict(operation, `Node already exists: ${operation.node.id}`)
      next.nodes.push(operation.node)
      continue
    }
    if (operation.type === "node.update") {
      const index = next.nodes.findIndex((node) => node.id === operation.node.id)
      const current = next.nodes[index]
      if (!current) return yield* new NotFoundError({ entity: "node", id: operation.node.id })
      yield* checkExpected(operation, current)
      next.nodes[index] = operation.node
      continue
    }
    if (operation.type === "node.position") {
      const index = next.nodes.findIndex((node) => node.id === operation.nodeID)
      const current = next.nodes[index]
      if (!current) return yield* new NotFoundError({ entity: "node", id: operation.nodeID })
      yield* checkExpected(operation, current)
      next.nodes[index] = { ...current, layout: { position: operation.position } }
      continue
    }
    if (operation.type === "node.remove") {
      const index = next.nodes.findIndex((node) => node.id === operation.nodeID)
      const current = next.nodes[index]
      if (!current) return yield* new NotFoundError({ entity: "node", id: operation.nodeID })
      yield* checkExpected(operation, current)
      const connected = next.edges.some((edge) => edge.source === operation.nodeID || edge.target === operation.nodeID)
      if (connected && !operation.cascade)
        return yield* conflict(operation, `Node ${operation.nodeID} has connected relationships`)
      next.nodes.splice(index, 1)
      if (operation.cascade)
        next.edges = next.edges.filter((edge) => edge.source !== operation.nodeID && edge.target !== operation.nodeID)
      continue
    }
    if (operation.type === "edge.create") {
      if (next.edges.some((edge) => edge.id === operation.edge.id))
        return yield* conflict(operation, `Edge already exists: ${operation.edge.id}`)
      next.edges.push(operation.edge)
      continue
    }
    if (operation.type === "edge.update") {
      const index = next.edges.findIndex((edge) => edge.id === operation.edge.id)
      const current = next.edges[index]
      if (!current) return yield* new NotFoundError({ entity: "edge", id: operation.edge.id })
      yield* checkExpected(operation, current)
      next.edges[index] = operation.edge
      continue
    }
    const index = next.edges.findIndex((edge) => edge.id === operation.edgeID)
    const current = next.edges[index]
    if (!current) return yield* new NotFoundError({ entity: "edge", id: operation.edgeID })
    yield* checkExpected(operation, current)
    next.edges.splice(index, 1)
  }
  return yield* validate(
    normalize({
      version: 2,
      revision: resource.revision + 1,
      id: resource.id,
      name: next.name,
      tagColors: next.tagColors,
      nodes: next.nodes,
      edges: next.edges,
    }),
  )
})

function normalizeTagColors(resource: Architecture.Resource) {
  const entries = Object.entries(resource.tagColors ?? {})
    .map(([tag, color]) => [tag, color.toLowerCase() as Architecture.TagColor] as const)
    .toSorted(([left], [right]) => left.localeCompare(right))
  return entries.length ? (Object.fromEntries(entries) as NonNullable<Architecture.Resource["tagColors"]>) : undefined
}
