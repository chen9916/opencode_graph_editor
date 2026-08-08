import { Architecture } from "@opencode-ai/schema/architecture"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import {
  ArchitectureConflictError,
  ArchitectureInvalidGraphError,
  ArchitectureNotFoundError,
  ArchitectureUnavailableError,
} from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

const errors = [
  ArchitectureConflictError,
  ArchitectureInvalidGraphError,
  ArchitectureNotFoundError,
  ArchitectureUnavailableError,
] as const

export const ArchitectureGroup = HttpApiGroup.make("server.architecture")
  .add(
    HttpApiEndpoint.get("architecture.resource.list", "/api/architecture/resource", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Architecture.ResourceSummary)),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.list",
          summary: "List graph resources",
          description: "List the saved Graph editor resources available to people and agents in this project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("architecture.resource.create", "/api/architecture/resource", {
      query: LocationQuery,
      payload: Architecture.ResourceCreateInput,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.create",
          summary: "Create graph resource",
          description: "Create a lightweight named graph resource.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("architecture.resource.get", "/api/architecture/resource/:resourceID", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.get",
          summary: "Get graph resource",
          description: "Load one graph resource for the requested project location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("architecture.resource.patch", "/api/architecture/resource/:resourceID", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      payload: Architecture.PatchInput,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.patch",
          summary: "Update graph resource",
          description: "Atomically apply graph edits with optimistic concurrency checks.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("architecture.resource.remove", "/api/architecture/resource/:resourceID", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      payload: Architecture.ResourceRemoveInput,
      success: Location.response(Schema.Void),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.remove",
          summary: "Remove graph resource",
          description: "Remove a graph resource with optimistic concurrency checks.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("architecture.resource.reset", "/api/architecture/resource/:resourceID/reset", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.reset",
          summary: "Reset graph resource",
          description: "Preserve an invalid graph as a recovery file and create an empty graph.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "architecture",
      description: "Location-scoped Graph editor resources shared by people and agents.",
    }),
  )
