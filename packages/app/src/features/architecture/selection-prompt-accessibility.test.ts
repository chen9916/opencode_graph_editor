import { describe, expect, test } from "bun:test"

describe("Graph Ask selection accessibility", () => {
  test("names the Ask textarea and announces attached context", async () => {
    const source = await Bun.file(new URL("./architecture-editor.react.tsx", import.meta.url)).text()

    expect(source).toContain("aria-label={props.labels.askSelectionLabel}")
    expect(source).toContain("architecture-editor__ask-context-indicator")
    expect(source).toContain("props.labels.askSelectionContextAttached")
  })
})
