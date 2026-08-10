import { describe, expect, test } from "bun:test"
import type { ArchitectureResource } from "./contract"
import { architectureResourceExportData, architectureResourceExportFilename } from "./export"

describe("architecture resource export", () => {
  test("builds a portable resource file without storage metadata", () => {
    const resource = graph()
    const exported = architectureResourceExportData(resource)

    expect(exported).toEqual(resource)
    expect(Object.hasOwn(exported, "digest")).toBe(false)
    expect(Object.hasOwn(exported, "storage")).toBe(false)
  })

  test("clones nested resource data instead of exposing editor references", () => {
    const resource = graph()
    const exported = architectureResourceExportData(resource)

    expect(exported).not.toBe(resource)
    expect(exported.nodes).not.toBe(resource.nodes)
    expect(exported.nodes[0]).not.toBe(resource.nodes[0])
    expect(exported.nodes[0]?.tags).not.toBe(resource.nodes[0]?.tags)
    expect(exported.nodes[0]?.layout.position).not.toBe(resource.nodes[0]?.layout.position)
    expect(exported.edges).not.toBe(resource.edges)
    expect(exported.edges[0]).not.toBe(resource.edges[0])
    expect(exported.tagColors).not.toBe(resource.tagColors)
  })

  test("uses a stable graph filename", () => {
    expect(architectureResourceExportFilename({ id: "auth_resource", name: "Auth Graph / API" })).toBe(
      "auth-graph-api.graph.json",
    )
    expect(architectureResourceExportFilename({ id: "auth_resource", name: "!!!" })).toBe(
      "auth_resource.graph.json",
    )
  })
})

function graph(): ArchitectureResource {
  return {
    version: 2,
    revision: 7,
    id: "auth_resource",
    name: "Auth Graph / API",
    tagColors: { implemented: "#16a34a" },
    nodes: [
      {
        id: "node_login",
        text: "Login flow",
        tags: ["implemented"],
        layout: { position: { x: 10, y: 20 } },
      },
    ],
    edges: [
      {
        id: "edge_login",
        source: "node_login",
        target: "node_login",
        sourceHandle: "right",
        targetHandle: "left",
        style: "curved",
      },
    ],
  }
}
