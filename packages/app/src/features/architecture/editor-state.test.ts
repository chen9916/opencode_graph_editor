import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import {
  architectureEditorLiveInstanceKey,
  architectureEditorPendingOperations,
  architectureInstanceChange,
  commitArchitectureEditorHistory,
  createArchitectureEditorHistory,
  syncArchitectureEditorHistorySource,
  undoArchitectureEditorHistory,
} from "./editor-state"
import { applyOperations } from "./journal"

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

describe("architecture editor live instance state", () => {
  test("save keeps the current node positions for single and multi-node drags", () => {
    const moved = resource([
      { id: "a", x: 42, y: 18 },
      { id: "b", x: 266, y: 96 },
    ])
    const change = architectureInstanceChange(
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

  test("reload is keyed to the saved snapshot plus the live instance version", () => {
    const saved = snapshot(resource(), "saved")
    const changed = snapshot(resource([{ id: "a", x: 8, y: 12 }, { id: "b", x: 220, y: 0 }]), "saved-2")

    expect(architectureEditorLiveInstanceKey({ base: saved, liveInstanceVersion: 0 })).not.toBe(
      architectureEditorLiveInstanceKey({ base: changed, liveInstanceVersion: 0 }),
    )
    expect(architectureEditorLiveInstanceKey({ base: saved, liveInstanceVersion: 0 })).not.toBe(
      architectureEditorLiveInstanceKey({ base: saved, liveInstanceVersion: 1 }),
    )
  })

  test("mounted editor should reset from the live graph instance source", async () => {
    const source = await Bun.file(new URL("./architecture-editor.react.tsx", import.meta.url)).text()

    expect(source).not.toContain("architectureEditorLoadPlan")
    expect(source).not.toContain("setFlowReloadKey")
    expect(source).toContain("liveInstanceKey")
    expect(source).toContain("[liveInstanceKey]")
    expect(source).toContain("syncArchitectureEditorHistorySource")
  })

  test("manual patch acknowledgement adopts the live source and keeps undo as interaction history", () => {
    const add: ArchitectureOperation = {
      id: "add-c",
      type: "node.create",
      node: { id: "c", text: "C", tags: [], layout: { position: { x: 440, y: 0 } } },
    }
    const edited = commitArchitectureEditorHistory(createArchitectureEditorHistory(resource(), []), [add])
    const acknowledged = syncArchitectureEditorHistorySource(edited, edited.resource, [])

    expect(architectureEditorPendingOperations(acknowledged)).toEqual([])
    expect(acknowledged.past).toHaveLength(1)

    const undone = undoArchitectureEditorHistory(acknowledged)

    expect(undone.resource.nodes.map((node) => node.id)).toEqual(["a", "b"])
    expect(architectureEditorPendingOperations(undone).map((operation) => operation.type)).toEqual(["node.remove"])
  })

  test("late acknowledgement does not redo an already undone local interaction", () => {
    const add: ArchitectureOperation = {
      id: "add-c",
      type: "node.create",
      node: { id: "c", text: "C", tags: [], layout: { position: { x: 440, y: 0 } } },
    }
    const edited = commitArchitectureEditorHistory(createArchitectureEditorHistory(resource(), []), [add])
    const undone = undoArchitectureEditorHistory(edited)
    const acknowledged = syncArchitectureEditorHistorySource(undone, applyOperations(resource(), [add]), [])

    expect(acknowledged.resource.nodes.map((node) => node.id)).toEqual(["a", "b"])
    expect(acknowledged.future).toHaveLength(1)
    expect(architectureEditorPendingOperations(acknowledged).map((operation) => operation.type)).toEqual(["node.remove"])
  })
})
