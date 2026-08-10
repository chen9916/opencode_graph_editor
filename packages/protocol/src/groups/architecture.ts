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
    HttpApiEndpoint.post("architecture.resource.duplicate", "/api/architecture/resource/:resourceID/duplicate", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      payload: Architecture.ResourceDuplicateInput,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.duplicate",
          summary: "Duplicate graph resource",
          description:
            "Clone the current live Graph editor resource into a new managed graph resource without changing the source resource.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("architecture.resource.draft.get", "/api/architecture/resource/:resourceID/draft", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      success: Location.response(Architecture.DraftSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.draft.get",
          summary: "Get graph draft",
          description: "Load the live draft snapshot for one graph resource, falling back to the saved resource.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("architecture.resource.draft.patch", "/api/architecture/resource/:resourceID/draft", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      payload: Architecture.PatchInput,
      success: Location.response(Architecture.DraftSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.draft.patch",
          summary: "Update graph draft",
          description: "Apply graph edits to the live draft without writing the saved graph resource file.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("architecture.resource.draft.commit", "/api/architecture/resource/:resourceID/draft/commit", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      payload: Architecture.DraftCommitInput,
      success: Location.response(Architecture.ResourceSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.draft.commit",
          summary: "Commit graph draft",
          description: "Write the expected live graph draft to the saved graph resource file.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "architecture.resource.draft.discard",
      "/api/architecture/resource/:resourceID/draft/discard",
      {
        params: { resourceID: Architecture.ResourceID },
        query: LocationQuery,
        success: Location.response(Architecture.DraftSnapshot),
        error: errors,
      },
    )
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.draft.discard",
          summary: "Discard graph draft",
          description: "Discard the live graph draft and return the saved graph resource snapshot.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("architecture.resource.draft.reload", "/api/architecture/resource/:resourceID/draft/reload", {
      params: { resourceID: Architecture.ResourceID },
      query: LocationQuery,
      success: Location.response(Architecture.DraftSnapshot),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.architecture.resource.draft.reload",
          summary: "Reload saved graph",
          description: "Drop the live graph draft and reload the saved graph resource snapshot from disk.",
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
      title: "graph editor",
      description: "Location-scoped Graph editor resources shared by people and agents.",
    }),
  )
