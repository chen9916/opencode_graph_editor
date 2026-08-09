<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts and packages/opencode/src/skill/index.ts.
  The body below becomes the skill's content.
-->

# Graph editor

Use this skill when the user writes `@graph`, names the Graph
editor, or asks for graph-editor resources, nodes, tags, tag colors, wires,
filters, layout, or graph workspace behavior.

## Intent

- `@graph` by itself means OpenCode's managed Graph editor, not a
  generated SVG, Mermaid diagram, generic dependency graph, or external chart.
- The graph is a shared communication workspace for human-authored intent, AI
  explanations, and comparisons across named graph resources.
- Do not turn the graph into a hard-coded dependency scanner or generated
  source-of-truth model. When implementation context is needed, inspect the
  project with normal tools and explain what you found.

## Managed Graph Resources

- For graph resource creation or edits, use the `graph_*` tools. Do not edit
  `.opencode/architecture/resources/*.json` directly.
- If the current session does not expose the `graph_*` tools, say that managed
  graph editing is unavailable in this session. Do not fall back to direct JSON
  edits unless the user explicitly asks for raw file surgery.
- If the user names a graph with an `@` mention, resolve that managed resource
  from Graph context or `graph_list_resources`; do not search
  ordinary files or symbols for that display name.
- If the user says `@graph` without naming a specific resource, ask only when a
  specific existing resource is required. Otherwise create, list, query, or
  explain graph resources as requested.
- Graph nodes contain text, free-form tags, and positions. Connections contain
  source and target node IDs plus explicit endpoint sides. Tags such as
  `planned` or `implemented` are ordinary tags, not special status fields.
- Tag colors are per-resource display settings. Use `graph_set_tag_color` for
  resource tag colors.

## Editor Implementation

- If the user asks to change the graph editor application itself, work in the
  OpenCode codebase rather than creating a graph resource.
- Keep editor changes aligned with the existing Graph workspace model:
  multiple named resources, graph tools, managed mentions, explicit wire
  endpoints, free-form tags, and user-authored meaning.
- Do not add deterministic analyzers, proposal databases, or project scanners
  unless the user explicitly asks for that separate product direction.
- Do not run browser or dev-server visual validation for Graph editor
  work unless the user explicitly asks. The user owns visual checking by
  default.

## Response Behavior

- Treat graph-editor requests as actionable. Use graph tools for resource
  changes and normal code-editing tools for product implementation changes.
- Prefer concise confirmations that name the resource or code area changed.
- When uncertain whether the user means a graph resource or graph editor code,
  infer from verbs: create/update nodes, tags, wires, layout means a managed
  resource; add UI, change behavior, fix filtering, or change tabs means editor
  implementation.
