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
          summary: "List architecture resources",
          description: "List the saved architecture graphs available to people and agents in this project.",
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
          summary: "Create architecture resource",
          description: "Create a lightweight named architecture graph.",
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
          summary: "Get architecture resource",
          description: "Load one architecture graph for the requested project location.",
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
          summary: "Update architecture resource",
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
          summary: "Remove architecture resource",
          description: "Remove an architecture graph with optimistic concurrency checks.",
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
          summary: "Reset architecture resource",
          description: "Preserve an invalid graph as a recovery file and create an empty graph.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "architecture",
      description: "Location-scoped architecture graphs shared by people and agents.",
    }),
  )
