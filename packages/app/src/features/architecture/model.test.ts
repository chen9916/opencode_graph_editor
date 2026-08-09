import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import { tagColorsKey, toReactFlow } from "./model"

const resource: ArchitectureResource = {
  version: 2,
  revision: 1,
  id: "design",
  name: "Design",
  nodes: [
    { id: "upper", text: "Upper", tags: [], layout: { position: { x: 20, y: 10 } } },
    { id: "lower", text: "Lower", tags: [], layout: { position: { x: 40, y: 300 } } },
    { id: "left", text: "Left", tags: [], layout: { position: { x: -300, y: 20 } } },
  ],
  edges: [
    { id: "vertical", source: "upper", target: "lower", sourceHandle: "top", targetHandle: "bottom" },
    { id: "horizontal", source: "upper", target: "left", sourceHandle: "left", targetHandle: "right" },
  ],
}

describe("architecture flow model", () => {
  test("preserves explicitly authored connection sides regardless of layout", () => {
    const edges = toReactFlow(resource, () => {}).edges

    expect(edges[0]).toMatchObject({ sourceHandle: "top", targetHandle: "bottom" })
    expect(edges[1]).toMatchObject({ sourceHandle: "left", targetHandle: "right" })
  })

  test("uses a stable right-to-left fallback for older connections", () => {
    const edges = toReactFlow(
      { ...resource, edges: [{ id: "legacy", source: "upper", target: "lower" }] },
      () => {},
    ).edges

    expect(edges[0]).toMatchObject({ sourceHandle: "right", targetHandle: "left" })
  })

  test("uses durable graph edge styles", () => {
    const styled = {
      ...resource,
      edges: [
        { ...resource.edges[0]!, style: "curved" as const },
        { ...resource.edges[1]!, style: "straight" as const },
      ],
    }
    const edges = toReactFlow(styled, () => {}).edges

    expect(edges.map((edge) => edge.type)).toEqual(["architecture", "architecture"])
    expect(edges.map((edge) => edge.data?.style)).toEqual(["curved", "straight"])
    expect(edges.map((edge) => edge.data?.edge)).toEqual([...styled.edges])
  })

  test("passes graph tag colors into node render data", () => {
    const nodes = toReactFlow({ ...resource, tagColors: { planned: "#4c82ff" } }, () => {}).nodes

    expect(nodes.map((node) => node.data.tagColors)).toEqual([
      { planned: "#4c82ff" },
      { planned: "#4c82ff" },
      { planned: "#4c82ff" },
    ])
    expect(nodes.map((node) => node.data.tagColorsKey)).toEqual([
      "planned:#4c82ff",
      "planned:#4c82ff",
      "planned:#4c82ff",
    ])
  })

  test("keys tag colors independently from object insertion order", () => {
    expect(tagColorsKey({ planned: "#4c82ff", implemented: "#16a34a" })).toBe(
      "implemented:#16a34a\u001fplanned:#4c82ff",
    )
  })
})
