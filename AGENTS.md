- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Repository Focus

- This working repository is primarily for implementing and validating the interactive Architecture Graph approach.
- The graph is a shared communication surface where people describe intended software designs, AI explains the current implementation, and both can compare, refine, and cross-reference designs across multiple architecture resources.
- Treat this interaction model as the main product goal of the work in this repository. Do not turn it back into a hard-coded dependency scanner, a fixed taxonomy, or an automatically generated representation of the codebase.

## Architecture Design Workspace Progress

- Active plan: `.opencode/plans/1786094316021-playful-rocket.md`.
- Architecture is a communication workspace for human-authored intent, AI explanations of the implementation, and comparisons between the two. It is not a deterministic project scanner or generated source-of-truth model.
- Each project can store multiple independent named resources under `.opencode/architecture/resources/<resource-id>.json`. A legacy `.opencode/architecture/graph.json` is exposed as `overview` and migrates on its first edit.
- Nodes contain only text, free-form tags, and positions. Connections contain only source and target node IDs. Status is not a special field; values such as `planned` and `implemented` are ordinary tags.
- Graph documents do not store cross-resource references. When multiple designs belong in one conversation, the user explicitly mentions each resource with `@`.
- Backend implementation includes the semantic schema in `packages/schema/src/architecture.ts`; atomic list/create/load/patch/remove/reset/query/context operations; process and cross-process locking; digest/revision conflict checks; recovery backups; and events under `packages/core/src/architecture/`.
- AI access is provided by resource-oriented V2 tools and bounded dynamic System Context. The former `Analyze Project` button is now `Discuss with AI`: it saves pending edits and sends a visible prompt mentioning the selected resource without running a hard-coded scanner or attaching graph JSON as model media.
- Architecture `@` mentions remain visible in the conversation, but managed graph files are omitted from provider request file/media parts. This filtering exists in the prompt builder, the V2 runner, and the legacy V1 message conversion. The legacy compatibility path must recognize both file URLs and `FilePart.source.path`, because older sessions can contain `data:application/json` URLs whose Architecture path exists only in `source.path`.
- Deterministic workspace/Godot analyzers, analysis runs and proposals, analyzer ownership, and their SQLite artifacts are intentionally absent. AI explores implementation with its normal project tools when the user asks.
- Current API implementation is in `packages/protocol/src/groups/architecture.ts` and `packages/server/src/handlers/architecture.ts`. The six public routes list, create, get, patch, remove, and reset resources. Promise and Effect clients were regenerated under `packages/client/src/generated*`; a second generation was byte-identical.
- The lazy React Flow editor under `packages/app/src/features/architecture/` supports resource switching, creation and deletion; simple text nodes; free-form tags; double-click inline text editing; simple connections; drag-position persistence; filters; outline; inspector; undo/redo; persistent journal/viewport; conflict-aware rebase; export/save/reload; confirmation flows; and loading/error/empty states. It has no status workflow or graph-level cross-reference editor.
- Architecture is wired into the desktop session side panel through `SESSION_ARCHITECTURE_TAB` and into a full-content mobile tab with the composer hidden. Commands cover open, save, reload, fit view, and element creation. Layout is RTL-aware, paths/IDs retain mixed-direction readability, and untranslated Architecture terminology uses the English runtime fallback policy.
- Architecture visibility is capability-based rather than tied to the session protocol: `packages/app/src/utils/server-protocol.ts` probes the authenticated `/api/architecture/resource` route, and the shared server SDK accessor gates the session-header button, tabs, commands, and resource queries. Do not switch Dev builds to the separately downloaded V2 CLI for this feature.
- Desktop renderer needs React island dependencies resolvable from `packages/desktop/package.json`; keep `react`, `react-dom`, and `@xyflow/react` there unless the bundling approach changes.
- Verification completed: focused Schema, Core, Client, App, and all six Architecture HTTP route tests pass; typechecks pass in Schema, Core, Protocol, Server, Client, App, Desktop, and `packages/opencode`; migration drift, client generation idempotence, App production build, Electron desktop build and Windows packaging, and `git diff --check` pass.
- Latest packaged validation (2026-08-08): `packages/desktop/dist/win-unpacked/OpenCode Dev.exe` was rebuilt after the historical Architecture attachment compatibility fix. The targeted App suite (16 tests), Core runner suite (7 tests), and legacy message suite (39 tests) pass; App, Core, and `packages/opencode` typechecks pass; and bundle inspection confirms the `source.path` guard is packaged. React/React DOM/React Flow remain outside the initial desktop main chunk and load through the `architecture-editor.react-*` chunk.
- Known worktree caveat: `build-desktop.bat` is currently untracked.

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
