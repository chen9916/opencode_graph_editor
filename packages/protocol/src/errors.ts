import { Schema } from "effect"
import { Architecture } from "@opencode-ai/schema/architecture"

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
    field: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {}

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
  { httpApiStatus: 409 },
) {}

export class ServiceUnavailableError extends Schema.TaggedErrorClass<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  {
    message: Schema.String,
    service: Schema.optional(Schema.String),
  },
  { httpApiStatus: 503 },
) {}

export class UnknownError extends Schema.TaggedErrorClass<UnknownError>()(
  "UnknownError",
  {
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "ProviderNotFoundError",
  {
    providerID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class MessageNotFoundError extends Schema.TaggedErrorClass<MessageNotFoundError>()(
  "MessageNotFoundError",
  {
    sessionID: Schema.String,
    messageID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class InvalidCursorError extends Schema.TaggedErrorClass<InvalidCursorError>()(
  "InvalidCursorError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class PermissionNotFoundError extends Schema.TaggedErrorClass<PermissionNotFoundError>()(
  "PermissionNotFoundError",
  {
    requestID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class QuestionNotFoundError extends Schema.TaggedErrorClass<QuestionNotFoundError>()(
  "QuestionNotFoundError",
  {
    requestID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ForbiddenError extends Schema.TaggedErrorClass<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class PtyNotFoundError extends Schema.TaggedErrorClass<PtyNotFoundError>()(
  "PtyNotFoundError",
  {
    ptyID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ArchitectureNotFoundError extends Schema.TaggedErrorClass<ArchitectureNotFoundError>()(
  "ArchitectureNotFoundError",
  {
    entity: Schema.Literals(["resource", "node", "edge"]),
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ArchitectureConflictError extends Schema.TaggedErrorClass<ArchitectureConflictError>()(
  "ArchitectureConflictError",
  {
    error: Schema.Literal("GraphConflictError"),
    message: Schema.String,
    operationIDs: Schema.Array(Architecture.OperationID),
    resourceID: Schema.optional(Architecture.ResourceID),
    resourceName: Schema.optional(Schema.String),
    operation: Schema.optional(Schema.String),
    expected: Schema.optional(
      Schema.Struct({
        revision: Schema.optional(Schema.Int),
        digest: Schema.optional(Schema.String),
      }),
    ),
    actual: Schema.optional(
      Schema.Struct({
        revision: Schema.Int,
        digest: Schema.String,
      }),
    ),
    expectedRevision: Schema.optional(Schema.Int),
    expectedDigest: Schema.optional(Schema.String),
    currentRevision: Schema.optional(Schema.Int),
    currentDigest: Schema.optional(Schema.String),
    safeToRetry: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literals(["unknown", "partial"])])),
    conflictKind: Schema.optional(Schema.Literals(["draft_changed", "draft_missing"])),
    retryHint: Schema.optional(Schema.String),
  },
  { httpApiStatus: 409 },
) {}

export class ArchitectureInvalidGraphError extends Schema.TaggedErrorClass<ArchitectureInvalidGraphError>()(
  "ArchitectureInvalidGraphError",
  {
    message: Schema.String,
    version: Schema.optional(Schema.String),
  },
  { httpApiStatus: 422 },
) {}

export class ArchitectureUnavailableError extends Schema.TaggedErrorClass<ArchitectureUnavailableError>()(
  "ArchitectureUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
