import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { ArchitectureConflict } from "@opencode-ai/core/architecture/conflict"
import { ArchitectureDraft } from "@opencode-ai/core/architecture/draft"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { ArchitectureRoot } from "@opencode-ai/core/architecture/root"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Architecture } from "@opencode-ai/schema/architecture"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { location, tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      ArchitectureGraph.node,
      ArchitectureDraft.node,
      ArchitectureRoot.node,
      EventV2.node,
      Location.node,
    ]),
    [[Location.node, tempLocationLayer]],
  ),
)

const node = (id: string) => ({
  id: Architecture.NodeID.make(id),
  text: id,
  tags: [Architecture.Tag.make("intended")],
  layout: { position: { x: 0, y: 0 } },
})

describe("ArchitectureRoot", () => {
  test("uses the primary worktree for linked worktree storage", async () => {
    await using root = await tmpdir()
    const main = path.join(root.path, "main")
    const linked = path.join(root.path, "linked")
    await fs.mkdir(main)
    await $`git init`.cwd(main).quiet()
    await $`git config core.fsmonitor false`.cwd(main).quiet()
    await $`git config commit.gpgsign false`.cwd(main).quiet()
    await $`git config user.email test@opencode.test`.cwd(main).quiet()
    await $`git config user.name Test`.cwd(main).quiet()
    await $`git commit --allow-empty -m root`.cwd(main).quiet()
    await $`git worktree add -b architecture-linked ${linked}`.cwd(main).quiet()

    const primary = await resolveRoot(main)
    const secondary = await resolveRoot(linked)

    expect(primary.root).toBe(AbsolutePath.make(await fs.realpath(main)))
    expect(secondary.root).toBe(primary.root)
    expect(secondary.resources).toBe(primary.resources)
  })

  test("uses the opened directory outside Git", async () => {
    await using root = await tmpdir()
    expect((await resolveRoot(root.path)).root).toBe(AbsolutePath.make(await fs.realpath(root.path)))
  })
})

describe("ArchitectureGraph storage", () => {
  it.live("stores and lists multiple independent architecture resources", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      expect(yield* graph.list()).toEqual([])

      const product = yield* graph.create({ id: Architecture.ResourceID.make("product"), name: "Product intent" })
      const runtime = yield* graph.create({
        id: Architecture.ResourceID.make("runtime"),
        name: "Current runtime",
      })
      const drafted = yield* graph.patchDraft(product.resource.id, {
        revision: product.resource.revision,
        digest: product.digest,
        operations: [
          {
            id: Architecture.OperationID.make("create"),
            type: "node.create",
            node: node("conversation"),
          },
        ],
      })
      const saved = yield* graph.commitDraft(product.resource.id, {
        revision: drafted.snapshot.resource.revision,
        digest: drafted.snapshot.digest,
      })
      const raw = yield* Effect.promise(() => fs.readFile(path.join(saved.storage.root, saved.storage.path), "utf8"))

      expect((yield* graph.list()).map((item) => item.id)).toEqual([
        Architecture.ResourceID.make("runtime"),
        Architecture.ResourceID.make("product"),
      ])
      expect(saved.resource.nodes.map((item) => item.id)).toEqual([Architecture.NodeID.make("conversation")])
      expect((yield* graph.load(runtime.resource.id)).resource.name).toBe("Current runtime")
      expect(raw.endsWith("\n")).toBe(true)
      expect(JSON.parse(raw)).toEqual(saved.resource)
    }),
  )

  it.live("rejects stale draft mutations", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("design"), name: "Design" })
      const saved = yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [{ id: Architecture.OperationID.make("first"), type: "node.create", node: node("first") }],
      })
      const stale = yield* graph
        .patchDraft(base.resource.id, {
          revision: base.resource.revision,
          digest: base.digest,
          operations: [{ id: Architecture.OperationID.make("second"), type: "node.create", node: node("second") }],
        })
        .pipe(Effect.flip)

      expect(stale).toMatchObject({
        resourceID: base.resource.id,
        resourceName: "Design",
        operation: "graph_draft_patch",
        expectedRevision: base.resource.revision,
        currentRevision: saved.snapshot.resource.revision,
        expectedDigest: base.digest,
        currentDigest: saved.snapshot.digest,
        safeToRetry: "unknown",
        retryHint: "Reload the graph resource and retry the edit against the latest digest.",
        expected: { revision: base.resource.revision, digest: base.digest },
        actual: { revision: saved.snapshot.resource.revision, digest: saved.snapshot.digest },
        operationIDs: [],
      })
      expect(stale.message).toContain("expected revision 0")
      expect(stale.message).toContain("current revision 1")
      expect(stale.message).toContain("resourceID=design")
      expect(ArchitectureConflict.payload(stale as ArchitectureGraph.ConflictError)).toMatchObject({
        message: "Graph resource changed before this edit could be applied.",
        resourceID: base.resource.id,
      })
      expect((yield* graph.load(base.resource.id)).digest).toBe(base.digest)
    }),
  )

  it.live("keeps live draft patches out of persisted resource files", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("drafted"), name: "Drafted" })
      const live = yield* graph.patchLive(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const saved = yield* graph.load(base.resource.id)
      const raw = yield* Effect.promise(() => fs.readFile(path.join(saved.storage.root, saved.storage.path), "utf8"))

      expect(live.source).toBe("live")
      expect(live.snapshot.resource.nodes.map((item) => item.id)).toEqual([Architecture.NodeID.make("draft-node")])
      expect((yield* graph.loadLive(base.resource.id)).snapshot.digest).toBe(live.snapshot.digest)
      expect(saved.resource.nodes).toEqual([])
      expect(JSON.parse(raw).nodes).toEqual([])
    }),
  )

  it.live("commits multiple live draft patches as one saved revision", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("commit-draft"), name: "Commit draft" })
      const first = yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("first-node"), type: "node.create", node: node("first-node") },
        ],
      })
      const live = yield* graph.patchDraft(base.resource.id, {
        revision: first.snapshot.resource.revision,
        digest: first.snapshot.digest,
        operations: [
          { id: Architecture.OperationID.make("second-node"), type: "node.create", node: node("second-node") },
        ],
      })
      const committed = yield* graph.commitDraft(base.resource.id, {
        revision: live.snapshot.resource.revision,
        digest: live.snapshot.digest,
      })
      const raw = yield* Effect.promise(() =>
        fs.readFile(path.join(committed.storage.root, committed.storage.path), "utf8"),
      )

      expect(live.source).toBe("live")
      expect(live.snapshot.resource.revision).toBe(base.resource.revision + 2)
      expect(committed.resource.revision).toBe(base.resource.revision + 1)
      expect(committed.digest).not.toBe(live.snapshot.digest)
      expect((yield* graph.loadDraft(base.resource.id)).source).toBe("saved")
      expect(JSON.parse(raw)).toMatchObject({
        revision: base.resource.revision + 1,
        nodes: [{ id: "first-node" }, { id: "second-node" }],
      })
    }),
  )

  it.live("rejects a changed or missing expected live draft", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const drafts = yield* ArchitectureDraft.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("expected-draft"), name: "Expected draft" })
      const first = yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("first-node"), type: "node.create", node: node("first-node") },
        ],
      })
      const second = yield* graph.patchDraft(base.resource.id, {
        revision: first.snapshot.resource.revision,
        digest: first.snapshot.digest,
        operations: [
          { id: Architecture.OperationID.make("second-node"), type: "node.create", node: node("second-node") },
        ],
      })

      expect(
        yield* graph
          .commitDraft(base.resource.id, {
            revision: first.snapshot.resource.revision,
            digest: first.snapshot.digest,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        operation: "graph_draft_commit",
        conflictKind: "draft_changed",
        expected: { revision: first.snapshot.resource.revision, digest: first.snapshot.digest },
        actual: { revision: second.snapshot.resource.revision, digest: second.snapshot.digest },
      })
      expect((yield* drafts.get(base.resource.id))?.resource).toEqual(second.snapshot.resource)

      yield* graph.discardDraft(base.resource.id)
      expect(
        yield* graph
          .commitDraft(base.resource.id, {
            revision: second.snapshot.resource.revision,
            digest: second.snapshot.digest,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        operation: "graph_draft_commit",
        conflictKind: "draft_missing",
        expected: { revision: second.snapshot.resource.revision, digest: second.snapshot.digest },
        actual: { revision: base.resource.revision, digest: base.digest },
      })
      expect((yield* graph.load(base.resource.id)).digest).toBe(base.digest)
    }),
  )

  it.live("discards live draft patches without changing the saved resource file", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("discard-draft"), name: "Discard draft" })
      yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const discarded = yield* graph.discardDraft(base.resource.id)
      const saved = yield* graph.load(base.resource.id)
      const raw = yield* Effect.promise(() => fs.readFile(path.join(saved.storage.root, saved.storage.path), "utf8"))

      expect(discarded.source).toBe("saved")
      expect(discarded.snapshot.digest).toBe(base.digest)
      expect(saved.resource.nodes).toEqual([])
      expect(JSON.parse(raw).nodes).toEqual([])
    }),
  )

  it.live("rejects live draft mutation when the saved base changed", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const drafts = yield* ArchitectureDraft.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("stale-draft"), name: "Stale draft" })
      const live = yield* graph.patchLive(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const saved = { ...live.snapshot.resource, revision: live.snapshot.resource.revision + 1, name: "Saved draft" }
      yield* Effect.promise(() =>
        fs.writeFile(path.join(live.snapshot.storage.root, live.snapshot.storage.path), JSON.stringify(saved, null, 2) + "\n"),
      )
      const current = yield* graph.load(base.resource.id)
      const stale = yield* graph
        .patchLive(base.resource.id, {
          revision: live.snapshot.resource.revision,
          digest: live.snapshot.digest,
          operations: [
            { id: Architecture.OperationID.make("second-draft"), type: "node.create", node: node("second-draft") },
          ],
        })
        .pipe(Effect.flip)

      expect(stale).toMatchObject({
        resourceID: base.resource.id,
        expectedRevision: base.resource.revision,
        currentRevision: current.resource.revision,
        expectedDigest: base.digest,
        currentDigest: current.digest,
      })
      expect(yield* drafts.get(base.resource.id)).toMatchObject({
        baseRevision: base.resource.revision,
        baseDigest: base.digest,
        resource: live.snapshot.resource,
      })
      expect(yield* graph.loadLive(base.resource.id).pipe(Effect.flip)).toMatchObject({
        operation: "graph_draft_load",
        expected: { revision: base.resource.revision, digest: base.digest },
        actual: { revision: current.resource.revision, digest: current.digest },
      })
      expect(
        yield* graph
          .commitDraft(base.resource.id, {
            revision: live.snapshot.resource.revision,
            digest: live.snapshot.digest,
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        operation: "graph_draft_commit",
        expected: { revision: base.resource.revision, digest: base.digest },
        actual: { revision: current.resource.revision, digest: current.digest },
      })
      yield* graph.discardDraft(base.resource.id)
      expect((yield* graph.loadLive(base.resource.id)).source).toBe("saved")
    }),
  )

  it.live("settles draft state before commit lifecycle events", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const events = yield* EventV2.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("commit-events"), name: "Commit events" })
      const live = yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const observed = new Array<string>()
      const unsubscribe = yield* events.listen((event) => {
        if (
          event.type !== Architecture.Event.ResourceUpdated.type &&
          event.type !== Architecture.Event.ResourceDraftDiscarded.type
        )
          return Effect.void
        return graph.loadDraft(base.resource.id).pipe(
          Effect.tap((current) =>
            Effect.sync(() => {
              observed.push(`${event.type}:${current.source}`)
            }),
          ),
          Effect.orDie,
          Effect.asVoid,
        )
      })

      yield* graph.commitDraft(base.resource.id, {
        revision: live.snapshot.resource.revision,
        digest: live.snapshot.digest,
      })
      yield* unsubscribe

      expect(observed).toEqual([
        `${Architecture.Event.ResourceUpdated.type}:saved`,
        `${Architecture.Event.ResourceDraftDiscarded.type}:saved`,
      ])
    }),
  )

  it.live("settles draft state before the discard lifecycle event", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const events = yield* EventV2.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("discard-events"), name: "Discard events" })
      yield* graph.patchDraft(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const observed = new Array<string>()
      const unsubscribe = yield* events.listen((event) =>
        event.type !== Architecture.Event.ResourceDraftDiscarded.type
          ? Effect.void
          : graph.loadDraft(base.resource.id).pipe(
              Effect.tap((current) =>
                Effect.sync(() => {
                  observed.push(`${event.type}:${current.source}`)
                }),
              ),
              Effect.orDie,
              Effect.asVoid,
            ),
      )

      yield* graph.discardDraft(base.resource.id)
      yield* unsubscribe

      expect(observed).toEqual([`${Architecture.Event.ResourceDraftDiscarded.type}:saved`])
    }),
  )

  it.live("clears process-local drafts before remove and reset lifecycle events", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const drafts = yield* ArchitectureDraft.Service
      const events = yield* EventV2.Service
      const removedID = Architecture.ResourceID.make("removed-draft")
      const removed = yield* graph.create({ id: removedID, name: "Removed draft" })
      yield* graph.patchDraft(removedID, {
        revision: removed.resource.revision,
        digest: removed.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const removeObserved = new Array<boolean>()
      const unsubscribeRemove = yield* events.listen((event) =>
        event.type !== Architecture.Event.ResourceRemoved.type
          ? Effect.void
          : drafts.get(removedID).pipe(
              Effect.tap((entry) =>
                Effect.sync(() => {
                  removeObserved.push(entry !== undefined)
                }),
              ),
              Effect.asVoid,
            ),
      )

      yield* graph.remove(removedID, { revision: removed.resource.revision, digest: removed.digest })
      yield* unsubscribeRemove
      const recreated = yield* graph.create({ id: removedID, name: "Removed draft" })

      expect(removeObserved).toEqual([false])
      expect((yield* graph.loadLive(recreated.resource.id)).source).toBe("saved")
      expect(recreated.resource.nodes).toEqual([])

      const resetID = Architecture.ResourceID.make("reset-draft")
      const resetBase = yield* graph.create({ id: resetID, name: "Reset draft" })
      yield* graph.patchDraft(resetID, {
        revision: resetBase.resource.revision,
        digest: resetBase.digest,
        operations: [
          { id: Architecture.OperationID.make("draft-node"), type: "node.create", node: node("draft-node") },
        ],
      })
      const resetObserved = new Array<boolean>()
      const unsubscribeReset = yield* events.listen((event) =>
        event.type !== Architecture.Event.ResourceUpdated.type
          ? Effect.void
          : drafts.get(resetID).pipe(
              Effect.tap((entry) =>
                Effect.sync(() => {
                  resetObserved.push(entry !== undefined)
                }),
              ),
              Effect.asVoid,
            ),
      )

      const reset = yield* graph.reset(resetID)
      yield* unsubscribeReset

      expect(resetObserved).toEqual([false])
      expect((yield* graph.loadLive(resetID)).source).toBe("saved")
      expect(reset.resource.nodes).toEqual([])
    }),
  )

  it.live("migrates the legacy single graph when it is first edited", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const roots = yield* ArchitectureRoot.Service
      const storage = yield* roots.get
      yield* Effect.promise(async () => {
        await fs.mkdir(storage.directory, { recursive: true })
        await fs.writeFile(
          storage.legacyFile,
          JSON.stringify({
            version: 1,
            revision: 2,
            metadata: { source: "legacy" },
            nodes: [
              {
                id: "legacy",
                name: "Legacy node",
                type: "project concept",
                status: "intended",
                description: "Preserved as text",
                files: [],
                folders: [],
                metadata: {},
                layout: { position: { x: 0, y: 0 } },
                managedBy: { analyzerID: "workspace", entityKey: "legacy" },
              },
            ],
            edges: [],
          }),
        )
      })

      const listed = yield* graph.list()
      const current = yield* graph.load(Architecture.ResourceID.make("overview"))
      const draft = yield* graph.patchDraft(current.resource.id, {
        revision: current.resource.revision,
        digest: current.digest,
        operations: [
          {
            id: Architecture.OperationID.make("rename"),
            type: "resource.update",
            name: "Migrated design",
          },
        ],
      })
      const saved = yield* graph.commitDraft(current.resource.id, {
        revision: draft.snapshot.resource.revision,
        digest: draft.snapshot.digest,
      })

      expect(String(listed[0]?.id)).toBe("overview")
      expect(current.resource.nodes[0]).not.toHaveProperty("managedBy")
      expect(current.resource.nodes[0]).toMatchObject({
        text: "Legacy node\n\nPreserved as text",
        tags: ["intended", "project concept"],
      })
      expect(yield* Effect.promise(() => fs.stat(path.join(storage.resources, "overview.json")).then(() => true))).toBe(
        true,
      )
      expect(saved.resource.name).toBe("Migrated design")
    }),
  )

  it.live("converts previous rich version-two resources on read", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const roots = yield* ArchitectureRoot.Service
      const storage = yield* roots.get
      yield* Effect.promise(async () => {
        await fs.mkdir(storage.resources, { recursive: true })
        await fs.writeFile(
          path.join(storage.resources, "previous.json"),
          JSON.stringify({
            version: 2,
            revision: 4,
            id: "previous",
            name: "Previous graph",
            description: "Removed resource description",
            metadata: { obsolete: true },
            nodes: [
              {
                id: "idea",
                name: "Design idea",
                type: "concept",
                status: "planned",
                description: "Keep this explanation",
                files: [],
                folders: [],
                metadata: {},
                layout: { position: { x: 10, y: 20 } },
              },
            ],
            edges: [],
            references: [{ id: "removed", targetResourceID: "other", metadata: {} }],
          }),
        )
      })

      const loaded = yield* graph.load(Architecture.ResourceID.make("previous"))
      expect(loaded.resource.nodes[0]).toMatchObject({
        text: "Design idea\n\nKeep this explanation",
        tags: ["concept", "planned"],
      })
      expect(loaded.resource).not.toHaveProperty("references")
      expect(loaded.resource).not.toHaveProperty("metadata")
    }),
  )

  it.live("salvages direct JSON layout fields and writes back normalized edges", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const roots = yield* ArchitectureRoot.Service
      const storage = yield* roots.get
      yield* Effect.promise(async () => {
        await fs.mkdir(storage.resources, { recursive: true })
        await fs.writeFile(
          path.join(storage.resources, "manual.json"),
          JSON.stringify({
            version: 2,
            revision: 3,
            id: "manual",
            name: "Manual graph",
            nodes: [
              { id: "a", text: "A", tags: [], layout: { position: { x: 0, y: 0 } } },
              { id: "b", text: "B", tags: [], layout: { position: { x: 200, y: 0 } } },
            ],
            edges: [
              {
                id: "a-b",
                source: "a",
                target: "b",
                type: "step",
                sourcePosition: "bottom",
                targetPosition: "top",
              },
            ],
          }),
        )
      })

      const loaded = yield* graph.load(Architecture.ResourceID.make("manual"))
      expect(loaded.resource.edges[0]).toEqual({
        id: Architecture.EdgeID.make("a-b"),
        source: Architecture.NodeID.make("a"),
        target: Architecture.NodeID.make("b"),
        sourceHandle: "bottom",
        targetHandle: "top",
        style: "rectangular",
      })

      const drafted = yield* graph.patchDraft(loaded.resource.id, {
        revision: loaded.resource.revision,
        digest: loaded.digest,
        operations: [{ id: Architecture.OperationID.make("rename"), type: "resource.update", name: "Clean graph" }],
      })
      const saved = yield* graph.commitDraft(loaded.resource.id, {
        revision: drafted.snapshot.resource.revision,
        digest: drafted.snapshot.digest,
      })
      const raw = yield* Effect.promise(() => fs.readFile(path.join(saved.storage.root, saved.storage.path), "utf8"))
      const json = JSON.parse(raw)

      expect(json.edges[0]).toEqual({
        id: "a-b",
        source: "a",
        target: "b",
        sourceHandle: "bottom",
        targetHandle: "top",
        style: "rectangular",
      })
    }),
  )

  it.live("backs up an invalid resource before explicit recovery", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const roots = yield* ArchitectureRoot.Service
      const storage = yield* roots.get
      yield* Effect.promise(async () => {
        await fs.mkdir(storage.resources, { recursive: true })
        await fs.writeFile(path.join(storage.resources, "broken.json"), "{ invalid")
      })

      expect(Exit.isFailure(yield* graph.load(Architecture.ResourceID.make("broken")).pipe(Effect.exit))).toBe(true)
      const recovered = yield* graph.reset(Architecture.ResourceID.make("broken"))
      const entries = yield* Effect.promise(() => fs.readdir(storage.resources))

      expect(recovered.resource.nodes).toEqual([])
      expect(entries.some((entry) => /^broken\.invalid\.\d+\.json$/.test(entry))).toBe(true)
    }),
  )
})

function resolveRoot(directory: string) {
  const absolute = AbsolutePath.make(directory)
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location(Location.Ref.make({ directory: absolute }))),
  )
  return Effect.runPromise(
    ArchitectureRoot.Service.use((roots) => roots.get).pipe(
      Effect.provide(
        LayerNode.compile(LayerNode.group([ArchitectureRoot.node, Location.node]), [[Location.node, locationLayer]]),
      ),
      Effect.scoped,
    ),
  )
}
