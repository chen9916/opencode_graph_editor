export * as ArchitectureValidation from "./validation"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

const nodeOverlapThreshold = { x: 80, y: 60 } as const
const validHandles = new Set(["top", "right", "bottom", "left"])
const validStyles = new Set(["rectangular", "curved", "straight"])

export const Checks = Schema.Struct({
  brokenEdges: Schema.optional(Schema.Boolean),
  duplicateIDs: Schema.optional(Schema.Boolean),
  tagColors: Schema.optional(Schema.Boolean),
  nodesWithoutTags: Schema.optional(Schema.Boolean),
  emptyNodeText: Schema.optional(Schema.Boolean),
  invalidHandles: Schema.optional(Schema.Boolean),
  invalidStyles: Schema.optional(Schema.Boolean),
  overlappingNodes: Schema.optional(Schema.Boolean),
  isolatedNodes: Schema.optional(Schema.Boolean),
})
export type Checks = typeof Checks.Type

export const Input = Schema.Struct({
  resourceIDs: Schema.optional(Schema.NullOr(Schema.Array(Architecture.ResourceID))),
  checks: Schema.optional(Schema.NullOr(Checks)),
})
export type Input = typeof Input.Type

export const Issue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  nodeID: Schema.optional(Architecture.NodeID),
  edgeID: Schema.optional(Architecture.EdgeID),
  tag: Schema.optional(Architecture.Tag),
  details: Schema.optional(Schema.Unknown),
})
export type Issue = typeof Issue.Type

export const ResourceReport = Schema.Struct({
  resourceID: Architecture.ResourceID,
  name: Schema.String,
  revision: NonNegativeInt,
  digest: Schema.String,
  valid: Schema.Boolean,
  nodes: NonNegativeInt,
  edges: NonNegativeInt,
  issueCount: NonNegativeInt,
  issues: Schema.Array(Issue),
})
export type ResourceReport = typeof ResourceReport.Type

export const Summary = Schema.Struct({
  checked: NonNegativeInt,
  valid: NonNegativeInt,
  invalid: NonNegativeInt,
  totalIssues: NonNegativeInt,
  errors: NonNegativeInt,
  warnings: NonNegativeInt,
})
export type Summary = typeof Summary.Type

export const Output = Schema.Struct({
  valid: Schema.Boolean,
  summary: Summary,
  resources: Schema.Array(ResourceReport),
})
export type Output = typeof Output.Type

const defaultChecks = {
  brokenEdges: true,
  duplicateIDs: true,
  tagColors: true,
  nodesWithoutTags: true,
  emptyNodeText: true,
  invalidHandles: true,
  invalidStyles: true,
  overlappingNodes: false,
  isolatedNodes: false,
} as const satisfies Required<Checks>

export function validateResources(
  snapshots: ReadonlyArray<{ readonly resource: Architecture.Resource; readonly digest: string }>,
  checks?: Checks | null,
): Output {
  const reports = snapshots.map((snapshot) => validateResource(snapshot.resource, snapshot.digest, checks))
  const errors = reports.reduce(
    (count, report) => count + report.issues.filter((issue) => issue.severity === "error").length,
    0,
  )
  const warnings = reports.reduce(
    (count, report) => count + report.issues.filter((issue) => issue.severity === "warning").length,
    0,
  )
  const valid = reports.filter((report) => report.valid).length
  return {
    valid: errors === 0,
    summary: {
      checked: reports.length,
      valid,
      invalid: reports.length - valid,
      totalIssues: errors + warnings,
      errors,
      warnings,
    },
    resources: reports,
  }
}

export function validateResource(
  resource: Architecture.Resource,
  digest: string,
  checks?: Checks | null,
): ResourceReport {
  const enabled = { ...defaultChecks, ...(checks ?? {}) }
  const issues = [
    ...(enabled.duplicateIDs ? duplicateIDIssues(resource) : []),
    ...(enabled.brokenEdges ? brokenEdgeIssues(resource) : []),
    ...(enabled.tagColors ? tagColorIssues(resource) : []),
    ...(enabled.nodesWithoutTags ? nodeTagIssues(resource) : []),
    ...(enabled.emptyNodeText ? emptyTextIssues(resource) : []),
    ...(enabled.invalidHandles ? invalidHandleIssues(resource) : []),
    ...(enabled.invalidStyles ? invalidStyleIssues(resource) : []),
    ...(enabled.overlappingNodes ? overlappingNodeIssues(resource) : []),
    ...(enabled.isolatedNodes ? isolatedNodeIssues(resource) : []),
  ]
  const errors = issues.filter((issue) => issue.severity === "error").length
  return {
    resourceID: resource.id,
    name: resource.name,
    revision: resource.revision,
    digest,
    valid: errors === 0,
    nodes: resource.nodes.length,
    edges: resource.edges.length,
    issueCount: issues.length,
    issues,
  }
}

function duplicateIDIssues(resource: Architecture.Resource): Issue[] {
  return [
    ...duplicates(resource.nodes.map((node) => node.id)).map(
      (item): Issue => ({
        severity: "error",
        code: "duplicate-node-id",
        message: `Duplicate node ID: ${item.id}`,
        nodeID: item.id as Architecture.NodeID,
        details: { count: item.count },
      }),
    ),
    ...duplicates(resource.edges.map((edge) => edge.id)).map(
      (item): Issue => ({
        severity: "error",
        code: "duplicate-edge-id",
        message: `Duplicate edge ID: ${item.id}`,
        edgeID: item.id as Architecture.EdgeID,
        details: { count: item.count },
      }),
    ),
  ]
}

function brokenEdgeIssues(resource: Architecture.Resource): Issue[] {
  const nodes = new Set(resource.nodes.map((node) => node.id))
  return resource.edges.flatMap((edge) => [
    ...(!nodes.has(edge.source)
      ? [
          {
            severity: "error" as const,
            code: "broken-edge-source",
            message: `Edge ${edge.id} references missing source node ${edge.source}`,
            edgeID: edge.id,
            nodeID: edge.source,
          },
        ]
      : []),
    ...(!nodes.has(edge.target)
      ? [
          {
            severity: "error" as const,
            code: "broken-edge-target",
            message: `Edge ${edge.id} references missing target node ${edge.target}`,
            edgeID: edge.id,
            nodeID: edge.target,
          },
        ]
      : []),
  ])
}

function tagColorIssues(resource: Architecture.Resource): Issue[] {
  const nodesByTag = new Map<string, Architecture.NodeID[]>()
  for (const node of resource.nodes) {
    for (const tag of node.tags) nodesByTag.set(tag, [...(nodesByTag.get(tag) ?? []), node.id])
  }
  return Array.from(nodesByTag)
    .filter(([tag]) => !resource.tagColors?.[tag])
    .map(
      ([tag, nodeIDs]): Issue => ({
        severity: "warning",
        code: "missing-tag-color",
        message: `Tag ${tag} is used but has no resource color`,
        tag: tag as Architecture.Tag,
        details: { nodeIDs },
      }),
    )
}

function nodeTagIssues(resource: Architecture.Resource): Issue[] {
  return resource.nodes
    .filter((node) => node.tags.length === 0)
    .map((node): Issue => ({
      severity: "error",
      code: "node-without-tags",
      message: `Node ${node.id} has no tags`,
      nodeID: node.id,
    }))
}

function emptyTextIssues(resource: Architecture.Resource): Issue[] {
  return resource.nodes
    .filter((node) => node.text.trim().length === 0)
    .map((node): Issue => ({
      severity: "error",
      code: "empty-node-text",
      message: `Node ${node.id} has empty text`,
      nodeID: node.id,
    }))
}

function invalidHandleIssues(resource: Architecture.Resource): Issue[] {
  return resource.edges.flatMap((edge) => [
    ...handleIssue(edge, "sourceHandle", edge.sourceHandle),
    ...handleIssue(edge, "targetHandle", edge.targetHandle),
  ])
}

function invalidStyleIssues(resource: Architecture.Resource): Issue[] {
  return resource.edges
    .filter((edge) => edge.style !== undefined && edge.style !== null && !validStyles.has(String(edge.style)))
    .map((edge): Issue => ({
      severity: "error",
      code: "invalid-style",
      message: `Edge ${edge.id} has unsupported style ${String(edge.style)}`,
      edgeID: edge.id,
      details: { style: edge.style },
    }))
}

function overlappingNodeIssues(resource: Architecture.Resource): Issue[] {
  return resource.nodes.flatMap((node, index) =>
    resource.nodes.slice(index + 1).flatMap((other) => {
      const dx = Math.abs(node.layout.position.x - other.layout.position.x)
      const dy = Math.abs(node.layout.position.y - other.layout.position.y)
      if (dx >= nodeOverlapThreshold.x || dy >= nodeOverlapThreshold.y) return []
      return [
        {
          severity: "warning" as const,
          code: "overlapping-nodes",
          message: `Nodes ${node.id} and ${other.id} are very close together`,
          nodeID: node.id,
          details: { otherNodeID: other.id, dx, dy },
        },
      ]
    }),
  )
}

function isolatedNodeIssues(resource: Architecture.Resource): Issue[] {
  const connected = new Set(resource.edges.flatMap((edge) => [edge.source, edge.target]))
  return resource.nodes
    .filter((node) => !connected.has(node.id))
    .map((node): Issue => ({
      severity: "warning",
      code: "isolated-node",
      message: `Node ${node.id} has no incoming or outgoing edges`,
      nodeID: node.id,
    }))
}

function handleIssue(
  edge: Architecture.Edge,
  field: "sourceHandle" | "targetHandle",
  value: unknown,
): Issue[] {
  if (value === undefined || value === null || validHandles.has(String(value))) return []
  return [
    {
      severity: "error",
      code: "invalid-handle",
      message: `Edge ${edge.id} has unsupported ${field} ${String(value)}`,
      edgeID: edge.id,
      details: { field, value },
    },
  ]
}

function duplicates(ids: ReadonlyArray<string>) {
  return Array.from(
    ids.reduce((counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1), new Map<string, number>()),
  )
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
}
