import { describe, expect } from "bun:test"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Exit } from "effect"
import { it } from "./lib/effect"

const create = () => ArchitecturePatch.empty({ id: Architecture.ResourceID.make("design"), name: "Design" })
const node = (id: string, tags: string[] = []) => ({
  id: Architecture.NodeID.make(id),
  text: id,
  tags: tags.map((tag) => Architecture.Tag.make(tag)),
  layout: { position: { x: 0, y: 0 } },
})

describe("ArchitecturePatch", () => {
  it.effect("supports text nodes, free-form tags, and simple connections", () =>
    Effect.gen(function* () {
      const first = yield* ArchitecturePatch.apply(create(), [
        { id: Architecture.OperationID.make("a"), type: "node.create", node: node("conversation", ["planned"]) },
        { id: Architecture.OperationID.make("b"), type: "node.create", node: node("memory", ["implemented"]) },
      ])
      const linked = yield* ArchitecturePatch.apply(first, [
        {
          id: Architecture.OperationID.make("edge"),
          type: "edge.create",
          edge: {
            id: Architecture.EdgeID.make("uses"),
            source: Architecture.NodeID.make("conversation"),
            target: Architecture.NodeID.make("memory"),
          },
        },
      ])

      expect(linked.nodes.map((item) => item.tags)).toEqual([["planned"], ["implemented"]])
      expect(linked.edges[0]).toMatchObject({ source: "conversation", target: "memory" })
    }),
  )

  it.effect("requires cascade when removing a connected node", () =>
    Effect.gen(function* () {
      const populated = yield* ArchitecturePatch.apply(create(), [
        { id: Architecture.OperationID.make("a"), type: "node.create", node: node("a") },
        { id: Architecture.OperationID.make("b"), type: "node.create", node: node("b") },
        {
          id: Architecture.OperationID.make("edge"),
          type: "edge.create",
          edge: {
            id: Architecture.EdgeID.make("a-b"),
            source: Architecture.NodeID.make("a"),
            target: Architecture.NodeID.make("b"),
          },
        },
      ])
      const rejected = yield* ArchitecturePatch.apply(populated, [
        {
          id: Architecture.OperationID.make("remove-no-cascade"),
          type: "node.remove",
          nodeID: Architecture.NodeID.make("a"),
          cascade: false,
        },
      ]).pipe(Effect.exit)
      const removed = yield* ArchitecturePatch.apply(populated, [
        {
          id: Architecture.OperationID.make("remove-cascade"),
          type: "node.remove",
          nodeID: Architecture.NodeID.make("a"),
          cascade: true,
        },
      ])

      expect(Exit.isFailure(rejected)).toBe(true)
      expect(removed.nodes.map((item) => item.id)).toEqual([Architecture.NodeID.make("b")])
      expect(removed.edges).toEqual([])
    }),
  )

  it.effect("rejects stale entity updates", () =>
    Effect.gen(function* () {
      const created = yield* ArchitecturePatch.apply(create(), [
        { id: Architecture.OperationID.make("create"), type: "node.create", node: node("a") },
      ])
      const result = yield* ArchitecturePatch.apply(created, [
        {
          id: Architecture.OperationID.make("update"),
          type: "node.update",
          node: { ...created.nodes[0]!, text: "Changed" },
          expectedDigest: "stale",
        },
      ]).pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
    }),
  )

  it.effect("normalizes tag colors against current node tags", () =>
    Effect.gen(function* () {
      const created = yield* ArchitecturePatch.apply(create(), [
        { id: Architecture.OperationID.make("create"), type: "node.create", node: node("a", ["planned"]) },
      ])
      const colored = yield* ArchitecturePatch.apply(created, [
        {
          id: Architecture.OperationID.make("color"),
          type: "tag.color",
          tag: Architecture.Tag.make("planned"),
          color: Architecture.TagColor.make("#4C82FF"),
        },
      ])
      const removed = yield* ArchitecturePatch.apply(colored, [
        {
          id: Architecture.OperationID.make("remove"),
          type: "node.update",
          node: { ...colored.nodes[0]!, tags: [] },
        },
      ])

      expect(colored.tagColors).toEqual({ planned: "#4c82ff" })
      expect(removed).not.toHaveProperty("tagColors")
    }),
  )
})
