import { describe, expect, test } from "bun:test"

describe("architecture editor styles", () => {
  test("uses a dedicated color treatment for remote edited node hints", async () => {
    const source = await Bun.file(new URL("./architecture.css", import.meta.url)).text()
    const editedHintBlock = source.match(/\.architecture-node\[data-edited-hint="true"\] \{\n([\s\S]*?)\n\}/)?.[1] ?? ""
    const selectedEditedHintBlock =
      source.match(/\.architecture-editor \.react-flow__node\.selected \.architecture-node\[data-edited-hint="true"\][\s\S]*?\{\n([\s\S]*?)\n\}/)?.[1] ?? ""

    expect(source).toContain("--architecture-edited-hint")
    expect(source).toContain('[data-color-scheme="dark"] .architecture-editor')
    expect(editedHintBlock).toContain("--architecture-edited-hint")
    expect(editedHintBlock).not.toContain("--architecture-node-accent")
    expect(selectedEditedHintBlock).toContain("--architecture-edited-hint")
  })

  test("keeps the editor focus ring clipped inside the graph surface", async () => {
    const source = await Bun.file(new URL("./architecture.css", import.meta.url)).text()
    const editorBlock = source.match(/\.architecture-editor \{\n([\s\S]*?)\n\}/)?.[1] ?? ""
    const focusBlock = source.match(/\.architecture-editor:focus-within::after \{\n([\s\S]*?)\n\}/)?.[1] ?? ""
    const canvasBlock = source.match(/\.architecture-editor__canvas \{\n([\s\S]*?)\n\}/)?.[1] ?? ""

    expect(editorBlock).toContain("overflow: hidden")
    expect(editorBlock).toContain("outline: none")
    expect(focusBlock).toContain("inset 0 0 0 1px")
    expect(focusBlock).toContain("pointer-events: none")
    expect(canvasBlock).toContain("overflow: hidden")
  })
})
