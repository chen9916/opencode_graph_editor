import { describe, expect, test } from "bun:test"
import { architectureSelectionText } from "./selection-prompt"

describe("architecture selection prompt", () => {
  test("frames selected graph nodes as an implementation brief instead of source truth", () => {
    const text = architectureSelectionText({
      message: "Implement this",
      resourceID: "product",
      resourceName: "Product Graph",
      nodeIDs: ["selection-as-brief"],
      edgeIDs: [],
      nodes: [
        {
          id: "selection-as-brief",
          text: "Selection as implementation brief -- not implemented yet",
          tags: ["planned"],
          position: { x: 10, y: 20 },
        },
      ],
      edges: [],
    })

    expect(text).toContain("user-authored design/task context")
    expect(text).toContain("not source code, implementation truth")
    expect(text).toContain("inspect the actual project with normal code tools")
    expect(text).toContain("summarize this selected intent into a short normal coding task")
    expect(text).toContain("task intent, not graph instructions")
    expect(text).toContain("Use graph_* tools only when modifying this managed graph resource itself")
    expect(text).toContain("selection-as-brief")
    expect(text).toContain("User request:\nImplement this")
  })
})
