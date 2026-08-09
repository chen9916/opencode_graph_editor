import type { ArchitectureSelectionPrompt } from "./contract"

export function architectureSelectionText(input: ArchitectureSelectionPrompt) {
  const nodeLimit = 20
  const edgeLimit = 30
  const nodeLines = input.nodes.slice(0, nodeLimit).map((node) => {
    const tags = node.tags.length > 0 ? ` [${node.tags.join(", ")}]` : ""
    return `- ${node.id}: ${node.text}${tags} (position: ${node.position.x}, ${node.position.y})`
  })
  const edgeLines = input.edges.slice(0, edgeLimit).map((edge) => {
    return `- ${edge.id}: ${edge.source}.${edge.sourceHandle ?? "right"} -> ${edge.target}.${edge.targetHandle ?? "left"} (style: ${edge.style ?? "rectangular"})`
  })
  return [
    `Graph selection in resource ${input.resourceName} (${input.resourceID}).`,
    "Treat the selected graph elements as user-authored design/task context, not source code, implementation truth, or proof that code already exists.",
    "If the user asks to implement, fix, or change the program, inspect the actual project with normal code tools before editing and scope the work to this selected intent.",
    "For implementation, summarize this selected intent into a short normal coding task and delegate non-trivial work to the implementation subagent. The worker should get task intent, not graph instructions.",
    "Use graph_* tools only when modifying this managed graph resource itself; do not edit graph JSON directly.",
    ...(nodeLines.length > 0 ? ["Selected nodes:", ...nodeLines] : []),
    input.nodes.length > nodeLimit ? `- ${input.nodes.length - nodeLimit} additional selected nodes omitted` : undefined,
    ...(edgeLines.length > 0 ? ["Selected connections:", ...edgeLines] : []),
    input.edges.length > edgeLimit
      ? `- ${input.edges.length - edgeLimit} additional selected connections omitted`
      : undefined,
    "User request:",
    input.message.trim(),
  ]
    .filter((line): line is string => !!line)
    .join("\n")
}
