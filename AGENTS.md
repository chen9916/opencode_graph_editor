- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Repository Focus

- This working repository is primarily for developing, restructuring, debugging, and validating the OpenCode Graph editor.
- When a request is ambiguous, assume Graph editor work is the main product goal unless the user clearly points to another area of OpenCode.
- The graph is a shared communication surface where people describe intended software designs, AI explains the current implementation, and both can compare, refine, and cross-reference designs across multiple graph resources.
- Treat this interaction model as the main product goal of the work in this repository. Do not turn it back into a hard-coded dependency scanner, a fixed taxonomy, or an automatically generated representation of the codebase.

## Graph Editor Implementation Map

- Product surface: the Graph editor is an OpenCode feature for human-authored design intent, AI implementation explanations, and comparisons between graph resources. It is not an automatic code dependency graph.
- App editor implementation lives in `packages/app/src/features/architecture/`.
- The Solid shell is `packages/app/src/features/architecture/architecture-panel.tsx`. It orchestrates server queries, resource switching, create/delete/duplicate, save/reload, persisted selected resource, persisted pending overlays, persisted viewport, labels, dialogs, toasts, and command routing. Keep state derivation, server-event synchronization, debug event construction, and event planning in the runtime/sync helper modules rather than re-growing panel-local logic.
- The React Flow bridge is `packages/app/src/features/architecture/architecture-island.tsx`. It lazy-loads React, React DOM, and the editor so the Graph editor stays out of the initial Solid bundle.
- The main React canvas is `packages/app/src/features/architecture/architecture-editor.react.tsx`. It owns React Flow wiring, node/edge gestures, selection, context menus, ask-selection popover, inspector panels, outline/filter UI, undo/redo, node position commits, viewport persistence, and viewport inertia. It should dispatch intent through `editor-commands.ts` instead of hand-building `ArchitectureOperation` objects inline. This remains the largest app-side file and the main candidate for future restructuring.
- Custom React Flow elements are `architecture-node.react.tsx` and `architecture-edge.react.tsx`. Nodes render text, tags, inline editing, and four-sided handles. Edges render rectangular, curved, and straight wires plus selected-wire style controls.
- Shared app contracts and pure helpers are in `contract.ts`, `model.ts`, `journal.ts`, `editor-state.ts`, `live-instance.ts`, `resource-state.ts`, `runtime-view.ts`, `runtime-controller.ts`, `runtime-debug.ts`, `sync-events.ts`, `server-event-sync.ts`, `live-instance-event-sync.ts`, `editor-commands.ts`, `conflict-explanation.ts`, `event.ts`, `commands.ts`, `selection-state.ts`, `selection-prompt.ts`, `mention.ts`, `mentions.ts`, `edit-hint.ts`, `cache-order.ts`, and `export.ts`.
- Current app-side Graph runtime boundaries: `runtime-view.ts` computes saved/live/pending/visible state, dirty reasons, sync status, revisions/digests, and conflict explanations; `runtime-controller.ts` composes runtime view data with resource selector state and bounded debug history for the panel/editor; `runtime-debug.ts` creates journal/sync/server/save/reload activity events and structured debug details; `sync-events.ts` owns pure live-instance/resource-event handling decisions; `server-event-sync.ts` owns parsed server-event orchestration and maps events to cache updates/refetches/removal cleanup/debug decisions; `live-instance-event-sync.ts` owns metadata-only live-instance event refetch and authoritative adoption; `editor-commands.ts` centralizes node/edge/tag/resource operation builders; `conflict-explanation.ts` turns journal conflicts into localized UI metadata.
- The right Properties panel includes a collapsed Sync debug section for debugging local/AI edit interactions. It should stay unobtrusive but useful: resource ID, dirty reasons, sync status, pending operation count, conflicts, live instance presence, saved/visible revisions and digests, recent activity, operation summaries, conflict explanations, and structured sync details such as event kind/action, base revision/digest, event revision/digest, source, and adoption/refetch/ignore reasons.
- Session integration is in `packages/app/src/pages/session/session-side-panel.tsx`, `packages/app/src/components/session/session-header.tsx`, `packages/app/src/pages/session/use-session-commands.tsx`, and `packages/app/src/pages/session/helpers.ts`. The tab constant is `SESSION_ARCHITECTURE_TAB`.
- Prompt mention integration is in `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/prompt-input-v2.tsx`, and `packages/app/src/features/architecture/mention.ts`. Graph resource mentions should remain visible to users while managed graph JSON is filtered out of provider file/media payloads.
- Graph capability detection is in `packages/app/src/utils/server-protocol.ts` and the shared server SDK context. Do not gate Graph visibility on a downloaded external V2 CLI.
- Backend schema is `packages/schema/src/architecture.ts`. The core resource service, storage, patching, locking, conflict behavior, AI tools, and dynamic System Context live under `packages/core/src/architecture/`.
- Public HTTP API definitions are in `packages/protocol/src/groups/architecture.ts`; server handlers are in `packages/server/src/handlers/architecture.ts`. After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`.
- Generated clients live under `packages/client/src/generated` and `packages/client/src/generated-effect`; never edit generated files directly.
- Desktop packaging needs React island dependencies resolvable from `packages/desktop/package.json`; keep `react`, `react-dom`, and `@xyflow/react` there unless the bundling approach changes.

## Graph Editor Data Model

- Saved resources are stored per project under `.opencode/architecture/resources/<resource-id>.json`. The legacy `.opencode/architecture/graph.json` is exposed as `overview` and migrates on first edit.
- A resource contains `version`, `revision`, `id`, `name`, optional `tagColors`, `nodes`, and `edges`.
- Nodes contain `id`, `text`, free-form `tags`, and `layout.position`.
- Edges contain `id`, `source`, `target`, optional `sourceHandle`, optional `targetHandle`, and optional `style`. Handles are explicit sides: `top`, `right`, `bottom`, or `left`; styles are `rectangular`, `curved`, or `straight`.
- App-side editing distinguishes saved snapshots, server live instances, and editor-local pending overlays. Pending overlays bridge unacknowledged local UI edits, journal recovery, undo/redo, and conflict-aware rebase.
- Graph changes should flow through typed operations such as `resource.update`, `tag.color`, `node.create`, `node.update`, `node.position`, `node.remove`, `edge.create`, `edge.update`, and `edge.remove`. Do not mutate graph JSON directly from app code.

## Graph Workspace Progress

- Active plan: `.opencode/plans/1786094316021-playful-rocket.md`.
- Graph is a communication workspace for human-authored intent, AI explanations of the implementation, and comparisons between the two. It is not a deterministic project scanner or generated source-of-truth model.
- Each project can store multiple independent named resources under `.opencode/architecture/resources/<resource-id>.json`. A legacy `.opencode/architecture/graph.json` is exposed as `overview` and migrates on its first edit.
- Nodes contain only text, free-form tags, and positions. Connections contain source and target node IDs plus the explicit side used at each endpoint. Status is not a special field; values such as `planned` and `implemented` are ordinary tags.
- Graph documents do not store cross-resource references. When multiple designs belong in one conversation, the user explicitly mentions each resource with `@`.
- Backend implementation includes the semantic schema in `packages/schema/src/architecture.ts`; atomic list/create/load/patch/remove/reset/query/context operations; process and cross-process locking; digest/revision conflict checks; recovery backups; and events under `packages/core/src/architecture/`.
- AI access is provided by resource-oriented V2 tools and bounded dynamic System Context. The Graph editor has no dedicated AI button; users mention one or more named Graph resources directly in chat, and the session context identifies the exact managed resource without attaching its JSON as model media or running a hard-coded scanner.
- Graph `@` mentions remain visible in the conversation, but managed graph files are omitted from provider request file/media parts. This filtering exists in the prompt builder, the V2 runner, and the legacy V1 message conversion. The legacy compatibility path must recognize both file URLs and `FilePart.source.path`, because older sessions can contain `data:application/json` URLs whose graph path exists only in `source.path`.
- Deterministic workspace/Godot analyzers, analysis runs and proposals, analyzer ownership, and their SQLite artifacts are intentionally absent. AI explores implementation with its normal project tools when the user asks.
- Current API implementation is in `packages/protocol/src/groups/architecture.ts` and `packages/server/src/handlers/architecture.ts`. The six public routes list, create, get, patch, remove, and reset resources. Promise and Effect clients were regenerated under `packages/client/src/generated*`; a second generation was byte-identical.
- The lazy React Flow editor under `packages/app/src/features/architecture/` supports resource switching, creation and deletion; simple text nodes; free-form tags; double-click inline text editing; persistent explicit four-side connection endpoints that AI and users can inspect or edit; always-visible custom wires with rectangular, curved, and straight routing; immediate selected-wire route controls; selected-node highlighting; context menus; toggleable left outline and right properties panels; drag-position persistence; filters; undo/redo; persistent journal/viewport; conflict-aware rebase; export/save/reload; confirmation flows; and loading/error/empty states. It has no status workflow or graph-level cross-reference editor.
- Wire routing controls update the React Flow edge locally on the first click and then persist the preference. Node and resource inspector edits enter the local journal on blur, and the graph-level Save is the only Save action. Outline and Properties start closed and do not automatically open when a resource loads or reloads.
- Leave visual testing of Graph editor UI changes to the user unless they explicitly ask an agent to run it. Do not start browser-based visual smoke tests or local dev servers solely for Graph visual validation.
- Graph drafts are continuously journaled, so the editor does not install a renderer `beforeunload` blocker. This avoids the previous Windows shutdown hang while preserving unsaved graph work for the next launch.
- Graph is wired into the desktop session side panel through `SESSION_ARCHITECTURE_TAB` and into a full-content mobile tab with the composer hidden. Commands cover open, save, reload, fit view, and element creation. Layout is RTL-aware, paths/IDs retain mixed-direction readability, and untranslated Graph terminology uses the English runtime fallback policy.
- Graph visibility is capability-based rather than tied to the session protocol: `packages/app/src/utils/server-protocol.ts` probes the authenticated `/api/architecture/resource` route, and the shared server SDK accessor gates the session-header button, tabs, commands, and resource queries. Do not switch Dev builds to the separately downloaded V2 CLI for this feature.
- Desktop renderer needs React island dependencies resolvable from `packages/desktop/package.json`; keep `react`, `react-dom`, and `@xyflow/react` there unless the bundling approach changes.
- App-side live update/debug foundation was strengthened after diagnosing agent edits not appearing on the canvas: metadata-only `architecture.resource.instance.updated` events now refetch and authoritatively adopt matching live instances through `live-instance-event-sync.ts`; same-revision digest mismatches are ignored with a debug reason; parsed server-event orchestration lives in `server-event-sync.ts`; Windows directory event channels are normalized through `pathKey` before enqueue/subscription so equivalent slash forms reach the same listeners; Sync debug shows structured reasons for stale, inline, refetch, local-dirty, removed, and resource-refetch decisions. Verification: a managed Graph tool node appeared automatically on the selected running desktop canvas; `bun test --conditions=solid --preload ./happydom.ts src/context/server-sdk.test.ts`, `bun test src/features/architecture`, `bun typecheck`, and `git diff --check` passed in `packages/app`.
- Verification completed: focused Schema, Core, Client, App, and all six Architecture HTTP route tests pass; typechecks pass in Schema, Core, Protocol, Server, Client, App, Desktop, and `packages/opencode`; migration drift, client generation idempotence, App production build, Electron desktop build and Windows packaging, and `git diff --check` pass.
- Latest packaged validation (2026-08-08, commit `885395f87c`): `packages/desktop/dist/win-unpacked/OpenCode Dev.exe` was rebuilt after the graph responsiveness and shutdown fixes. The focused App Architecture suite (6 tests), App and Desktop typechecks, App production build, Electron desktop build, Windows unpacked packaging, bundle inspection, and `git diff --check` pass. React/React DOM/React Flow remain outside the initial desktop main chunk and load through the `architecture-editor.react-*` chunk. The worktree was clean after the commit.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
