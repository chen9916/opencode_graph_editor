import { describe, expect } from "bun:test"
import { ArchitectureContext } from "@opencode-ai/core/architecture/context"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { Architecture } from "@opencode-ai/schema/architecture"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ArchitectureContext.node, ArchitectureGraph.node, SystemContextRegistry.node, Location.node]),
    [[Location.node, tempLocationLayer]],
  ),
)

describe("ArchitectureContext", () => {
  it.live("contributes dynamic context for all shared architecture graphs", () =>
    Effect.gen(function* () {
      const graph = yield* ArchitectureGraph.Service
      const registry = yield* SystemContextRegistry.Service

      expect(yield* SystemContext.initialize(yield* registry.load())).toEqual({ baseline: "", snapshot: {} })

      const base = yield* graph.create({
        id: Architecture.ResourceID.make("product"),
        name: "Product intent",
      })
      const saved = yield* graph.patch(base.resource.id, {
        revision: base.resource.revision,
        digest: base.digest,
        operations: [
          {
            id: Architecture.OperationID.make("create"),
            type: "node.create",
            node: {
              id: Architecture.NodeID.make("conversation"),
              text: "Conversation",
              tags: [Architecture.Tag.make("planned"), Architecture.Tag.make("user experience")],
              layout: { position: { x: 0, y: 0 } },
            },
          },
        ],
      })
      const initialized = yield* SystemContext.initialize(yield* registry.load())
      expect(initialized.baseline).toContain("lightweight communication artifacts")
      expect(initialized.baseline).toContain("@Product intent (resource ID: product")
      expect(initialized.baseline).toContain("do not search ordinary project files")
      expect(initialized.baseline).toContain("Conversation [planned, user experience]")

      const current = saved.resource.nodes[0]!
      const changed = yield* graph.patch(saved.resource.id, {
        revision: saved.resource.revision,
        digest: saved.digest,
        operations: [
          {
            id: Architecture.OperationID.make("rename"),
            type: "node.update",
            node: { ...current, text: "Collaborative conversation" },
          },
        ],
      })
      const reconciled = yield* SystemContext.reconcile(yield* registry.load(), initialized.snapshot)
      expect(reconciled).toMatchObject({ _tag: "Updated" })
      if (reconciled._tag === "Updated") {
        expect(reconciled.text).toContain(`revision ${changed.resource.revision}`)
        expect(reconciled.text).toContain("Collaborative conversation")
      }

      yield* Effect.promise(() =>
        fs.writeFile(path.join(changed.storage.root, changed.storage.path), "{ invalid architecture"),
      )
      const warning = yield* SystemContext.initialize(yield* registry.load())
      expect(warning.baseline).toContain("Architecture context is unavailable")
      expect(warning.baseline).toContain("not valid JSON")
    }),
  )
})
