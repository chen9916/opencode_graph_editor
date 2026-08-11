import { describe, expect, test } from "bun:test"
import { matchKeybind, parseKeybind } from "@/context/command"
import {
  architectureCommandKeybinds,
  architectureCommandMatches,
  architecturePanelCommandTarget,
  ARCHITECTURE_COMMAND_EVENT,
  dispatchArchitectureCommand,
  type ArchitectureCommandAction,
} from "./commands"

describe("architecture commands", () => {
  test("scopes a queued Add Node command to its admitted resource", () => {
    const action: ArchitectureCommandAction = {
      id: 1,
      type: "addNode",
      server: "http://127.0.0.1:4096",
      directory: "C:/repo",
      resourceID: "new_graph",
    }

    expect(architectureCommandMatches(action, "new_graph")).toBe(true)
    expect(architectureCommandMatches(action, "auth_resourceID")).toBe(false)
    expect(
      architectureCommandMatches(action, {
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        resourceID: "new_graph",
      }),
    ).toBe(true)
    expect(
      architectureCommandMatches(action, {
        server: "http://127.0.0.1:4096",
        directory: "D:/other",
        resourceID: "new_graph",
      }),
    ).toBe(false)
  })

  test("dispatches reusable resource-level commands", () => {
    const panel = document.createElement("div")
    panel.setAttribute("data-architecture-panel", "")
    document.body.append(panel)
    const received: Array<{ readonly type: string; readonly target?: EventTarget | null }> = []
    const listener = (event: Event) =>
      received.push((event as CustomEvent<{ type: string; target?: EventTarget | null }>).detail)
    document.addEventListener(ARCHITECTURE_COMMAND_EVENT, listener)

    dispatchArchitectureCommand("exportResource")
    dispatchArchitectureCommand("duplicateResource")

    document.removeEventListener(ARCHITECTURE_COMMAND_EVENT, listener)
    panel.remove()
    expect(received.map((item) => item.type)).toEqual(["exportResource", "duplicateResource"])
    expect(received.every((item) => item.target === panel)).toBe(true)
  })

  test("dispatches keybound graph commands to the panel event target", () => {
    const panel = document.createElement("div")
    const editor = document.createElement("div")
    const pane = document.createElement("div")
    const outside = document.createElement("button")
    const received: Array<EventTarget | null | undefined> = []
    const listener = (event: Event) =>
      received.push((event as CustomEvent<{ target?: EventTarget | null }>).detail.target)

    panel.setAttribute("data-architecture-panel", "")
    editor.className = "architecture-editor"
    editor.append(pane)
    panel.append(editor)
    document.body.append(panel, outside)
    outside.focus()
    document.addEventListener(ARCHITECTURE_COMMAND_EVENT, listener)

    expect(architecturePanelCommandTarget(key("s", { target: pane }))).toBe(true)
    dispatchArchitectureCommand("save")

    document.removeEventListener(ARCHITECTURE_COMMAND_EVENT, listener)
    panel.remove()
    outside.remove()
    expect(received).toEqual([pane])
  })

  test("uses standard editor keybinds for graph save, reload, undo, and redo", () => {
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.save), key("s", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.reload), key("r", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.undo), key("z", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.redo), key("z", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    )
  })

  test("scopes graph shortcuts to the panel without hijacking text fields", () => {
    const panel = document.createElement("div")
    const editor = document.createElement("div")
    const header = document.createElement("button")
    const pane = document.createElement("div")
    const input = document.createElement("input")
    const editable = document.createElement("div")
    const outside = document.createElement("button")

    panel.setAttribute("data-architecture-panel", "")
    editor.className = "architecture-editor"
    editable.contentEditable = "true"
    editor.append(pane, input, editable)
    panel.append(header, editor)
    document.body.append(panel, outside)

    expect(architecturePanelCommandTarget(key("z", { target: header }))).toBe(true)
    expect(architecturePanelCommandTarget(key("z", { target: pane }))).toBe(true)
    expect(architecturePanelCommandTarget(key("z", { target: input }))).toBe(false)
    expect(architecturePanelCommandTarget(key("z", { target: editable }))).toBe(false)
    expect(architecturePanelCommandTarget(key("z", { target: outside }))).toBe(false)

    panel.remove()
    outside.remove()
  })

  test("removes the editor toolbar action bar from the React view", async () => {
    const source = await Bun.file(new URL("./architecture-editor.react.tsx", import.meta.url)).text()

    expect(source).not.toContain("architecture-editor__toolbar")
    expect(source).not.toContain("architecture-editor__actions")
  })
})

function key(key: string, init?: KeyboardEventInit & { readonly target?: EventTarget }) {
  const event = new KeyboardEvent("keydown", init ? { ...init, key } : { key })
  if (init?.target) Object.defineProperty(event, "target", { value: init.target })
  return event
}
