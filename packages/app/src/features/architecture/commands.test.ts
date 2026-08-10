import { describe, expect, test } from "bun:test"
import { matchKeybind, parseKeybind } from "@/context/command"
import {
  architectureCommandKeybinds,
  architectureCommandMatches,
  architectureEditorCommandTarget,
  ARCHITECTURE_COMMAND_EVENT,
  dispatchArchitectureCommand,
  type ArchitectureCommandAction,
} from "./commands"

describe("architecture commands", () => {
  test("scopes a queued Add Node command to its admitted resource", () => {
    const action: ArchitectureCommandAction = { id: 1, type: "addNode", resourceID: "new_graph" }

    expect(architectureCommandMatches(action, "new_graph")).toBe(true)
    expect(architectureCommandMatches(action, "auth_resourceID")).toBe(false)
  })

  test("dispatches reusable resource-level commands", () => {
    const received: string[] = []
    const listener = (event: Event) => received.push((event as CustomEvent<string>).detail)
    document.addEventListener(ARCHITECTURE_COMMAND_EVENT, listener)

    dispatchArchitectureCommand("exportResource")
    dispatchArchitectureCommand("duplicateResource")

    document.removeEventListener(ARCHITECTURE_COMMAND_EVENT, listener)
    expect(received).toEqual(["exportResource", "duplicateResource"])
  })

  test("uses standard editor keybinds for graph save, reload, undo, and redo", () => {
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.save), key("s", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.reload), key("r", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.undo), key("z", { ctrlKey: true }))).toBe(true)
    expect(matchKeybind(parseKeybind(architectureCommandKeybinds.redo), key("z", { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    )
  })

  test("scopes graph shortcuts to the editor without hijacking text fields", () => {
    const editor = document.createElement("div")
    const pane = document.createElement("div")
    const input = document.createElement("input")
    const editable = document.createElement("div")
    const outside = document.createElement("button")

    editor.className = "architecture-editor"
    editable.contentEditable = "true"
    editor.append(pane, input, editable)
    document.body.append(editor, outside)

    expect(architectureEditorCommandTarget(key("z", { target: pane }))).toBe(true)
    expect(architectureEditorCommandTarget(key("z", { target: input }))).toBe(false)
    expect(architectureEditorCommandTarget(key("z", { target: editable }))).toBe(false)
    expect(architectureEditorCommandTarget(key("z", { target: outside }))).toBe(false)

    editor.remove()
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
