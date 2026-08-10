export * as Architecture from "./architecture"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { NonNegativeInt, RelativePath, optional, statics } from "./schema"

const Identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/))

export const ResourceID = Identifier.pipe(
  Schema.brand("Architecture.ResourceID"),
  statics((schema) => ({ create: () => schema.make("design_" + ascending()) })),
)
export type ResourceID = typeof ResourceID.Type

export const NodeID = Identifier.pipe(
  Schema.brand("Architecture.NodeID"),
  statics((schema) => ({ create: () => schema.make("node_" + ascending()) })),
)
export type NodeID = typeof NodeID.Type

export const EdgeID = Identifier.pipe(
  Schema.brand("Architecture.EdgeID"),
  statics((schema) => ({ create: () => schema.make("edge_" + ascending()) })),
)
export type EdgeID = typeof EdgeID.Type

export const OperationID = Identifier.pipe(
  Schema.brand("Architecture.OperationID"),
  statics((schema) => ({ create: () => schema.make("op_" + ascending()) })),
)
export type OperationID = typeof OperationID.Type

export const Tag = Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))).annotate({
  identifier: "Architecture.Tag",
})
export type Tag = typeof Tag.Type

export const TagColor = Schema.String.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/)).annotate({
  identifier: "Architecture.TagColor",
})
export type TagColor = typeof TagColor.Type

export interface Position extends Schema.Schema.Type<typeof Position> {}
export const Position = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
}).annotate({ identifier: "Architecture.Position" })

export interface Node extends Schema.Schema.Type<typeof Node> {}
export const Node = Schema.Struct({
  id: NodeID,
  text: Schema.NonEmptyString,
  tags: Schema.Array(Tag),
  layout: Schema.Struct({ position: Position }),
}).annotate({ identifier: "Architecture.Node" })

export const ConnectionSide = Schema.Literals(["top", "right", "bottom", "left"]).annotate({
  identifier: "Architecture.ConnectionSide",
})
export type ConnectionSide = typeof ConnectionSide.Type

export const EdgeStyle = Schema.Literals(["rectangular", "curved", "straight"]).annotate({
  identifier: "Architecture.EdgeStyle",
})
export type EdgeStyle = typeof EdgeStyle.Type

export interface Edge extends Schema.Schema.Type<typeof Edge> {}
export const Edge = Schema.Struct({
  id: EdgeID,
  source: NodeID,
  target: NodeID,
  sourceHandle: ConnectionSide.pipe(optional),
  targetHandle: ConnectionSide.pipe(optional),
  style: EdgeStyle.pipe(optional),
}).annotate({ identifier: "Architecture.Edge" })

export interface Resource extends Schema.Schema.Type<typeof Resource> {}
export const Resource = Schema.Struct({
  version: Schema.Literal(2),
  revision: NonNegativeInt,
  id: ResourceID,
  name: Schema.NonEmptyString,
  tagColors: Schema.Record(Tag, TagColor).pipe(optional),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
}).annotate({ identifier: "Architecture.Resource" })

export interface ResourceSummary extends Schema.Schema.Type<typeof ResourceSummary> {}
export const ResourceSummary = Schema.Struct({
  id: ResourceID,
  name: Schema.NonEmptyString,
  revision: NonNegativeInt,
  digest: Schema.String,
  nodes: NonNegativeInt,
  edges: NonNegativeInt,
}).annotate({ identifier: "Architecture.ResourceSummary" })

export interface Storage extends Schema.Schema.Type<typeof Storage> {}
export const Storage = Schema.Struct({
  root: Schema.String,
  path: RelativePath,
}).annotate({ identifier: "Architecture.Storage" })

export interface ResourceSnapshot extends Schema.Schema.Type<typeof ResourceSnapshot> {}
export const ResourceSnapshot = Schema.Struct({
  resource: Resource,
  digest: Schema.String,
  storage: Storage,
}).annotate({ identifier: "Architecture.ResourceSnapshot" })

export const DraftSource = Schema.Literals(["live", "saved"]).annotate({
  identifier: "Architecture.DraftSource",
})
export type DraftSource = typeof DraftSource.Type

export interface DraftSnapshot extends Schema.Schema.Type<typeof DraftSnapshot> {}
export const DraftSnapshot = Schema.Struct({
  snapshot: ResourceSnapshot,
  source: DraftSource,
}).annotate({ identifier: "Architecture.DraftSnapshot" })

export interface DraftCommitInput extends Schema.Schema.Type<typeof DraftCommitInput> {}
export const DraftCommitInput = Schema.Struct({
  revision: NonNegativeInt,
  digest: Schema.String,
}).annotate({ identifier: "Architecture.DraftCommitInput" })

export interface ResourceCreateInput extends Schema.Schema.Type<typeof ResourceCreateInput> {}
export const ResourceCreateInput = Schema.Struct({
  id: ResourceID.pipe(optional),
  name: Schema.NonEmptyString,
}).annotate({ identifier: "Architecture.ResourceCreateInput" })

export interface ResourceDuplicateInput extends Schema.Schema.Type<typeof ResourceDuplicateInput> {}
export const ResourceDuplicateInput = Schema.Struct({
  id: ResourceID.pipe(optional),
  name: Schema.NonEmptyString.pipe(optional),
}).annotate({ identifier: "Architecture.ResourceDuplicateInput" })

export interface ResourceRemoveInput extends Schema.Schema.Type<typeof ResourceRemoveInput> {}
export const ResourceRemoveInput = Schema.Struct({
  revision: NonNegativeInt,
  digest: Schema.String,
}).annotate({ identifier: "Architecture.ResourceRemoveInput" })

export interface ResourceUpdate extends Schema.Schema.Type<typeof ResourceUpdate> {}
export const ResourceUpdate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("resource.update"),
  name: Schema.NonEmptyString,
})

export interface TagColorUpdate extends Schema.Schema.Type<typeof TagColorUpdate> {}
export const TagColorUpdate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("tag.color"),
  tag: Tag,
  color: TagColor.pipe(optional),
})

export interface NodeCreate extends Schema.Schema.Type<typeof NodeCreate> {}
export const NodeCreate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("node.create"),
  node: Node,
})

export interface NodeUpdate extends Schema.Schema.Type<typeof NodeUpdate> {}
export const NodeUpdate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("node.update"),
  node: Node,
  expectedDigest: Schema.String.pipe(optional),
})

export interface NodePosition extends Schema.Schema.Type<typeof NodePosition> {}
export const NodePosition = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("node.position"),
  nodeID: NodeID,
  position: Position,
  expectedDigest: Schema.String.pipe(optional),
})

export interface NodeRemove extends Schema.Schema.Type<typeof NodeRemove> {}
export const NodeRemove = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("node.remove"),
  nodeID: NodeID,
  cascade: Schema.Boolean,
  expectedDigest: Schema.String.pipe(optional),
})

export interface EdgeCreate extends Schema.Schema.Type<typeof EdgeCreate> {}
export const EdgeCreate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("edge.create"),
  edge: Edge,
})

export interface EdgeUpdate extends Schema.Schema.Type<typeof EdgeUpdate> {}
export const EdgeUpdate = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("edge.update"),
  edge: Edge,
  expectedDigest: Schema.String.pipe(optional),
})

export interface EdgeRemove extends Schema.Schema.Type<typeof EdgeRemove> {}
export const EdgeRemove = Schema.Struct({
  id: OperationID,
  type: Schema.Literal("edge.remove"),
  edgeID: EdgeID,
  expectedDigest: Schema.String.pipe(optional),
})

export const Operation = Schema.Union([
  ResourceUpdate,
  TagColorUpdate,
  NodeCreate,
  NodeUpdate,
  NodePosition,
  NodeRemove,
  EdgeCreate,
  EdgeUpdate,
  EdgeRemove,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Architecture.Operation" })
export type Operation = typeof Operation.Type

export interface PatchInput extends Schema.Schema.Type<typeof PatchInput> {}
export const PatchInput = Schema.Struct({
  revision: NonNegativeInt,
  digest: Schema.String,
  operations: Schema.Array(Operation),
}).annotate({ identifier: "Architecture.PatchInput" })

export interface QueryInput extends Schema.Schema.Type<typeof QueryInput> {}
export const QueryInput = Schema.Struct({
  resourceIDs: Schema.Array(ResourceID).pipe(optional),
  text: Schema.String.pipe(optional),
  nodeIDs: Schema.Array(NodeID).pipe(optional),
  tags: Schema.Array(Tag).pipe(optional),
  depth: NonNegativeInt.pipe(optional),
  limit: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "Architecture.QueryInput" })

export interface QueryNode extends Schema.Schema.Type<typeof QueryNode> {}
export const QueryNode = Schema.Struct({
  resourceID: ResourceID,
  node: Node,
}).annotate({ identifier: "Architecture.QueryNode" })

export interface QueryEdge extends Schema.Schema.Type<typeof QueryEdge> {}
export const QueryEdge = Schema.Struct({
  resourceID: ResourceID,
  edge: Edge,
}).annotate({ identifier: "Architecture.QueryEdge" })

export interface QueryResult extends Schema.Schema.Type<typeof QueryResult> {}
export const QueryResult = Schema.Struct({
  resources: Schema.Array(ResourceSummary),
  nodes: Schema.Array(QueryNode),
  edges: Schema.Array(QueryEdge),
  truncated: Schema.Boolean,
}).annotate({ identifier: "Architecture.QueryResult" })

const ResourceUpdated = define({
  type: "architecture.resource.updated",
  schema: {
    resourceID: ResourceID,
    revision: NonNegativeInt,
    digest: Schema.String,
  },
})

const ResourceRemoved = define({
  type: "architecture.resource.removed",
  schema: { resourceID: ResourceID },
})

const ResourceDraftUpdated = define({
  type: "architecture.resource.draft.updated",
  schema: {
    resourceID: ResourceID,
    revision: NonNegativeInt,
    digest: Schema.String,
    baseRevision: NonNegativeInt,
    baseDigest: Schema.String,
  },
})

const ResourceDraftDiscarded = define({
  type: "architecture.resource.draft.discarded",
  schema: {
    resourceID: ResourceID,
    revision: NonNegativeInt.pipe(optional),
    digest: Schema.String.pipe(optional),
  },
})

export const Event = {
  ResourceUpdated,
  ResourceRemoved,
  ResourceDraftUpdated,
  ResourceDraftDiscarded,
  Definitions: inventory(ResourceUpdated, ResourceRemoved, ResourceDraftUpdated, ResourceDraftDiscarded),
}
