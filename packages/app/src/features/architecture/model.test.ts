import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import { toReactFlow } from "./model"

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
    { id: "vertical", source: "upper", target: "lower" },
    { id: "horizontal", source: "upper", target: "left" },
  ],
}

describe("architecture flow model", () => {
  test("routes connections through the closest of all four node sides", () => {
    const edges = toReactFlow(resource, () => {}).edges

    expect(edges[0]).toMatchObject({ sourceHandle: "bottom", targetHandle: "top" })
    expect(edges[1]).toMatchObject({ sourceHandle: "left", targetHandle: "right" })
  })

  test("applies persisted visual wire styles without changing the graph edge", () => {
    const edges = toReactFlow(resource, () => {}, { vertical: "default", horizontal: "straight" }).edges

    expect(edges.map((edge) => edge.type)).toEqual(["default", "straight"])
    expect(edges.map((edge) => edge.data?.edge)).toEqual([...resource.edges])
  })
})
