import { describe, expect, test } from "bun:test"

describe("architecture resource header", () => {
  test("wires resource lifecycle actions through the File menu", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()
    const fileMenu = source.match(/<MenuV2 gutter=\{4\} modal=\{false\} placement="bottom-end">[\s\S]*?<\/MenuV2>/)?.[0]

    if (!fileMenu) throw new Error("Architecture resource File menu was not found")
    expect(fileMenu).toContain('language.t("command.category.file")')
    expect(fileMenu).toContain('<MenuV2.Item onSelect={() => void createResource()}')
    expect(fileMenu).toContain("<MenuV2.Item onSelect={requestDuplicateResource}")
    expect(fileMenu).toContain("<MenuV2.Item onSelect={removeResource}")
    expect(fileMenu).not.toContain("exportResource")
  })

  test("does not keep separate resource lifecycle buttons beside the selector", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()

    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={() => void createResource()}')
    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={requestDuplicateResource}')
    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={removeResource}')
  })

  test("keeps graph save and reload available as direct header actions", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()

    expect(source).toContain('dispatchArchitectureCommand("save", event.currentTarget)')
    expect(source).toContain("onClick={() => reload()}")
  })

  test("captures the reload target before opening discard confirmation", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const reloadResource = async (scope: ReturnType<typeof operationScope>)")
    expect(source).toContain("const scope = operationScope(id)")
    expect(source).toContain("confirm(labels().discardConfirm, labels().reload, () => void reloadResource(scope))")
  })

  test("bumps the same-resource live instance after save or reload replaces the backend instance", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()
    const save = source.match(
      /const save = async \(change: ArchitectureInstanceChange\) => \{[\s\S]*?\n  const confirm = /,
    )?.[0]
    const reloadResource = source.match(
      /const reloadResource = async \(scope: ReturnType<typeof operationScope>\) => \{[\s\S]*?\n  const reload = \(\) => \{/,
    )?.[0]

    if (!save) throw new Error("Save handler was not found")
    if (!reloadResource) throw new Error("Reload resource handler was not found")
    expect(source).toContain("liveInstanceVersions")
    expect(save).toContain('setPersistedState("pendingOverlays", id, undefined)')
    expect(save).toContain('setState("liveInstanceVersions", id, (current) => (current ?? 0) + 1)')
    expect(reloadResource).toContain('setState("liveInstanceVersions", id, (current) => (current ?? 0) + 1)')
    expect(source).toContain("liveInstanceVersion={liveInstanceVersion()}")
  })

  test("delegates server event synchronization out of the panel", async () => {
    const panel = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()
    const sync = await Bun.file(new URL("./server-event-sync.ts", import.meta.url)).text()

    expect(panel).toContain("syncArchitectureServerEvent")
    expect(sync).toContain("adoptArchitectureLiveInstanceCache(current, plan.cache)")
  })
})
