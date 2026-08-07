import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitectureResource } from "./contract"
import { applyOperations, rebaseOperations } from "./journal"

const node = (id: string, text = id) => ({
  id,
  text,
  tags: ["planned"],
  layout: { position: { x: 0, y: 0 } },
})

const resource = (nodes = [node("a")]): ArchitectureResource => ({
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes,
  edges: [],
})

describe("architecture journal", () => {
  test("applies cascade removal to connections locally", () => {
    const current: ArchitectureResource = {
      ...resource([node("a"), node("b")]),
      edges: [{ id: "edge", source: "a", target: "b" }],
    }
    const removed = applyOperations(current, [{ id: "op", type: "node.remove", nodeID: "a", cascade: true }])
    expect(removed.edges).toEqual([])
  })

  test("rebases disjoint edits and preserves same-entity conflicts", () => {
    const operations: ArchitectureOperation[] = [
      { id: "one", type: "node.update", node: node("a", "local") },
      { id: "two", type: "node.create", node: node("c") },
    ]
    const rebased = rebaseOperations(resource(), resource([node("a", "external")]), operations)
    expect(rebased.operations.map((operation) => operation.id)).toEqual(["two"])
    expect(rebased.conflicts.map((conflict) => conflict.operation.id)).toEqual(["one"])
  })
})
