import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitectureResource, ArchitectureSnapshot } from "./contract"
import { architectureEditorInitialKey, architectureEditorLoadPlan, currentArchitectureDraftChange } from "./editor-state"

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
      server: "server",
      directory: "/repo",
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

    expect(change.server).toBe("server")
    expect(change.directory).toBe("/repo")
    expect(change.resource.nodes[0]?.text).toBe("AI")
    expect(change.operations).toEqual([operation])
  })

  test("save commands use the latest in-memory editor resource once the canvas is loaded", () => {
    const change = currentArchitectureDraftChange({
      server: "server",
      directory: "/repo",
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

  test("reload generation resets a mounted editor to the authoritative saved graph without a resource remount", () => {
    const saved = snapshot(resource("saved"), "saved")
    const loadedKey = architectureEditorInitialKey({
      base: saved,
      initialOperations: [],
      reloadGeneration: 0,
    })
    const plan = architectureEditorLoadPlan({
      loadedKey,
      loadedResourceID: "design",
      loadedReloadGeneration: 0,
      initialKey: architectureEditorInitialKey({
        base: saved,
        initialOperations: [],
        reloadGeneration: 1,
      }),
      resourceID: "design",
      reloadGeneration: 1,
      historyBase: saved.resource,
      initialOperations: [],
    })

    expect(plan.kind).toBe("reload")
    if (plan.kind === "unchanged") throw new Error("expected reload plan")
    expect(plan.loadedResourceID).toBe("design")
    expect(plan.editor.resource.nodes[0]?.text).toBe("saved")
    expect(plan.editor.past).toEqual([])
    expect(plan.editor.future).toEqual([])
  })

  test("reload clears live draft editing state while preserving the viewport", () => {
    const saved = snapshot(resource("saved"), "saved")
    const liveDraft = snapshot(resource("ai draft"), "live")
    const operation: ArchitectureOperation = {
      id: "local-update",
      type: "node.update",
      node: { ...resource().nodes[0]!, text: "local" },
    }
    const plan = architectureEditorLoadPlan({
      loadedKey: architectureEditorInitialKey({
        base: saved,
        liveSnapshot: liveDraft,
        initialOperations: [operation],
        reloadGeneration: 0,
      }),
      loadedResourceID: "design",
      loadedReloadGeneration: 0,
      initialKey: architectureEditorInitialKey({ base: saved, initialOperations: [], reloadGeneration: 1 }),
      resourceID: "design",
      reloadGeneration: 1,
      historyBase: saved.resource,
      initialOperations: [],
    })

    expect(plan.kind).toBe("reload")
    if (plan.kind === "unchanged") throw new Error("expected reload plan")
    expect(plan.editor.resource.nodes[0]?.text).toBe("saved")
    expect(plan.editor.past).toEqual([])
    expect(plan.transient).toEqual({
      clearSelection: true,
      clearEditedHints: true,
      closePanels: false,
      preserveViewport: true,
    })
  })

  test("ordinary unchanged props do not request a local editor reset", () => {
    const key = architectureEditorInitialKey({ base: snapshot(), initialOperations: [], reloadGeneration: 0 })

    expect(
      architectureEditorLoadPlan({
        loadedKey: key,
        loadedResourceID: "design",
        loadedReloadGeneration: 0,
        initialKey: key,
        resourceID: "design",
        reloadGeneration: 0,
        historyBase: resource(),
        initialOperations: [],
      }),
    ).toEqual({ kind: "unchanged" })
  })

  test("operation payload changes with stable IDs are included in the editor initial key", () => {
    const first: ArchitectureOperation = {
      id: "stable-operation",
      type: "node.update",
      node: { ...resource().nodes[0]!, text: "First" },
    }
    const second: ArchitectureOperation = {
      id: "stable-operation",
      type: "node.update",
      node: { ...resource().nodes[0]!, text: "Second" },
    }

    expect(
      architectureEditorInitialKey({ base: snapshot(), initialOperations: [first], reloadGeneration: 0 }),
    ).not.toBe(architectureEditorInitialKey({ base: snapshot(), initialOperations: [second], reloadGeneration: 0 }))
  })

  test("mounted editor reloads replace React Flow state instead of waiting for a resource remount", async () => {
    const source = await Bun.file(new URL("./architecture-editor.react.tsx", import.meta.url)).text()

    expect(source).toContain("replaceFlowElements(nextResource)")
    expect(source).toContain('if (plan.kind === "reload")')
    expect(source).toContain("setFlowReloadKey((current) => current + 1)")
    expect(source).toContain('key={`${base.resource.id}:reload:${flowReloadKey}`}')
  })
})
