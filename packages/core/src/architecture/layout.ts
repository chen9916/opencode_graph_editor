export * as ArchitectureLayout from "./layout"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

const untagged = "(untagged)"
const defaultOrigin = { x: 0, y: 0 } as const
const defaultSpacing = { x: 280, y: 160 } as const

export const Mode = Schema.Literals(["columns", "tree", "grid", "byTags"])
export type Mode = typeof Mode.Type

export const Column = Schema.Struct({
  title: Schema.optional(Schema.String),
  nodeIDs: Schema.Array(Architecture.NodeID),
})
export type Column = typeof Column.Type

export const Input = Schema.Struct({
  resourceID: Architecture.ResourceID,
  mode: Mode,
  origin: Schema.optional(Architecture.Position),
  spacing: Schema.optional(Architecture.Position),
  nodeIDs: Schema.optional(Schema.NullOr(Schema.Array(Architecture.NodeID))),
  columns: Schema.optional(Schema.NullOr(Schema.Array(Column))),
  rootNodeID: Schema.optional(Schema.NullOr(Architecture.NodeID)),
  tagOrder: Schema.optional(Schema.NullOr(Schema.Array(Architecture.Tag))),
  preserveUnlisted: Schema.optional(Schema.Boolean),
  dryRun: Schema.optional(Schema.Boolean),
})
export type Input = typeof Input.Type

export const PositionUpdate = Schema.Struct({
  nodeID: Architecture.NodeID,
  position: Architecture.Position,
})
export type PositionUpdate = typeof PositionUpdate.Type

export const Output = Schema.Struct({
  resourceID: Architecture.ResourceID,
  revision: Schema.optional(NonNegativeInt),
  digest: Schema.optional(Schema.String),
  mode: Mode,
  dryRun: Schema.Boolean,
  nodeIDs: Schema.Array(Architecture.NodeID),
  positions: Schema.Array(PositionUpdate),
})
export type Output = typeof Output.Type

export function plan(resource: Architecture.Resource, input: Input) {
  const origin = input.origin ?? defaultOrigin
  const spacing = input.spacing ?? defaultSpacing
  const nodes = selectedNodes(resource, input)
  const positions =
    input.mode === "grid"
      ? grid(nodes, origin, spacing)
      : input.mode === "tree"
        ? tree(resource, nodes, input.rootNodeID ?? undefined, origin, spacing)
        : input.mode === "byTags"
          ? columns(byTagColumns(nodes, input.tagOrder ?? undefined), origin, spacing)
          : columns(modeColumns(nodes, input.columns ?? undefined), origin, spacing)
  return {
    nodeIDs: positions.map((item) => item.nodeID),
    positions,
  }
}

export function referencedNodeIDs(input: Input) {
  return Array.from(
    new Set([
      ...(input.nodeIDs ?? []),
      ...((input.columns ?? [])?.flatMap((column) => column.nodeIDs) ?? []),
      ...(input.rootNodeID ? [input.rootNodeID] : []),
    ]),
  )
}

function selectedNodes(resource: Architecture.Resource, input: Input) {
  const selected = input.nodeIDs && input.nodeIDs.length > 0 ? new Set(input.nodeIDs) : undefined
  if (!selected || input.preserveUnlisted === false) return resource.nodes
  return resource.nodes.filter((node) => selected.has(node.id))
}

function modeColumns(nodes: ReadonlyArray<Architecture.Node>, input?: ReadonlyArray<Column>) {
  if (!input || input.length === 0) return groupedColumns(nodes, (node) => node.tags[0] ?? untagged)
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const placed = new Set<Architecture.NodeID>()
  const explicit = input.map((column) =>
    column.nodeIDs
      .map((id) => nodesByID.get(id))
      .filter((node): node is Architecture.Node => {
        if (!node || placed.has(node.id)) return false
        placed.add(node.id)
        return true
      }),
  )
  const remaining = nodes.filter((node) => !placed.has(node.id))
  return remaining.length > 0 ? [...explicit, remaining] : explicit
}

function byTagColumns(nodes: ReadonlyArray<Architecture.Node>, tagOrder?: ReadonlyArray<Architecture.Tag>) {
  const groups = groupedColumns(nodes, (node) => tagColumn(node, tagOrder))
  if (tagOrder && tagOrder.length > 0) {
    const order = new Map([...tagOrder, untagged].map((tag, index) => [tag, index]))
    return groups.toSorted(
      (left, right) =>
        (order.get(groupKey(left)) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(groupKey(right)) ?? Number.MAX_SAFE_INTEGER),
    )
  }
  return groups.toSorted((left, right) => {
    if (groupKey(left) === untagged) return 1
    if (groupKey(right) === untagged) return -1
    return groupKey(left).localeCompare(groupKey(right))
  })
}

function groupedColumns(nodes: ReadonlyArray<Architecture.Node>, key: (node: Architecture.Node) => string) {
  return Array.from(
    nodes.reduce((groups, node) => groups.set(key(node), [...(groups.get(key(node)) ?? []), node]), new Map<string, Architecture.Node[]>()),
  ).map(([tag, values]) => Object.assign(values, { tag }))
}

function groupKey(nodes: ReadonlyArray<Architecture.Node> & { readonly tag?: string }) {
  return nodes.tag ?? untagged
}

function tagColumn(node: Architecture.Node, tagOrder?: ReadonlyArray<Architecture.Tag>) {
  if (tagOrder && tagOrder.length > 0) return tagOrder.find((tag) => node.tags.includes(tag)) ?? node.tags[0] ?? untagged
  return node.tags.toSorted()[0] ?? untagged
}

function columns(
  input: ReadonlyArray<ReadonlyArray<Architecture.Node>>,
  origin: Architecture.Position,
  spacing: Architecture.Position,
): PositionUpdate[] {
  return input.flatMap((column, columnIndex) =>
    column.map((node, rowIndex) => ({
      nodeID: node.id,
      position: { x: origin.x + columnIndex * spacing.x, y: origin.y + rowIndex * spacing.y },
    })),
  )
}

function grid(
  nodes: ReadonlyArray<Architecture.Node>,
  origin: Architecture.Position,
  spacing: Architecture.Position,
): PositionUpdate[] {
  const count = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  return nodes.map((node, index) => ({
    nodeID: node.id,
    position: {
      x: origin.x + (index % count) * spacing.x,
      y: origin.y + Math.floor(index / count) * spacing.y,
    },
  }))
}

function tree(
  resource: Architecture.Resource,
  nodes: ReadonlyArray<Architecture.Node>,
  rootNodeID: Architecture.NodeID | undefined,
  origin: Architecture.Position,
  spacing: Architecture.Position,
): PositionUpdate[] {
  if (nodes.length === 0) return []
  const selected = new Set(nodes.map((node) => node.id))
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const incoming = new Set(
    resource.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)).map((edge) => edge.target),
  )
  const root =
    rootNodeID && selected.has(rootNodeID) ? rootNodeID : nodes.find((node) => !incoming.has(node.id))?.id ?? nodes[0]!.id
  const children = resource.edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .reduce(
      (map, edge) => map.set(edge.source, [...(map.get(edge.source) ?? []), edge.target]),
      new Map<Architecture.NodeID, Architecture.NodeID[]>(),
    )
  const levels = new Map<Architecture.NodeID, number>()
  const queue = [{ nodeID: root, level: 0 }]
  for (const item of queue) {
    if (levels.has(item.nodeID)) continue
    levels.set(item.nodeID, item.level)
    for (const child of (children.get(item.nodeID) ?? []).toSorted(
      (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    ))
      if (!levels.has(child)) queue.push({ nodeID: child, level: item.level + 1 })
  }
  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, Math.max(...levels.values()) + 1)
  }
  const fallbackLevel = Math.max(...levels.values()) + 1
  for (const node of nodes) if (!levels.has(node.id)) levels.set(node.id, fallbackLevel)
  const levelGroups = Array.from(levels).reduce(
    (groups, [nodeID, level]) => groups.set(level, [...(groups.get(level) ?? []), nodeID]),
    new Map<number, Architecture.NodeID[]>(),
  )
  return Array.from(levelGroups.entries())
    .toSorted(([left], [right]) => left - right)
    .flatMap(([level, nodeIDs]) =>
      nodeIDs
        .toSorted((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
        .map((nodeID, index) => ({
          nodeID,
          position: { x: origin.x + index * spacing.x, y: origin.y + level * spacing.y },
        })),
    )
}
