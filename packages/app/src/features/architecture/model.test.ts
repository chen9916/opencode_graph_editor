import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import {
  architectureRenderedConnectionSides,
  architectureRenderEdgeHandleID,
  architectureRenderEdgeHandleSide,
  tagColorsKey,
  toReactFlow,
} from "./model"

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
    { id: "vertical", source: "upper", target: "lower", sourceHandle: "right", targetHandle: "left" },
    { id: "horizontal", source: "upper", target: "left", sourceHandle: "left", targetHandle: "right" },
  ],
}

describe("architecture flow model", () => {
  test("derives rendered connection sides from relative node positions", () => {
    const edges = toReactFlow(resource, () => {}).edges

    expect(edges[0]).toMatchObject({
      sourceHandle: architectureRenderEdgeHandleID("vertical", "source", "bottom"),
      targetHandle: architectureRenderEdgeHandleID("vertical", "target", "top"),
    })
    expect(architectureRenderEdgeHandleSide(edges[1]?.sourceHandle)).toBe("left")
    expect(architectureRenderEdgeHandleSide(edges[1]?.targetHandle)).toBe("right")
  })

  test("preserves explicitly authored non-default connection sides", () => {
    const edges = toReactFlow(
      {
        ...resource,
        edges: [{ id: "explicit", source: "upper", target: "lower", sourceHandle: "top", targetHandle: "bottom" }],
      },
      () => {},
    ).edges

    expect(edges[0]).toMatchObject({
      sourceHandle: architectureRenderEdgeHandleID("explicit", "source", "top"),
      targetHandle: architectureRenderEdgeHandleID("explicit", "target", "bottom"),
    })
  })

  test("falls back to saved sides when layout cannot choose a direction", () => {
    const edges = toReactFlow(
      {
        ...resource,
        nodes: [
          { id: "source", text: "Source", tags: [], layout: { position: { x: 12, y: 8 } } },
          { id: "target", text: "Target", tags: [], layout: { position: { x: 12, y: 8 } } },
        ],
        edges: [{ id: "explicit", source: "source", target: "target", sourceHandle: "top", targetHandle: "bottom" }],
      },
      () => {},
    ).edges

    expect(edges[0]).toMatchObject({
      sourceHandle: architectureRenderEdgeHandleID("explicit", "source", "top"),
      targetHandle: architectureRenderEdgeHandleID("explicit", "target", "bottom"),
    })
  })

  test("uses relative layout for older connections without saved sides", () => {
    expect(
      architectureRenderedConnectionSides({ id: "legacy", source: "upper", target: "lower" }, resource.nodes),
    ).toEqual({ sourceHandle: "bottom", targetHandle: "top" })
  })

  test("orders shared side sockets by the connected node position", () => {
    const shared: ArchitectureResource = {
      ...resource,
      nodes: [
        { id: "hub", text: "Hub", tags: [], layout: { position: { x: 0, y: 0 } } },
        { id: "upper", text: "Upper", tags: [], layout: { position: { x: 240, y: -80 } } },
        { id: "lower", text: "Lower", tags: [], layout: { position: { x: 220, y: 120 } } },
      ],
      edges: [
        { id: "a-lower", source: "hub", target: "lower", sourceHandle: "right", targetHandle: "left" },
        { id: "z-upper", source: "hub", target: "upper", sourceHandle: "right", targetHandle: "left" },
      ],
    }
    const handles = toReactFlow(shared, () => {}).nodes.find((node) => node.id === "hub")?.data.edgeHandles ?? []
    const offsets = endpointOffsets(handles)

    expect(offsets[architectureRenderEdgeHandleID("z-upper", "source", "right")]).toBeCloseTo(100 / 3)
    expect(offsets[architectureRenderEdgeHandleID("a-lower", "source", "right")]).toBeCloseTo(200 / 3)
  })

  test("separates render-only endpoint handles sharing the same node side", () => {
    const shared: ArchitectureResource = {
      ...resource,
      nodes: [
        { id: "hub", text: "Hub", tags: [], layout: { position: { x: 0, y: 0 } } },
        { id: "first", text: "First", tags: [], layout: { position: { x: 220, y: 0 } } },
        { id: "second", text: "Second", tags: [], layout: { position: { x: 240, y: 40 } } },
      ],
      edges: [
        { id: "z-edge", source: "hub", target: "second", sourceHandle: "right", targetHandle: "left" },
        { id: "a-edge", source: "hub", target: "first", sourceHandle: "right", targetHandle: "left" },
      ],
    }
    const handles = toReactFlow(shared, () => {}).nodes.find((node) => node.id === "hub")?.data.edgeHandles ?? []
    const reorderedHandles = toReactFlow({ ...shared, edges: [...shared.edges].reverse() }, () => {}).nodes.find(
      (node) => node.id === "hub",
    )?.data.edgeHandles ?? []
    const incoming = handles.find((handle) => handle.id === architectureRenderEdgeHandleID("a-edge", "source", "right"))
    const outgoing = handles.find((handle) => handle.id === architectureRenderEdgeHandleID("z-edge", "source", "right"))

    expect(incoming).toMatchObject({
      id: architectureRenderEdgeHandleID("a-edge", "source", "right"),
      side: "right",
      type: "source",
    })
    expect(incoming?.offset).toBeCloseTo(100 / 3)
    expect(outgoing).toMatchObject({
      id: architectureRenderEdgeHandleID("z-edge", "source", "right"),
      side: "right",
      type: "source",
    })
    expect(outgoing?.offset).toBeCloseTo(200 / 3)
    expect(endpointOffsets(reorderedHandles)).toEqual(endpointOffsets(handles))
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

function endpointOffsets(
  handles: NonNullable<ReturnType<typeof toReactFlow>["nodes"][number]["data"]["edgeHandles"]>,
) {
  return Object.fromEntries(handles.map((handle) => [handle.id, handle.offset]))
}
