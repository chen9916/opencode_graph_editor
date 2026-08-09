import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"

// Graph resources and editor drafts are project-directory scoped. Workspace
// identity still scopes every non-Graph native tool through its full Location.
export function graphLocation(directory: string) {
  return Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID: undefined })
}
