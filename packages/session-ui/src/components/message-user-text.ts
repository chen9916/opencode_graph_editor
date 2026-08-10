import type { Part, TextPart } from "@opencode-ai/sdk/v2"

export function userVisibleTextPart(parts: readonly Part[] | undefined) {
  return parts?.find((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored)
}
