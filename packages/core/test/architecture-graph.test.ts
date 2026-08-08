import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitecturePatch } from "@opencode-ai/core/architecture/patch"
import { ArchitectureRoot } from "@opencode-ai/core/architecture/root"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
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
  AppNodeBuilder.build(LayerNode.group([ArchitectureGraph.node, ArchitectureRoot.node, Location.node]), [
    [Location.node, tempLocationLayer],
  ]),
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
      const saved = yield* graph.patch(product.resource.id, {
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

  it.live("rejects stale resource snapshots", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const base = yield* graph.create({ id: Architecture.ResourceID.make("design"), name: "Design" })
      const saved = yield* graph.patch(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [{ id: Architecture.OperationID.make("first"), type: "node.create", node: node("first") }],
      })
      const stale = yield* graph
        .patch(base.resource.id, {
          revision: base.resource.revision,
          digest: base.digest,
          operations: [{ id: Architecture.OperationID.make("second"), type: "node.create", node: node("second") }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(stale)).toBe(true)
      expect((yield* graph.load(base.resource.id)).digest).toBe(saved.digest)
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
      const saved = yield* graph.patch(current.resource.id, {
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

      const saved = yield* graph.patch(loaded.resource.id, {
        revision: loaded.resource.revision,
        digest: loaded.digest,
        operations: [{ id: Architecture.OperationID.make("rename"), type: "resource.update", name: "Clean graph" }],
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
