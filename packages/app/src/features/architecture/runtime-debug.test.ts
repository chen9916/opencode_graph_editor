import { describe, expect, test } from "bun:test"
import type { ArchitectureCanvasSourceTransition } from "./canvas-source-sync"
import { architectureCanvasSourceDebugEvent, prependArchitectureRuntimeDebugEvent } from "./runtime-debug"

describe("architecture runtime debug", () => {
  test("records bounded canvas source events with metadata-only details", () => {
    const event = architectureCanvasSourceDebugEvent({
      action: "replace",
      reason: "same-revision-digest-change",
      resourceID: "design",
      source: "live",
      from: { resourceID: "design", revision: 2, digest: "saved", source: "saved" },
      to: { resourceID: "design", revision: 2, digest: "live", source: "live" },
    } satisfies ArchitectureCanvasSourceTransition)

    expect(event).toMatchObject({
      resourceID: "design",
      type: "canvas-source",
      status: "received",
      revision: 2,
      digest: "live",
      details: [
        { key: "action", value: "replace" },
        { key: "source", value: "live" },
        { key: "reason", value: "same-revision-digest-change" },
        { key: "resourceID", value: "design" },
        { key: "fromRevision", value: 2 },
        { key: "fromDigest", value: "saved" },
        { key: "toRevision", value: 2 },
        { key: "toDigest", value: "live" },
      ],
    })
    expect(prependArchitectureRuntimeDebugEvent(Array.from({ length: 8 }, () => event), event)).toHaveLength(8)
  })
})
