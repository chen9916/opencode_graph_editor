import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import { architectureConflictExplanation, architectureConflictExplanations } from "./conflict-explanation"

const resource: ArchitectureResource = {
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes: [{ id: "node", text: "Node", tags: ["planned"], layout: { position: { x: 0, y: 0 } } }],
  edges: [{ id: "edge", source: "node", target: "other" }],
}

describe("architecture conflict explanations", () => {
  test("describes operation and target metadata without changing conflict reasons", () => {
    expect(
      architectureConflictExplanation(
        { operation: { id: "move", type: "node.position", nodeID: "node", position: { x: 12, y: 8 } }, reason: "changed" },
        resource,
      ),
    ).toEqual({
      operationID: "move",
      operationType: "node.position",
      reason: "changed",
      target: { kind: "node", id: "node" },
    })
  })

  test("maps resource, tag, node, and edge operations to debug targets", () => {
    expect(
      architectureConflictExplanations(
        [
          { operation: { id: "rename", type: "resource.update", name: "Next" }, reason: "changed" },
          { operation: { id: "color", type: "tag.color", tag: "planned", color: "#ffffff" }, reason: "changed" },
          { operation: { id: "add", type: "node.create", node: resource.nodes[0]! }, reason: "exists" },
          { operation: { id: "remove", type: "edge.remove", edgeID: "edge" }, reason: "missing" },
        ],
        resource,
      ).map((explanation) => explanation.target),
    ).toEqual([
      { kind: "resource", id: "design" },
      { kind: "tag", id: "planned" },
      { kind: "node", id: "node" },
      { kind: "edge", id: "edge" },
    ])
  })
})
