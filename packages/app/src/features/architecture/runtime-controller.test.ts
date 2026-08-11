import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitecturePendingOverlay, ArchitectureSnapshot } from "./contract"
import { createArchitectureRuntimeDebugEvent } from "./runtime-debug"
import { architectureRuntimeController } from "./runtime-controller"

const snapshot = (id = "design"): ArchitectureSnapshot => ({
  digest: `${id}-digest`,
  storage: { root: "/repo/.opencode/architecture", path: `.opencode/architecture/resources/${id}.json` },
  resource: {
    version: 2,
    revision: 1,
    id,
    name: id,
    nodes: [{ id: "node", text: "Node", tags: [], layout: { position: { x: 0, y: 0 } } }],
    edges: [],
  },
})

const pending = (base: ArchitectureSnapshot, operations: ReadonlyArray<ArchitectureOperation>): ArchitecturePendingOverlay => ({
  base,
  origin: base,
  journalBase: base.resource,
  operations,
  conflicts: [],
})

describe("architecture runtime controller", () => {
  test("composes runtime view, debug history, and selector props", () => {
    const saved = snapshot()
    const event = createArchitectureRuntimeDebugEvent({
      resourceID: saved.resource.id,
      type: "journal",
      status: "recorded",
      now: 1,
      unique: "test",
    })
    const controller = architectureRuntimeController({
      selectedResourceID: saved.resource.id,
      resources: [{ id: saved.resource.id, name: saved.resource.name, revision: 1, digest: saved.digest, nodes: 1, edges: 0 }],
      saved,
      live: null,
      pending: pending(saved, [{ id: "move", type: "node.position", nodeID: "node", position: { x: 1, y: 2 } }]),
      debugEvents: [event],
    })

    expect(controller.runtimeView.dirty).toBe(true)
    expect(controller.runtimeView.debugEvents).toEqual([event])
    expect(controller.pending?.operations).toHaveLength(1)
    expect(controller.resourceOptions.map((option) => option.id)).toEqual([saved.resource.id])
    expect(controller.selectedResource?.id).toBe(saved.resource.id)
  })

  test("reports pending-covered cleanup target", () => {
    const saved = snapshot()
    const node = { id: "local", text: "Local", tags: [], layout: { position: { x: 4, y: 2 } } }
    const live = { ...saved, digest: "live", resource: { ...saved.resource, nodes: [...saved.resource.nodes, node] } }
    const controller = architectureRuntimeController({
      selectedResourceID: saved.resource.id,
      resources: [],
      saved,
      live: { source: "live", snapshot: live },
      pending: pending(saved, [{ id: "create", type: "node.create", node }]),
      debugEvents: [],
    })

    expect(controller.pendingCoveredResourceID).toBe(saved.resource.id)
    expect(controller.runtimeView.syncStatus).toBe("pending-covered")
  })
})
