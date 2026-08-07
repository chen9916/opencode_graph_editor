import { describe, expect, test } from "bun:test"
import { architectureResourceMention } from "./mention"

describe("architecture resource mentions", () => {
  test("creates a text-compatible graph reference pill", () => {
    expect(architectureResourceMention({ id: "design-1", name: "Design 1" })).toEqual({
      type: "file",
      path: ".opencode/architecture/resources/design-1.json",
      content: "@Design 1",
      start: 0,
      end: 0,
      mime: "text/plain",
      filename: "design-1.json",
    })
  })
})
