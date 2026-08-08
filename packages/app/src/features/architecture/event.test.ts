import { describe, expect, test } from "bun:test"
import {
  architectureResourceEventInfo,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
  beginArchitectureLocalSave,
  isArchitectureLocalSaveEvent,
} from "./event"

describe("architecture resource events", () => {
  test("reads legacy properties and current data payloads", () => {
    expect(
      architectureResourceEventInfo({
        type: "architecture.resource.updated",
        properties: { resourceID: "design", revision: 2, digest: "abc" },
      }),
    ).toEqual({ resourceID: "design", revision: 2, digest: "abc" })

    expect(
      architectureResourceEventInfo({
        type: "architecture.resource.updated",
        data: { resourceID: "design", revision: 3, digest: "def" },
      }),
    ).toEqual({ resourceID: "design", revision: 3, digest: "def" })
  })

  test("detects resource list and snapshot freshness", () => {
    const event = { resourceID: "design", revision: 2, digest: "abc" }
    expect(
      architectureSummaryMatchesEvent(
        [{ id: "design", name: "Design", revision: 2, digest: "abc", nodes: 1, edges: 0 }],
        event,
      ),
    ).toBe(true)
    expect(
      architectureSummaryMatchesEvent(
        [{ id: "design", name: "Design", revision: 1, digest: "old", nodes: 1, edges: 0 }],
        event,
      ),
    ).toBe(false)
    expect(
      architectureSnapshotMatchesEvent(
        {
          resource: { version: 2, id: "design", name: "Design", revision: 2, nodes: [], edges: [] },
          digest: "abc",
          storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
        },
        event,
      ),
    ).toBe(true)
  })

  test("tracks in-flight local saves by server directory resource and revision", () => {
    const finish = beginArchitectureLocalSave({
      server: "http://127.0.0.1:4096",
      directory: "C:/repo",
      resourceID: "design",
      revision: 2,
    })

    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 2, digest: "abc" },
      }),
    ).toBe(true)
    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 3, digest: "abc" },
      }),
    ).toBe(false)

    finish()

    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 2, digest: "abc" },
      }),
    ).toBe(false)
  })
})
