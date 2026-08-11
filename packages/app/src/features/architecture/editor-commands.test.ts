import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import {
  architectureConnectionSide,
  architectureEdgeCreateOperation,
  architectureEdgeReconnectOperation,
  architectureEdgeStyleOperation,
  architectureNodePositionOperations,
  architectureRenameTagOperations,
  architectureSelectionDeleteOperations,
} from "./editor-commands"

const resource = (): ArchitectureResource => ({
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  tagColors: { old: "#123456" },
  nodes: [
    { id: "a", text: "A", tags: ["old"], layout: { position: { x: 0, y: 0 } } },
    { id: "b", text: "B", tags: ["keep", "old"], layout: { position: { x: 100, y: 0 } } },
  ],
  edges: [{ id: "ab", source: "a", target: "b", sourceHandle: "right", targetHandle: "left", style: "rectangular" }],
})

describe("architecture editor command builders", () => {
  test("creates connection operations with side and style defaults", () => {
    const created = architectureEdgeCreateOperation({ source: "a", target: "b", sourceHandle: "bad", targetHandle: "top" })

    expect(created?.operation).toMatchObject({
      type: "edge.create",
      edge: { source: "a", target: "b", sourceHandle: "right", targetHandle: "top", style: "rectangular" },
    })
    expect(architectureConnectionSide("left", "right")).toBe("left")
    expect(architectureConnectionSide("bad", "right")).toBe("right")
  })

  test("updates edge style and reconnects without changing unchanged styles", () => {
    expect(architectureEdgeStyleOperation(resource(), "ab", "rectangular")).toBeUndefined()
    expect(architectureEdgeStyleOperation(resource(), "ab", "curved")).toMatchObject({
      type: "edge.update",
      edge: { id: "ab", style: "curved" },
    })
    expect(
      architectureEdgeReconnectOperation(resource(), "ab", { source: "b", target: "a", sourceHandle: "left" }),
    ).toMatchObject({
      type: "edge.update",
      edge: { source: "b", target: "a", sourceHandle: "left", targetHandle: "left" },
    })
  })

  test("builds position and selection delete operation batches", () => {
    expect(
      architectureNodePositionOperations(
        resource(),
        ["a", "b"],
        [
          { id: "a", position: { x: 0, y: 0 } },
          { id: "b", position: { x: 140, y: 20 } },
        ],
      ),
    ).toMatchObject([{ type: "node.position", nodeID: "b", position: { x: 140, y: 20 } }])

    expect(architectureSelectionDeleteOperations(resource(), { nodeIDs: ["a"], edgeIDs: ["ab"] })).toMatchObject([
      { type: "node.remove", nodeID: "a", cascade: true },
    ])
  })

  test("renames tags and preserves colors when the target tag is new", () => {
    expect(architectureRenameTagOperations(resource(), "old", "new")).toMatchObject([
      { type: "tag.color", tag: "old", color: undefined },
      { type: "node.update", node: { id: "a", tags: ["new"] } },
      { type: "node.update", node: { id: "b", tags: ["keep", "new"] } },
      { type: "tag.color", tag: "new", color: "#123456" },
    ])
  })
})
