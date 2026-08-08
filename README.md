# OpenCode Graph Editor

OpenCode Graph Editor is an experimental OpenCode fork focused on an interactive architecture workspace. It adds a graph editor where people and AI agents can discuss intended software designs, explain current implementation structure, compare alternatives, and keep architecture notes close to the coding session.

This project is based on OpenCode, but this fork and its graph editor work are not built by, endorsed by, or affiliated with the OpenCode team.

## Product Goal

The graph editor is a shared communication surface for software architecture. It is not a dependency scanner, static analyzer, or generated source of truth.

The intended workflow is:

1. A person creates or opens a named architecture resource.
2. The person adds free-form nodes, tags, positions, and explicit wire endpoints.
3. The person mentions one or more architecture resources in chat.
4. The AI uses the graph as context while also exploring the implementation with normal project tools.
5. The person and AI refine the design, compare intent with implementation, and update the graph when useful.

## Architecture Resource Model

Each project can store multiple independent architecture resources under:

```text
.opencode/architecture/resources/<resource-id>.json
```

Each resource contains:

- `nodes`: text, free-form tags, and editor position.
- `connections`: source node, target node, and explicit endpoint side for each end of the wire.
- `metadata`: resource name, revision, and timestamps used for conflict-aware edits.

Tags are deliberately free-form. Values such as `planned`, `implemented`, `risk`, `backend`, or `needs-review` are ordinary tags, not hard-coded workflow states.

Resources do not store cross-resource references. When a conversation needs multiple designs, the user explicitly mentions each resource with `@` in chat.

## Editor Specification

The graph editor should provide:

- Multiple named architecture resources per workspace.
- Resource creation, switching, deletion, reset, reload, export, and save flows.
- Simple text nodes with inline editing.
- Free-form node tags for intent, ownership, state, risk, or any team-specific label.
- Explicit four-side connection endpoints so users and AI can inspect how nodes relate visually.
- Wire routing controls for rectangular, curved, and straight routes.
- Drag-position persistence for graph layout.
- Undo and redo for local graph edits.
- Continuous local journaling so unsaved graph work can be restored after reload or restart.
- Conflict-aware saves that can rebase local edits when the resource changed elsewhere.
- Toggleable outline and properties panels for navigating and inspecting the graph.
- Filters for focusing on relevant nodes or tags.
- Desktop and mobile session integration.
- RTL-aware layout behavior and readable mixed-direction paths and identifiers.

## AI Integration Specification

The AI integration should keep architecture resources human-authored and conversation-driven.

- Users mention architecture resources directly in chat.
- The session context identifies the exact managed resource being discussed.
- Managed graph JSON is not attached to provider requests as normal file or media parts.
- The AI can inspect and patch architecture resources through bounded tools.
- The AI should explore source code using normal project tools when asked to compare graph intent with implementation.
- The graph should support explanation and collaboration, not replace source-level investigation.

## Primary Use Cases

### Design Intent

Capture a proposed feature architecture before implementation starts. Nodes can describe components, services, UI surfaces, data stores, or decision points, while tags mark uncertainty, planned work, owners, or review status.

### Implementation Explanation

Ask the AI to explain how the current code maps to a graph. The AI can read the project, summarize important implementation pieces, and suggest graph updates that clarify how the system actually works.

### Intent vs. Reality Review

Compare a planned architecture resource with the current implementation. This helps surface missing work, drift, unclear ownership, or places where code evolved differently than the original design.

### Refactor Planning

Sketch the current structure and a target structure as separate resources, then use chat to discuss migration steps, risks, and sequencing.

### Architecture Review

Use tags and connections to guide review conversations. Reviewers can focus on high-risk nodes, unclear edges, or implementation areas that need proof from the codebase.

### Onboarding

Create a lightweight map of important systems so new contributors can ask targeted questions and jump from architecture concepts into implementation details.

## Non-Goals

- Automatically generating a complete dependency graph from source code.
- Treating graph resources as the canonical representation of the codebase.
- Enforcing a fixed taxonomy of node types or statuses.
- Storing implicit cross-resource links inside graph documents.
- Replacing normal code search, tests, static analysis, or review.

## Current Implementation Areas

The graph editor work spans:

- `packages/schema/src/architecture.ts` for the graph schema.
- `packages/core/src/architecture/` for resource storage, locking, patches, context, and tools.
- `packages/protocol/src/groups/architecture.ts` for public API definitions.
- `packages/server/src/handlers/architecture.ts` for HTTP handlers.
- `packages/app/src/features/architecture/` for the React Flow editor UI.
- `packages/desktop/` for desktop packaging and renderer dependency integration.

## Development Notes

Use package-local commands instead of running tests from the repository root. For example:

```bash
cd packages/app
bun typecheck
bun test architecture
```

After changing the public Protocol or Server HTTP API, regenerate clients from `packages/client`:

```bash
cd packages/client
bun run generate
```
