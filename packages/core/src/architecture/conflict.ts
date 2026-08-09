export * as ArchitectureConflict from "./conflict"

import { Architecture } from "@opencode-ai/schema/architecture"
import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export const Message = "Graph resource changed before this edit could be applied."
export const RetryHint = "Reload the graph resource and retry the edit against the latest digest."

export const SafeToRetry = Schema.Union([Schema.Boolean, Schema.Literals(["unknown", "partial"])])
export type SafeToRetry = typeof SafeToRetry.Type

export const Kind = Schema.Literals(["draft_changed", "draft_missing"])
export type Kind = typeof Kind.Type

export const Expected = Schema.Struct({
  revision: Schema.optional(NonNegativeInt),
  digest: Schema.optional(Schema.String),
})
export type Expected = typeof Expected.Type

export const Actual = Schema.Struct({
  revision: NonNegativeInt,
  digest: Schema.String,
})
export type Actual = typeof Actual.Type

export type Details = {
  readonly message: string
  readonly resourceID: Architecture.ResourceID
  readonly resourceName?: string
  readonly operation: string
  readonly expected?: Expected
  readonly actual: Actual
  readonly expectedRevision?: number
  readonly expectedDigest?: string
  readonly currentRevision: number
  readonly currentDigest: string
  readonly safeToRetry: SafeToRetry
  readonly conflictKind?: Kind
  readonly retryHint: string
  readonly operationIDs: ReadonlyArray<Architecture.OperationID>
}

export function make(input: {
  readonly resourceID: Architecture.ResourceID
  readonly resourceName?: string
  readonly operation: string
  readonly expected?: Expected
  readonly actual: Actual
  readonly safeToRetry?: SafeToRetry
  readonly conflictKind?: Kind
  readonly operationIDs?: ReadonlyArray<Architecture.OperationID>
}): Details {
  return {
    message: Message,
    resourceID: input.resourceID,
    resourceName: input.resourceName,
    operation: input.operation,
    expected: input.expected,
    actual: input.actual,
    expectedRevision: input.expected?.revision,
    expectedDigest: input.expected?.digest,
    currentRevision: input.actual.revision,
    currentDigest: input.actual.digest,
    safeToRetry: input.safeToRetry ?? "unknown",
    conflictKind: input.conflictKind,
    retryHint: RetryHint,
    operationIDs: input.operationIDs ?? [],
  }
}

export function payload(input: Details) {
  return {
    error: "GraphConflictError" as const,
    message: Message,
    resourceID: input.resourceID,
    resourceName: input.resourceName,
    operation: input.operation,
    expected: input.expected,
    actual: input.actual,
    expectedRevision: input.expectedRevision,
    expectedDigest: input.expectedDigest,
    currentRevision: input.currentRevision,
    currentDigest: input.currentDigest,
    safeToRetry: input.safeToRetry,
    conflictKind: input.conflictKind,
    retryHint: input.retryHint,
    operationIDs: input.operationIDs,
  }
}

export function describe(input: Details) {
  return [
    input.message,
    `resourceID=${input.resourceID}`,
    input.resourceName ? `resourceName=${JSON.stringify(input.resourceName)}` : "",
    `operation=${input.operation}`,
    input.expectedRevision === undefined ? "" : `expected revision ${input.expectedRevision}`,
    input.expectedDigest === undefined ? "" : `expected digest ${input.expectedDigest}`,
    `current revision ${input.currentRevision}`,
    `current digest ${input.currentDigest}`,
    `safeToRetry=${String(input.safeToRetry)}`,
    input.conflictKind ? `conflictKind=${input.conflictKind}` : "",
    input.operationIDs.length > 0 ? `operationIDs=${input.operationIDs.join(",")}` : "",
    input.retryHint,
  ]
    .filter(Boolean)
    .join(" ")
}
