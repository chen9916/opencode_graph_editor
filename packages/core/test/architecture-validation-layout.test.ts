import { describe, expect, test } from "bun:test"
import { ArchitectureLayout } from "@opencode-ai/core/architecture/layout"
import { ArchitectureValidation } from "@opencode-ai/core/architecture/validation"
import { Architecture } from "@opencode-ai/schema/architecture"

const snapshot = (resource: Architecture.Resource) => ({ resource, digest: `digest:${resource.id}` })

const validNode = (id: string, text: string, tags: Architecture.Tag[] = []) => ({
  id: Architecture.NodeID.make(id),
  text,
  tags,
  layout: { position: { x: 0, y: 0 } },
})

const validEdge = (id: string, source: string, target: string, input: Partial<Architecture.Edge> = {}) =>
  ({
    id: Architecture.EdgeID.make(id),
    source: Architecture.NodeID.make(source),
    target: Architecture.NodeID.make(target),
    sourceHandle: input.sourceHandle,
    targetHandle: input.targetHandle,
    style: input.style,
  }) as Architecture.Edge

describe("ArchitectureValidation", () => {
  test("accepts a valid graph", () => {
    const report = ArchitectureValidation.validateResources([
      snapshot({
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("valid"),
        name: "Valid graph",
        tagColors: { planned: "#4c82ff", implemented: "#16a34a" },
        nodes: [
          validNode("a", "Conversation", [Architecture.Tag.make("planned")]),
          validNode("b", "Memory", [Architecture.Tag.make("implemented")]),
        ],
        edges: [validEdge("a-b", "a", "b", { sourceHandle: "right", targetHandle: "left", style: "curved" })],
      }),
    ])

    expect(report.valid).toBe(true)
    expect(report.summary).toMatchObject({ checked: 1, valid: 1, invalid: 0, totalIssues: 0, errors: 0, warnings: 0 })
    expect(report.resources[0]?.issues).toEqual([])
  })

  test("detects broken edges", () => {
    const report = ArchitectureValidation.validateResources(
      [
        snapshot({
          version: 2,
          revision: 1,
          id: Architecture.ResourceID.make("broken"),
          name: "Broken graph",
          tagColors: { planned: "#4c82ff" },
          nodes: [validNode("a", "Conversation", [Architecture.Tag.make("planned")])],
          edges: [validEdge("missing", "missing", "also-missing")],
        }),
      ],
      { brokenEdges: true, duplicateIDs: false, tagColors: false, nodesWithoutTags: false, emptyNodeText: false, invalidHandles: false, invalidStyles: false },
    )

    expect(report.resources[0]?.issues.map((issue) => issue.code).sort()).toEqual(["broken-edge-source", "broken-edge-target"])
  })

  test("detects missing tag colors, empty text, and nodes without tags", () => {
    const report = ArchitectureValidation.validateResources([
      snapshot({
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("tags"),
        name: "Tags graph",
        nodes: [
          validNode("a", "   ", [Architecture.Tag.make("planned")]),
          validNode("b", "Memory"),
        ],
        edges: [],
      }),
    ])

    expect(report.resources[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-tag-color", severity: "warning" }),
        expect.objectContaining({ code: "empty-node-text", severity: "error" }),
        expect.objectContaining({ code: "node-without-tags", severity: "error" }),
      ]),
    )
  })

  test("detects duplicate IDs", () => {
    const report = ArchitectureValidation.validateResources([
      snapshot({
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("duplicate"),
        name: "Duplicate graph",
        tagColors: { planned: "#4c82ff", implemented: "#16a34a" },
        nodes: [
          validNode("a", "Conversation", [Architecture.Tag.make("planned")]),
          validNode("a", "Memory", [Architecture.Tag.make("planned")]),
          validNode("b", "Context", [Architecture.Tag.make("implemented")]),
        ],
        edges: [validEdge("a-b", "a", "b"), validEdge("a-b", "a", "b")],
      }),
    ])

    expect(report.resources[0]?.issues.map((issue) => issue.code).sort()).toEqual(["duplicate-edge-id", "duplicate-node-id"])
  })

  test("detects invalid handles, styles, and overlapping nodes", () => {
    const report = ArchitectureValidation.validateResources(
      [
        snapshot({
          version: 2,
          revision: 1,
          id: Architecture.ResourceID.make("layout"),
          name: "Layout graph",
          tagColors: { planned: "#4c82ff" },
          nodes: [
            { ...validNode("a", "Conversation", [Architecture.Tag.make("planned")]), layout: { position: { x: 0, y: 0 } } },
            { ...validNode("b", "Memory", [Architecture.Tag.make("planned")]), layout: { position: { x: 40, y: 20 } } },
          ],
          edges: [
            {
              id: Architecture.EdgeID.make("a-b"),
              source: Architecture.NodeID.make("a"),
              target: Architecture.NodeID.make("b"),
              sourceHandle: "up",
              targetHandle: "down",
              style: "bezier",
            } as unknown as Architecture.Edge,
          ],
        }),
      ],
      {
        brokenEdges: false,
        duplicateIDs: false,
        tagColors: false,
        nodesWithoutTags: false,
        emptyNodeText: false,
        invalidHandles: true,
        invalidStyles: true,
        overlappingNodes: true,
        isolatedNodes: false,
      },
    )

    expect(report.resources[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-handle", severity: "error" }),
        expect.objectContaining({ code: "invalid-style", severity: "error" }),
        expect.objectContaining({ code: "overlapping-nodes", severity: "warning" }),
      ]),
    )
  })
})

describe("ArchitectureLayout", () => {
  test("columns mode lays out explicit columns", () => {
    const layout = ArchitectureLayout.plan(
      {
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("columns"),
        name: "Columns graph",
        nodes: [validNode("a", "A"), validNode("b", "B"), validNode("c", "C")],
        edges: [],
      },
      {
        resourceID: Architecture.ResourceID.make("columns"),
        mode: "columns",
        columns: [
          { title: "left", nodeIDs: [Architecture.NodeID.make("a"), Architecture.NodeID.make("b")] },
          { title: "right", nodeIDs: [Architecture.NodeID.make("c")] },
        ],
        origin: { x: 10, y: 20 },
        spacing: { x: 100, y: 40 },
      },
    )

    expect(layout.positions).toEqual([
      { nodeID: Architecture.NodeID.make("a"), position: { x: 10, y: 20 } },
      { nodeID: Architecture.NodeID.make("b"), position: { x: 10, y: 60 } },
      { nodeID: Architecture.NodeID.make("c"), position: { x: 110, y: 20 } },
    ])
  })

  test("grid mode keeps nodes on distinct cells", () => {
    const layout = ArchitectureLayout.plan(
      {
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("grid"),
        name: "Grid graph",
        nodes: Array.from({ length: 5 }, (_, index) => validNode(`n${index}`, `N${index}`)),
        edges: [],
      },
      {
        resourceID: Architecture.ResourceID.make("grid"),
        mode: "grid",
        origin: { x: 0, y: 0 },
        spacing: { x: 80, y: 60 },
      },
    )

    expect(new Set(layout.positions.map((item) => `${item.position.x},${item.position.y}`)).size).toBe(5)
  })

  test("tree mode lays out a hierarchy and stops on cycles", () => {
    const tree = ArchitectureLayout.plan(
      {
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("tree"),
        name: "Tree graph",
        nodes: [validNode("root", "Root"), validNode("child", "Child"), validNode("leaf", "Leaf")],
        edges: [
          validEdge("root-child", "root", "child"),
          validEdge("child-leaf", "child", "leaf"),
        ],
      },
      {
        resourceID: Architecture.ResourceID.make("tree"),
        mode: "tree",
        rootNodeID: Architecture.NodeID.make("root"),
        origin: { x: 0, y: 0 },
        spacing: { x: 120, y: 90 },
      },
    )
    const cycle = ArchitectureLayout.plan(
      {
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("cycle"),
        name: "Cycle graph",
        nodes: [validNode("a", "A"), validNode("b", "B"), validNode("c", "C")],
        edges: [validEdge("a-b", "a", "b"), validEdge("b-c", "b", "c"), validEdge("c-a", "c", "a")],
      },
      {
        resourceID: Architecture.ResourceID.make("cycle"),
        mode: "tree",
        rootNodeID: Architecture.NodeID.make("a"),
      },
    )

    expect(tree.positions).toEqual([
      { nodeID: Architecture.NodeID.make("root"), position: { x: 0, y: 0 } },
      { nodeID: Architecture.NodeID.make("child"), position: { x: 0, y: 90 } },
      { nodeID: Architecture.NodeID.make("leaf"), position: { x: 0, y: 180 } },
    ])
    expect(cycle.positions).toHaveLength(3)
    expect(new Set(cycle.positions.map((item) => item.nodeID)).size).toBe(3)
  })

  test("byTags groups nodes by tag order", () => {
    const layout = ArchitectureLayout.plan(
      {
        version: 2,
        revision: 1,
        id: Architecture.ResourceID.make("tags"),
        name: "Tags graph",
        nodes: [
          validNode("alpha", "Alpha", [Architecture.Tag.make("alpha")]),
          validNode("beta", "Beta", [Architecture.Tag.make("beta")]),
          validNode("both", "Both", [Architecture.Tag.make("beta"), Architecture.Tag.make("alpha")]),
        ],
        edges: [],
      },
      {
        resourceID: Architecture.ResourceID.make("tags"),
        mode: "byTags",
        tagOrder: [Architecture.Tag.make("alpha"), Architecture.Tag.make("beta")],
        origin: { x: 5, y: 10 },
        spacing: { x: 90, y: 50 },
      },
    )

    expect(layout.positions).toEqual([
      { nodeID: Architecture.NodeID.make("alpha"), position: { x: 5, y: 10 } },
      { nodeID: Architecture.NodeID.make("both"), position: { x: 5, y: 60 } },
      { nodeID: Architecture.NodeID.make("beta"), position: { x: 95, y: 10 } },
    ])
  })
})
