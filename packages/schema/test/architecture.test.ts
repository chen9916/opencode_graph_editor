import { describe, expect, test } from "bun:test"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Schema } from "effect"

const resource = {
  version: 2 as const,
  revision: 0,
  id: "design",
  name: "Product design",
  tagColors: { planned: "#4C82FF" },
  nodes: [
    {
      id: "conversation",
      text: "People discuss the design with AI",
      tags: ["planned", "interaction"],
      layout: { position: { x: 0, y: 0 } },
    },
  ],
  edges: [],
}

describe("Architecture schema", () => {
  test("decodes the exact live instance identity required by commit", () => {
    expect(Schema.decodeUnknownSync(Architecture.LiveInstanceCommitInput)({ revision: 3, digest: "instance-digest" })).toEqual({
      revision: 3,
      digest: "instance-digest",
    })
    expect(() =>
      Schema.decodeUnknownSync(Architecture.LiveInstanceCommitInput)({ revision: -1, digest: "instance-digest" }),
    ).toThrow()
  })

  test("decodes optional duplicate targets", () => {
    expect(Schema.decodeUnknownSync(Architecture.ResourceDuplicateInput)({})).toEqual({})
    expect(
      Schema.decodeUnknownSync(Architecture.ResourceDuplicateInput)({ id: "design_copy", name: "Design copy" }),
    ).toMatchObject({ id: "design_copy", name: "Design copy" })
  })

  test("decodes a lightweight graph with text nodes and tags", () => {
    expect(Schema.decodeUnknownSync(Architecture.Resource)(resource)).toMatchObject({
      version: 2,
      id: "design",
      tagColors: { planned: "#4C82FF" },
      nodes: [{ text: "People discuss the design with AI", tags: ["planned", "interaction"] }],
    })
  })

  test("rejects unsupported resource versions", () => {
    expect(() => Schema.decodeUnknownSync(Architecture.Resource)({ ...resource, version: 3 })).toThrow()
  })

  test("rejects empty node text and tags", () => {
    expect(() =>
      Schema.decodeUnknownSync(Architecture.Resource)({
        ...resource,
        nodes: [{ ...resource.nodes[0], text: "" }],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Architecture.Resource)({
        ...resource,
        nodes: [{ ...resource.nodes[0], tags: [""] }],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Architecture.Resource)({
        ...resource,
        tagColors: { planned: "blue" },
      }),
    ).toThrow()
  })

  test("decodes tag color patch operations", () => {
    expect(
      Schema.decodeUnknownSync(Architecture.Operation)({
        id: "color",
        type: "tag.color",
        tag: "planned",
        color: "#4c82ff",
      }),
    ).toMatchObject({ type: "tag.color", tag: "planned", color: "#4c82ff" })
  })

  test("decodes explicit connection sides while accepting legacy connections", () => {
    const nodes = [
      resource.nodes[0],
      { ...resource.nodes[0], id: "memory", text: "Memory", layout: { position: { x: 200, y: 0 } } },
    ]
    expect(
      Schema.decodeUnknownSync(Architecture.Resource)({
        ...resource,
        nodes,
        edges: [
          {
            id: "conversation-memory",
            source: "conversation",
            target: "memory",
            sourceHandle: "bottom",
            targetHandle: "top",
          },
        ],
      }).edges[0],
    ).toMatchObject({ sourceHandle: "bottom", targetHandle: "top" })
    expect(
      Schema.decodeUnknownSync(Architecture.Resource)({
        ...resource,
        nodes,
        edges: [{ id: "legacy", source: "conversation", target: "memory" }],
      }).edges[0],
    ).not.toHaveProperty("sourceHandle")
  })

  test("drops fields from the previous richer graph model", () => {
    const encoded = Schema.encodeSync(Architecture.Resource)(
      Schema.decodeUnknownSync(Architecture.Resource)({ ...resource, metadata: { obsolete: true }, references: [] }),
    )
    expect(encoded).not.toHaveProperty("metadata")
    expect(encoded).not.toHaveProperty("references")
  })
})
