import { describe, expect, test } from "bun:test"

describe("architecture resource header", () => {
  test("wires resource lifecycle actions through the File menu", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()
    const fileMenu = source.match(/<MenuV2 gutter=\{4\} modal=\{false\} placement="bottom-end">[\s\S]*?<\/MenuV2>/)?.[0]

    if (!fileMenu) throw new Error("Architecture resource File menu was not found")
    expect(fileMenu).toContain('language.t("command.category.file")')
    expect(fileMenu).toContain('<MenuV2.Item onSelect={() => void createResource()}')
    expect(fileMenu).toContain('<MenuV2.Item onSelect={requestDuplicateResource}')
    expect(fileMenu).toContain('<MenuV2.Item onSelect={removeResource}')
    expect(fileMenu).not.toContain("exportResource")
  })

  test("does not keep separate resource lifecycle buttons beside the selector", async () => {
    const source = await Bun.file(new URL("./architecture-panel.tsx", import.meta.url)).text()

    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={() => void createResource()}')
    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={requestDuplicateResource}')
    expect(source).not.toContain('<ButtonV2 variant="ghost" onClick={removeResource}')
  })
})
