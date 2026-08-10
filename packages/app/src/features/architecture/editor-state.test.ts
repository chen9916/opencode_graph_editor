import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import { currentArchitectureDraftChange } from "./editor-state"

const resource = (text = "A"): ArchitectureResource => ({
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes: [{ id: "a", text, tags: [], layout: { position: { x: 0, y: 0 } } }],
  edges: [],
})

const snapshot = (value = resource(), digest = value.nodes[0]?.text ?? "empty"): ArchitectureSnapshot => ({
  digest,
  storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
  resource: value,
})

describe("architecture editor draft state", () => {
  test("save commands read the pending external canvas instead of a stale editor closure", () => {
    const operation: ArchitectureOperation = {
      id: "ai-update",
      type: "node.update",
      node: { ...resource().nodes[0]!, text: "AI" },
    }

    const change = currentArchitectureDraftChange({
      base: snapshot(resource()),
      historyOrigin: snapshot(resource("AI"), "AI"),
      historyBase: resource("AI"),
      initialOperations: [operation],
      loadedKey: "design:old",
      initialKey: "design:ai",
      editorResource: resource("old canvas"),
      editorOperations: [],
      conflicts: [],
    })

    expect(change.resource.nodes[0]?.text).toBe("AI")
    expect(change.operations).toEqual([operation])
  })

  test("save commands use the latest in-memory editor resource once the canvas is loaded", () => {
    const change = currentArchitectureDraftChange({
      base: snapshot(resource()),
      historyOrigin: snapshot(resource()),
      historyBase: resource(),
      initialOperations: [],
      loadedKey: "design:loaded",
      initialKey: "design:loaded",
      editorResource: resource("latest editor"),
      editorOperations: [],
      conflicts: [],
    })

    expect(change.resource.nodes[0]?.text).toBe("latest editor")
  })
})
