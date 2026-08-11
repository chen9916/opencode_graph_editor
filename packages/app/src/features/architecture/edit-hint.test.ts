import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation } from "./contract"
import {
  architectureEditedNodeHintsForResourceSync,
  architectureExternallyChangedNodeIDs,
  architectureResourceHintKey,
  architectureTouchedNodeIDs,
  clearArchitectureEditedNodeHint,
  filterArchitectureEditedNodeHints,
  mergeArchitectureEditedNodeHints,
} from "./edit-hint"

const node = (id: string) => ({
  id,
  text: id,
  tags: [],
  layout: { position: { x: 0, y: 0 } },
})

const resource = (nodes: ReturnType<typeof node>[]) => ({
  version: 2 as const,
  revision: 1,
  id: "design",
  name: "Design",
  nodes,
  edges: [],
})

describe("architecture edited node hints", () => {
  test("detects live node operations that can be hinted when they come from remote sync", () => {
    const operations: ArchitectureOperation[] = [
      { id: "create", type: "node.create", node: node("created") },
      { id: "update", type: "node.update", node: node("updated") },
      { id: "position", type: "node.position", nodeID: "moved", position: { x: 2, y: 3 } },
      { id: "remove", type: "node.remove", nodeID: "removed", cascade: true },
      { id: "edge", type: "edge.create", edge: { id: "edge", source: "created", target: "updated" } },
    ]

    expect(architectureTouchedNodeIDs(operations)).toEqual(["created", "updated", "moved"])
  })

  test("detects nodes changed by an external resource synchronization", () => {
    expect(
      architectureExternallyChangedNodeIDs(
        resource([node("same"), node("updated"), node("moved"), node("removed")]),
        resource([
          node("same"),
          { ...node("updated"), text: "updated remotely" },
          { ...node("moved"), layout: { position: { x: 4, y: 5 } } },
          node("created"),
        ]),
      ),
    ).toEqual(["created", "moved", "updated"])
  })

  test("does not create hints when synchronization only echoes a local edit", () => {
    expect(
      architectureEditedNodeHintsForResourceSync({
        current: ["existing", "removed"],
        previous: resource([node("existing")]),
        next: resource([node("existing"), node("local")]),
        external: false,
      }),
    ).toEqual(["existing"])
  })

  test("adds externally changed nodes to the current hint set", () => {
    expect(
      architectureEditedNodeHintsForResourceSync({
        current: ["existing"],
        previous: resource([node("existing"), node("updated")]),
        next: resource([node("existing"), { ...node("updated"), text: "updated remotely" }, node("created")]),
        external: true,
      }),
    ).toEqual(["created", "existing", "updated"])
  })

  test("matches locally authored resources independently from storage revision", () => {
    expect(architectureResourceHintKey(resource([node("local")]))).toBe(
      architectureResourceHintKey({ ...resource([node("local")]), revision: 12 }),
    )
  })

  test("keeps hint state transient and only for nodes still in the current resource", () => {
    expect(
      mergeArchitectureEditedNodeHints(
        ["existing", "removed"],
        ["updated", "removed"],
        ["existing", "updated"],
      ),
    ).toEqual(["existing", "updated"])

    expect(filterArchitectureEditedNodeHints(["existing", "removed"], ["existing"])).toEqual(["existing"])
  })

  test("clears only the node whose pointer has moved over the hint", () => {
    expect(clearArchitectureEditedNodeHint(["left", "right"], "left")).toEqual(["right"])
    expect(clearArchitectureEditedNodeHint(["right"], "left")).toEqual(["right"])
  })
})
