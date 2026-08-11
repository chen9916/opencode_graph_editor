import { describe, expect, test } from "bun:test"
import type { ArchitectureResource, ArchitectureSnapshot } from "./contract"
import { architectureEditorInitialKey, draftChange } from "./editor-state"

const resource = (positions: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 220, y: 0 },
]): ArchitectureResource => ({
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes: positions.map(({ id, x, y }) => ({
    id,
    text: id.toUpperCase(),
    tags: [],
    layout: { position: { x, y } },
  })),
  edges: [],
})

const snapshot = (
  value = resource(),
  digest = value.nodes.map((node) => `${node.id}:${node.layout.position.x},${node.layout.position.y}`).join("|"),
): ArchitectureSnapshot => ({
  digest,
  storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
  resource: value,
})

describe("architecture editor draft state", () => {
  test("save keeps the current node positions for single and multi-node drags", () => {
    const moved = resource([
      { id: "a", x: 42, y: 18 },
      { id: "b", x: 266, y: 96 },
    ])
    const change = draftChange(
      moved,
      [
        { id: "move-a", type: "node.position", nodeID: "a", position: { x: 42, y: 18 } },
        { id: "move-b", type: "node.position", nodeID: "b", position: { x: 266, y: 96 } },
      ],
      snapshot(),
      snapshot(),
      [],
      "server",
      "/repo",
    )

    expect(change.resource.nodes.map((node) => node.layout.position)).toEqual([
      { x: 42, y: 18 },
      { x: 266, y: 96 },
    ])
  })

  test("reload is keyed to the saved snapshot rather than a reload counter", () => {
    const saved = snapshot(resource(), "saved")
    const changed = snapshot(resource([{ id: "a", x: 8, y: 12 }, { id: "b", x: 220, y: 0 }]), "saved-2")

    expect(architectureEditorInitialKey({ base: saved })).not.toBe(architectureEditorInitialKey({ base: changed }))
  })

  test("mounted editor should reset from the saved snapshot source instead of layered reload state", async () => {
    const source = await Bun.file(new URL("./architecture-editor.react.tsx", import.meta.url)).text()

    expect(source).not.toContain("architectureEditorLoadPlan")
    expect(source).not.toContain("reloadGeneration")
    expect(source).not.toContain("setFlowReloadKey")
    expect(source).toContain("setEditor({")
  })
})
