import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractModelContextFromParts, extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      {
        type: "image",
        filename: "a.png",
        mime: "image/png",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
      {
        type: "image",
        filename: "b.pdf",
        mime: "application/pdf",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
    ])
  })

  test("restores only the short visible text when synthetic Graph context is attached", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "What should I implement?",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "text_2",
        type: "text",
        text: "Graph selection in resource Design (overview).",
        synthetic: true,
        metadata: { kind: "graph-selection", description: "Graph selection context attached" },
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    expect(extractPromptFromParts(parts)).toEqual([
      { type: "text", content: "What should I implement?", start: 0, end: 24 },
    ])
    expect(extractModelContextFromParts(parts)).toEqual([
      {
        text: "Graph selection in resource Design (overview).",
        description: "Graph selection context attached",
        metadata: { kind: "graph-selection" },
      },
    ])
  })
})
