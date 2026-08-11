import { describe, expect } from "bun:test"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { ArchitectureLayout } from "@opencode-ai/core/architecture/layout"
import { ArchitectureTools } from "@opencode-ai/core/architecture/tools"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ArchitectureTools.node, ArchitectureGraph.node, ToolRegistry.node, Location.node]),
    [
      [Location.node, tempLocationLayer],
      [PermissionV2.node, permission],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_architecture_tools")
const call = (name: string, input: unknown, id = `call-${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})
const resourceID = Architecture.ResourceID.make("product")
const layoutResourceID = Architecture.ResourceID.make("layout-sample")
describe("ArchitectureTools", () => {
  it.effect("lets agents create, edit, query, and connect graph nodes", () =>
    Effect.gen(function* () {
      assertions.length = 0
      deny = false
      const registry = yield* ToolRegistry.Service
      const graph = yield* ArchitectureGraph.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name).toSorted()).toEqual(
        Object.values(ArchitectureTools.names).toSorted(),
      )
      expect((yield* toolDefinitions(registry)).map((tool) => tool.description).join("\n")).toContain(
        "Use this instead of searching workspace files",
      )
      expect((yield* toolDefinitions(registry)).map((tool) => tool.description).join("\n")).toContain(
        "sourceHandle, targetHandle, and style",
      )
      expect((yield* toolDefinitions(registry)).map((tool) => tool.description).join("\n")).toContain(
        "Do not edit graph JSON directly",
      )

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: resourceID,
          name: "Product intent",
        }),
      )
      yield* settleTool(
        registry,
        call(
          ArchitectureTools.names.createResource,
          {
            id: "details",
            name: "Interaction details",
          },
          "call-create-details",
        ),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID,
          id: "a",
          text: "Conversation",
          tags: ["planned"],
        }),
      )
      yield* settleTool(
        registry,
        call(
          ArchitectureTools.names.createNode,
          {
            resourceID,
            id: "b",
            text: "Memory",
            tags: ["implemented"],
          },
          "call-create-b",
        ),
      )

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.updateNode, {
          resourceID,
          nodeID: "a",
          text: "Updated conversation",
          tags: ["planned", "interaction"],
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.setTagColor, {
          resourceID,
          tag: "interaction",
          color: "#4c82ff",
        }),
      )
      const connected = yield* settleTool(
        registry,
        call(ArchitectureTools.names.connectNodes, {
          resourceID,
          id: "a-to-b",
          source: "a",
          target: "b",
          sourceHandle: "bottom",
          targetHandle: "top",
        }),
      )
      expect(connected.output?.structured).toMatchObject({
        source: "live",
        edge: { id: "a-to-b", source: "a", target: "b", sourceHandle: "bottom", targetHandle: "top", style: "curved" },
      })

      const updatedConnection = yield* settleTool(
        registry,
        call(ArchitectureTools.names.updateConnection, {
          resourceID,
          edgeID: "a-to-b",
          sourceHandle: "left",
          targetHandle: "right",
          style: "straight",
        }),
      )
      expect(updatedConnection.output?.structured).toMatchObject({
        edge: { id: "a-to-b", sourceHandle: "left", targetHandle: "right", style: "straight" },
      })

      const layout = yield* settleTool(
        registry,
        call(ArchitectureTools.names.updateLayout, {
          resourceID,
          nodes: [{ nodeID: "a", position: { x: -160, y: 80 } }],
          edges: [{ edgeID: "a-to-b", sourceHandle: "right", targetHandle: "left", style: "rectangular" }],
        }),
      )
      expect(layout.output?.structured).toMatchObject({
        nodeIDs: ["a"],
        edgeIDs: ["a-to-b"],
      })

      const queried = yield* settleTool(
        registry,
        call(ArchitectureTools.names.query, {
          resourceIDs: [resourceID],
          nodeIDs: ["a"],
          tags: ["interaction"],
          depth: 1,
        }),
      )
      expect(queried.output?.structured).toMatchObject({
        nodes: [
          { resourceID: "product", node: { id: "a" } },
          { resourceID: "product", node: { id: "b" } },
        ],
      })

      const context = yield* settleTool(registry, call(ArchitectureTools.names.getContext, {}))
      expect(context.output?.structured).toContain("Updated conversation [interaction #4c82ff, planned]")
      expect(context.output?.structured).toContain(".opencode/architecture/resources/product.json")
      expect(context.output?.structured).toContain("a.right -> b.left (style: rectangular)")
      expect(context.output?.structured).toContain("details")

      const reloaded = yield* settleTool(registry, call(ArchitectureTools.names.reloadResource, { resourceID }))
      expect(reloaded.output?.structured).toMatchObject({
        source: "saved",
        resource: { id: "product", nodes: [], edges: [] },
      })
      expect(assertions.every((item) => item.resources[0]?.startsWith(".opencode/architecture/resources"))).toBe(true)
      expect(assertions.every((item) => item.source?.type === "tool")).toBe(true)
    }),
  )

  it.effect("validates all managed resources and auto-layout can dry-run then persist", () =>
    Effect.gen(function* () {
      assertions.length = 0
      deny = false
      const registry = yield* ToolRegistry.Service
      const graph = yield* ArchitectureGraph.Service

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: "validation-a",
          name: "Validation A",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: "validation-a",
          text: "Conversation",
          tags: ["planned"],
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.setTagColor, {
          resourceID: "validation-a",
          tag: "planned",
          color: "#4c82ff",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: "validation-b",
          name: "Validation B",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: "validation-b",
          text: "Memory",
          tags: ["implemented"],
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.setTagColor, {
          resourceID: "validation-b",
          tag: "implemented",
          color: "#16a34a",
        }),
      )

      const validation = yield* settleTool(registry, call(ArchitectureTools.names.validate, {}))
      expect(validation.output?.structured).toMatchObject({
        valid: true,
        summary: { checked: 2, invalid: 0 },
        resources: expect.arrayContaining([
          expect.objectContaining({ resourceID: "validation-a", valid: true }),
          expect.objectContaining({ resourceID: "validation-b", valid: true }),
        ]),
      })

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: layoutResourceID,
          name: "Layout sample",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: layoutResourceID,
          id: "a",
          text: "A",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: layoutResourceID,
          id: "b",
          text: "B",
        }),
      )
      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: layoutResourceID,
          id: "c",
          text: "C",
        }),
      )

      const before = yield* graph.load(layoutResourceID)
      const dryRun = yield* settleTool(
        registry,
        call(ArchitectureTools.names.autoLayout, {
          resourceID: layoutResourceID,
          mode: "columns",
          columns: [
            { nodeIDs: ["a", "b"] },
            { nodeIDs: ["c"] },
          ],
          origin: { x: 0, y: 0 },
          spacing: { x: 120, y: 60 },
          dryRun: true,
        }),
      )
      const dryRunOutput = dryRun.output?.structured as ArchitectureLayout.Output | undefined
      expect(dryRunOutput).toMatchObject({
        resourceID: "layout-sample",
        dryRun: true,
        mode: "columns",
        nodeIDs: ["a", "b", "c"],
        positions: [
          { nodeID: "a", position: { x: 0, y: 0 } },
          { nodeID: "b", position: { x: 0, y: 60 } },
          { nodeID: "c", position: { x: 120, y: 0 } },
        ],
      })
      expect(dryRunOutput?.revision).toBeUndefined()
      expect(dryRunOutput?.digest).toBeUndefined()
      expect((yield* graph.load(layoutResourceID)).resource).toEqual(before.resource)

      const applied = yield* settleTool(
        registry,
        call(ArchitectureTools.names.autoLayout, {
          resourceID: layoutResourceID,
          mode: "columns",
          columns: [
            { nodeIDs: ["a", "b"] },
            { nodeIDs: ["c"] },
          ],
          origin: { x: 0, y: 0 },
          spacing: { x: 120, y: 60 },
        }),
      )
      expect(applied.output?.structured).toMatchObject({
        resourceID: "layout-sample",
        dryRun: false,
        mode: "columns",
        nodeIDs: ["a", "b", "c"],
        positions: [
          { nodeID: "a", position: { x: 0, y: 0 } },
          { nodeID: "b", position: { x: 0, y: 60 } },
          { nodeID: "c", position: { x: 120, y: 0 } },
        ],
      })

      const reloaded = yield* graph.loadInstance(layoutResourceID)
      expect(reloaded.source).toBe("live")
      expect(reloaded.snapshot.resource.nodes.map((node) => ({ id: node.id, position: node.layout.position }))).toEqual([
        { id: Architecture.NodeID.make("a"), position: { x: 0, y: 0 } },
        { id: Architecture.NodeID.make("b"), position: { x: 0, y: 60 } },
        { id: Architecture.NodeID.make("c"), position: { x: 120, y: 0 } },
      ])
      expect(reloaded.snapshot.resource.revision).toBeGreaterThan(before.resource.revision)
      expect((yield* graph.load(layoutResourceID)).resource).toEqual(before.resource)
    }),
  )

  it.effect("batch edits graph nodes and connections atomically", () =>
    Effect.gen(function* () {
      assertions.length = 0
      deny = false
      const registry = yield* ToolRegistry.Service
      const graph = yield* ArchitectureGraph.Service

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: resourceID,
          name: "Product intent",
        }),
      )
      const created = yield* settleTool(
        registry,
        call(ArchitectureTools.names.batchEdit, {
          resourceID,
          setTagColors: [
            { tag: "planned", color: "#4C82FF" },
            { tag: "implemented", color: "#16A34A" },
          ],
          createNodes: [
            { id: "a", text: "Conversation", tags: ["planned"], position: { x: 0, y: 0 } },
            { id: "b", text: "Memory", tags: ["implemented"], position: { x: 280, y: 0 } },
          ],
          createEdges: [
            {
              id: "a-to-b",
              source: "a",
              target: "b",
              sourceHandle: "right",
              targetHandle: "left",
              style: "rectangular",
            },
          ],
        }),
      )
      expect(created.output?.structured).toMatchObject({
        createdNodeIDs: ["a", "b"],
        updatedNodeIDs: [],
        createdEdgeIDs: ["a-to-b"],
        updatedEdgeIDs: [],
        updatedTagColors: ["planned", "implemented"],
      })

      const updated = yield* settleTool(
        registry,
        call(ArchitectureTools.names.batchEdit, {
          resourceID,
          setTagColors: [{ tag: "interaction", color: "#C084FC" }, { tag: "implemented" }],
          updateNodes: [
            {
              nodeID: "a",
              text: "Updated conversation",
              tags: ["planned", "interaction"],
              position: { x: -160, y: 80 },
            },
          ],
          updateEdges: [{ edgeID: "a-to-b", sourceHandle: "bottom", targetHandle: "top", style: "curved" }],
        }),
      )
      expect(updated.output?.structured).toMatchObject({
        createdNodeIDs: [],
        updatedNodeIDs: ["a"],
        createdEdgeIDs: [],
        updatedEdgeIDs: ["a-to-b"],
        updatedTagColors: ["interaction", "implemented"],
      })

      const reloaded = yield* graph.loadInstance(resourceID)
      expect(reloaded).toMatchObject({
        source: "live",
        snapshot: { resource: {
          tagColors: { interaction: "#c084fc", planned: "#4c82ff" },
          nodes: [
            {
              id: "a",
              text: "Updated conversation",
              tags: ["interaction", "planned"],
              layout: { position: { x: -160, y: 80 } },
            },
            { id: "b", text: "Memory", tags: ["implemented"], layout: { position: { x: 280, y: 0 } } },
          ],
          edges: [
            {
              id: "a-to-b",
              source: "a",
              target: "b",
              sourceHandle: "bottom",
              targetHandle: "top",
              style: "curved",
            },
          ],
        } },
      })
    }),
  )

  it.effect("saves live instances and no-ops when already saved", () =>
    Effect.gen(function* () {
      assertions.length = 0
      deny = false
      const registry = yield* ToolRegistry.Service
      const graph = yield* ArchitectureGraph.Service
      const saveResourceID = Architecture.ResourceID.make("save-sample")

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: saveResourceID,
          name: "Save sample",
        }),
      )

      const noOp = yield* settleTool(registry, call(ArchitectureTools.names.saveResource, { resourceID: saveResourceID }))
      expect(noOp.output?.structured).toMatchObject({
        resource: { id: "save-sample" },
        source: "saved",
        saved: false,
      })

      yield* settleTool(
        registry,
        call(ArchitectureTools.names.createNode, {
          resourceID: saveResourceID,
          id: "instance-node",
          text: "Instance node",
        }),
      )
      const instance = yield* graph.loadInstance(saveResourceID)
      expect(instance.source).toBe("live")

      const saved = yield* settleTool(
        registry,
        call(ArchitectureTools.names.saveResource, {
          resourceID: saveResourceID,
          expectedDigest: instance.snapshot.digest,
        }),
      )
      expect(saved.output?.structured).toMatchObject({
        resource: { id: "save-sample" },
        source: "saved",
        saved: true,
      })
      expect((yield* graph.loadInstance(saveResourceID)).source).toBe("saved")
      expect((yield* graph.load(saveResourceID)).resource.nodes).toMatchObject([{ id: "instance-node", text: "Instance node" }])
    }),
  )

  it.effect("does not read or mutate resources after permission denial", () =>
    Effect.gen(function* () {
      assertions.length = 0
      deny = true
      const registry = yield* ToolRegistry.Service
      const graph = yield* ArchitectureGraph.Service
      const result = yield* settleTool(
        registry,
        call(ArchitectureTools.names.createResource, {
          id: "blocked",
          name: "Blocked",
        }),
      )

      expect(result.result.type).toBe("error")
      expect(yield* graph.list()).toEqual([])
      expect(assertions).toMatchObject([
        {
          action: "edit",
          resources: [".opencode/architecture/resources/blocked.json"],
        },
      ])
    }),
  )
})
