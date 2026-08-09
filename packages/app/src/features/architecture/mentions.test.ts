import { describe, expect, test } from "bun:test"
import { architectureGraphSkillMention, architectureResourceAliases, architectureResourceMention } from "./mention"

describe("architecture resource mentions", () => {
  test("creates the graph editor skill mention", () => {
    expect(architectureGraphSkillMention()).toEqual({
      type: "agent",
      name: "graph",
      content: "@graph",
      start: 0,
      end: 0,
    })
  })

  test("creates a text-compatible graph reference pill", () => {
    expect(architectureResourceMention({ id: "design-1", name: "Design 1" })).toEqual({
      type: "file",
      path: ".opencode/architecture/resources/design-1.json",
      content: "@Design 1",
      start: 0,
      end: 0,
      mime: "application/json",
      filename: "design-1.json",
      source: {
        type: "file",
        text: { value: "@Design 1", start: 0, end: 9 },
        path: ".opencode/architecture/resources/design-1.json",
      },
    })
  })

  test("adds compact aliases for graph names with spaces", () => {
    expect(architectureResourceAliases({ name: "Graph 1" })).toEqual(["Graph 1", "Graph1", "graph1"])
    expect(architectureResourceAliases({ name: "Overview" })).toEqual(["Overview"])
  })
})
