import { describe, expect } from "bun:test"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
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
      const connected = yield* settleTool(
        registry,
        call(ArchitectureTools.names.connectNodes, {
          resourceID,
          id: "a-to-b",
          source: "a",
          target: "b",
          sourceHandle: "bottom",
          targetHandle: "top",
          style: "curved",
        }),
      )
      expect(connected.output?.structured).toMatchObject({
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

      const reloaded = yield* settleTool(registry, call(ArchitectureTools.names.reloadResource, { resourceID }))
      expect(reloaded.output?.structured).toMatchObject({
        resource: {
          id: "product",
          nodes: [
            {
              id: "a",
              text: "Updated conversation",
              tags: ["interaction", "planned"],
              layout: { position: { x: -160, y: 80 } },
            },
            { id: "b", text: "Memory", tags: ["implemented"], layout: { position: { x: 0, y: 0 } } },
          ],
          edges: [
            {
              id: "a-to-b",
              source: "a",
              target: "b",
              sourceHandle: "right",
              targetHandle: "left",
              style: "rectangular",
            },
          ],
        },
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
      expect(context.output?.structured).toContain("Updated conversation [interaction, planned]")
      expect(context.output?.structured).toContain(".opencode/architecture/resources/product.json")
      expect(context.output?.structured).toContain("a.right -> b.left (style: rectangular)")
      expect(context.output?.structured).toContain("details")
      expect(assertions.every((item) => item.resources[0]?.startsWith(".opencode/architecture/resources"))).toBe(true)
      expect(assertions.every((item) => item.source?.type === "tool")).toBe(true)
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
