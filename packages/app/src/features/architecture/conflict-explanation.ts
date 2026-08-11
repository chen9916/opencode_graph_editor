import type { ArchitectureConflictExplanation, ArchitectureResource } from "./contract"
import type { ArchitectureConflict } from "./journal"

export function architectureConflictExplanation(
  conflict: ArchitectureConflict,
  resource: ArchitectureResource | undefined,
): ArchitectureConflictExplanation {
  return {
    operationID: conflict.operation.id,
    operationType: conflict.operation.type,
    reason: conflict.reason,
    target: conflictTarget(conflict, resource),
  }
}

export function architectureConflictExplanations(
  conflicts: ReadonlyArray<ArchitectureConflict>,
  resource: ArchitectureResource | undefined,
) {
  return conflicts.map((conflict) => architectureConflictExplanation(conflict, resource))
}

function conflictTarget(conflict: ArchitectureConflict, resource: ArchitectureResource | undefined) {
  const operation = conflict.operation
  if (operation.type === "resource.update") return { kind: "resource" as const, id: resource?.id }
  if (operation.type === "tag.color") return { kind: "tag" as const, id: operation.tag }
  if (operation.type === "node.create") return { kind: "node" as const, id: operation.node.id }
  if (operation.type === "node.update") return { kind: "node" as const, id: operation.node.id }
  if (operation.type === "node.position") return { kind: "node" as const, id: operation.nodeID }
  if (operation.type === "node.remove") return { kind: "node" as const, id: operation.nodeID }
  if (operation.type === "edge.create") return { kind: "edge" as const, id: operation.edge.id }
  if (operation.type === "edge.update") return { kind: "edge" as const, id: operation.edge.id }
  return { kind: "edge" as const, id: operation.edgeID }
}
