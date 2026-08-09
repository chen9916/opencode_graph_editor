import { describe, expect, test } from "bun:test"
import { hasAgentPickerChoice, resolveAgent } from "./local-agent"

describe("hasAgentPickerChoice", () => {
  test("detects explicitly custom agents", () => {
    expect(hasAgentPickerChoice([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasAgentPickerChoice([{ native: true }, {}])).toBe(false)
  })

  test("shows selector for built-in graph mode", () => {
    expect(hasAgentPickerChoice([{ name: "build", native: true }, { name: "graph", native: true }])).toBe(true)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses the requested available agent", () => {
    expect(resolveAgent(agents, "custom")?.name).toBe("custom")
  })

  test("defaults to build", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
  })

  test("uses the first agent when build is unavailable", () => {
    expect(resolveAgent([{ name: "custom" }], "missing")?.name).toBe("custom")
  })
})
