import { describe, expect, test } from "bun:test"
import { architectureCommandMatches, type ArchitectureCommandAction } from "./commands"

describe("architecture commands", () => {
  test("scopes a queued Add Node command to its admitted resource", () => {
    const action: ArchitectureCommandAction = { id: 1, type: "addNode", resourceID: "new_graph" }

    expect(architectureCommandMatches(action, "new_graph")).toBe(true)
    expect(architectureCommandMatches(action, "auth_resourceID")).toBe(false)
  })
})
