import { downloadJsonExport, jsonExportFilename } from "@/utils/json-export"
import type { ArchitectureResource } from "./contract"

export function architectureResourceExportData(resource: ArchitectureResource): ArchitectureResource {
  return {
    version: resource.version,
    revision: resource.revision,
    id: resource.id,
    name: resource.name,
    ...(resource.tagColors ? { tagColors: { ...resource.tagColors } } : {}),
    nodes: resource.nodes.map((node) => ({
      id: node.id,
      text: node.text,
      tags: [...node.tags],
      layout: { position: { x: node.layout.position.x, y: node.layout.position.y } },
    })),
    edges: resource.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(edge.style ? { style: edge.style } : {}),
    })),
  }
}

export function architectureResourceExportFilename(resource: Pick<ArchitectureResource, "id" | "name">) {
  return jsonExportFilename(resource.name, resource.id, ".graph")
}

export function downloadArchitectureResourceExport(resource: ArchitectureResource) {
  const data = architectureResourceExportData(resource)
  const filename = architectureResourceExportFilename(data)
  downloadJsonExport(filename, data)
  return filename
}
