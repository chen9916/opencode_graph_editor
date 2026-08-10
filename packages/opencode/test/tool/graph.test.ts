import { describe, expect, test } from "bun:test"
import { ArchitectureGraph } from "@opencode-ai/core/architecture/graph"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { RelativePath } from "@opencode-ai/core/schema"
import { ArchitectureTools } from "@opencode-ai/core/architecture/tools"
import { Architecture } from "@opencode-ai/schema/architecture"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { GraphTools } from "@/tool/graph"
import { Tool } from "@/tool/tool"
import * as Truncate from "@/tool/truncate"
import { withTmpdirInstance } from "../fixture/fixture"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_graph_tool"),
  messageID: MessageID.make("msg_graph_tool"),
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_graph_tool",
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function graphMock(input: Partial<ArchitectureGraph.Interface> = {}): ArchitectureGraph.Interface {
  return {
    list: () => Effect.die("unexpected graph list in legacy GraphTools test"),
    listLive: () => Effect.succeed({ resources: [], source: "saved" }),
    create: () => Effect.die("unexpected graph create in legacy GraphTools test"),
    duplicate: () => Effect.die("unexpected graph duplicate in legacy GraphTools test"),
    load: () => Effect.die("unexpected graph load in legacy GraphTools test"),
    loadLive: () => Effect.die("unexpected graph live load in legacy GraphTools test"),
    loadDraft: () => Effect.die("unexpected graph draft load in legacy GraphTools test"),
    patchLive: () => Effect.die("unexpected graph live patch in legacy GraphTools test"),
    patchDraft: () => Effect.die("unexpected graph draft patch in legacy GraphTools test"),
    commitDraft: () => Effect.die("unexpected graph draft commit in legacy GraphTools test"),
    discardDraft: () => Effect.die("unexpected graph draft discard in legacy GraphTools test"),
    reloadSaved: () => Effect.die("unexpected graph saved reload in legacy GraphTools test"),
    remove: () => Effect.die("unexpected graph remove in legacy GraphTools test"),
    reset: () => Effect.die("unexpected graph reset in legacy GraphTools test"),
    query: () => Effect.die("unexpected graph query in legacy GraphTools test"),
    queryLive: () => Effect.die("unexpected graph live query in legacy GraphTools test"),
    context: () => Effect.die("unexpected graph context in legacy GraphTools test"),
    contextLive: () => Effect.die("unexpected graph live context in legacy GraphTools test"),
    ...input,
  }
}

function layer(graph: Partial<ArchitectureGraph.Interface>) {
  return Layer.mergeAll(
    Layer.mock(Truncate.Service, {
      output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    }),
    Layer.mock(Agent.Service, {
      get: () => Effect.succeed({ name: "build", mode: "all", options: {}, permission: [] } as unknown as Agent.Info),
    }),
    Layer.mock(LocationServiceMap.Service, {
      get: () => Layer.mock(ArchitectureGraph.Service, graphMock(graph)),
    } as any),
  )
}

function snapshot(resource: Architecture.Resource, digest = "digest"): Architecture.ResourceSnapshot {
  return {
    resource,
    digest,
    storage: { root: ".opencode/architecture", path: RelativePath.make(`${resource.id}.json`) },
  }
}

function summary(input: Architecture.ResourceSnapshot): Architecture.ResourceSummary {
  return {
    id: input.resource.id,
    name: input.resource.name,
    revision: input.resource.revision,
    digest: input.digest,
    nodes: input.resource.nodes.length,
    edges: input.resource.edges.length,
  }
}

function runTool(id: string, input: Record<string, unknown>, graph: Partial<ArchitectureGraph.Interface>) {
  return Effect.gen(function* () {
    const tools = yield* GraphTools
    const info = tools.find((tool) => tool.id === id)
    if (!info) throw new Error(`Graph tool not found: ${id}`)
    return yield* (yield* Tool.init(info)).execute(input, ctx)
  }).pipe(withTmpdirInstance(), Effect.scoped, Effect.provide(layer(graph)))
}

async function failure(effect: Effect.Effect<unknown, unknown, never>) {
  const exit = await Effect.runPromise(effect.pipe(Effect.exit))
  if (Exit.isSuccess(exit)) throw new Error("expected the tool to fail")
  return Cause.squash(exit.cause) as Error
}

describe("legacy graph tools", () => {
  test("list reads live resources and reports source metadata", async () => {
    const saved = snapshot({
      version: 2,
      id: Architecture.ResourceID.make("design_test"),
      name: "Live graph",
      revision: 1,
      nodes: [],
      edges: [],
    })
    const output = await Effect.runPromise(
      runTool(ArchitectureTools.names.listResources, {}, {
        listLive: () => Effect.succeed({ resources: [{ ...summary(saved), source: "live" as const }], source: "live" as const }),
      }),
    )

    expect(JSON.parse(output.output)).toEqual([{ ...summary(saved), source: "live" }])
    expect(output.metadata).toMatchObject({ count: 1, source: "live" })
  })

  test("reload reads the saved resource and reports saved source", async () => {
    const saved = snapshot({
      version: 2,
      id: Architecture.ResourceID.make("design_test"),
      name: "Saved graph",
      revision: 2,
      nodes: [],
      edges: [],
    })
    const output = await Effect.runPromise(
      runTool(ArchitectureTools.names.reloadResource, { resourceID: "design_test" }, {
        reloadSaved: () => Effect.succeed({ snapshot: saved, source: "saved" as const }),
      }),
    )

    expect(JSON.parse(output.output)).toMatchObject({ resource: { name: "Saved graph" }, source: "saved" })
    expect(output.metadata).toMatchObject({ resourceID: "design_test", revision: 2, digest: "digest", source: "saved" })
  })

  test("save commits live drafts using the current draft revision and digest", async () => {
    const resourceID = Architecture.ResourceID.make("design_test")
    const current = snapshot({ version: 2, id: resourceID, name: "Live graph", revision: 4, nodes: [], edges: [] }, "live-digest")
    const saved = snapshot({ ...current.resource, revision: 5 }, "saved-digest")
    const calls: string[] = []
    const output = await Effect.runPromise(
      runTool(ArchitectureTools.names.saveResource, {
        resourceID: "design_test",
        expectedDigest: "live-digest",
      }, {
        loadDraft: () => Effect.sync(() => {
          calls.push("loadDraft")
          return { snapshot: current, source: "live" as const }
        }),
        commitDraft: (_id, input) => Effect.sync(() => {
          calls.push(`commitDraft:${input.revision}:${input.digest}`)
          return saved
        }),
      }),
    )

    expect(calls).toEqual(["loadDraft", "commitDraft:4:live-digest"])
    expect(JSON.parse(output.output)).toMatchObject({
      resource: { id: "design_test", revision: 5 },
      digest: "saved-digest",
      source: "saved",
      saved: true,
    })
    expect(output.metadata).toMatchObject({
      resourceID: "design_test",
      revision: 5,
      digest: "saved-digest",
      source: "saved",
      saved: true,
    })
  })

  test("save no-ops when no live draft exists", async () => {
    const resourceID = Architecture.ResourceID.make("design_test")
    const current = snapshot({ version: 2, id: resourceID, name: "Saved graph", revision: 2, nodes: [], edges: [] }, "saved-digest")
    const calls: string[] = []
    const output = await Effect.runPromise(
      runTool(ArchitectureTools.names.saveResource, { resourceID: "design_test" }, {
        loadDraft: () => Effect.sync(() => {
          calls.push("loadDraft")
          return { snapshot: current, source: "saved" as const }
        }),
      }),
    )

    expect(calls).toEqual(["loadDraft"])
    expect(JSON.parse(output.output)).toMatchObject({
      resource: { id: "design_test", revision: 2 },
      digest: "saved-digest",
      source: "saved",
      saved: false,
    })
    expect(output.metadata).toMatchObject({
      resourceID: "design_test",
      revision: 2,
      digest: "saved-digest",
      source: "saved",
      saved: false,
    })
  })

  test("save rejects stale expected digests before committing", async () => {
    const resourceID = Architecture.ResourceID.make("design_test")
    const current = snapshot({ version: 2, id: resourceID, name: "Live graph", revision: 4, nodes: [], edges: [] }, "live-digest")
    const calls: string[] = []
    const error = await failure(
      runTool(ArchitectureTools.names.saveResource, {
        resourceID: "design_test",
        expectedDigest: "stale-digest",
      }, {
        loadDraft: () => Effect.sync(() => {
          calls.push("loadDraft")
          return { snapshot: current, source: "live" as const }
        }),
      }),
    ) as Error & { conflict?: { error?: string; operation?: string; expectedDigest?: string; currentDigest?: string } }

    expect(calls).toEqual(["loadDraft"])
    expect(error.message).toContain("operation=graph_save_resource")
    expect(error.conflict).toMatchObject({
      error: "GraphConflictError",
      operation: "graph_save_resource",
      expectedDigest: "stale-digest",
      currentDigest: "live-digest",
    })
  })

  test("edits load and patch the live draft by default", async () => {
    const resourceID = Architecture.ResourceID.make("design_test")
    const current = snapshot({ version: 2, id: resourceID, name: "Live graph", revision: 4, nodes: [], edges: [] }, "live-digest")
    const patched = snapshot({
      ...current.resource,
      revision: 5,
      nodes: [
        {
          id: Architecture.NodeID.make("node_test"),
          text: "Draft node",
          tags: [],
          layout: { position: { x: 1, y: 2 } },
        },
      ],
    }, "patched-digest")
    const calls: string[] = []
    const output = await Effect.runPromise(
      runTool(ArchitectureTools.names.createNode, {
        resourceID: "design_test",
        id: "node_test",
        text: "Draft node",
        position: { x: 1, y: 2 },
      }, {
        loadLive: () => Effect.sync(() => {
          calls.push("loadLive")
          return { snapshot: current, source: "live" as const }
        }),
        patchLive: (_id, input) => Effect.sync(() => {
          calls.push(`patchLive:${input.revision}:${input.digest}`)
          return { snapshot: patched, source: "live" as const }
        }),
      }),
    )

    expect(calls).toEqual(["loadLive", "patchLive:4:live-digest"])
    expect(JSON.parse(output.output)).toMatchObject({ revision: 5, digest: "patched-digest", source: "live" })
    expect(output.metadata).toMatchObject({ resourceID: "design_test", revision: 5, digest: "patched-digest", source: "live" })
  })
})
