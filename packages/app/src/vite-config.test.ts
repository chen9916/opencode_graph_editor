import { describe, expect, test } from "bun:test"

describe("app vite config", () => {
  test("dev watcher ignores managed architecture storage", async () => {
    const config = await Bun.file(new URL("../vite.js", import.meta.url)).text()
    expect(config).toContain("ignored: [/(^|[/\\\\])\\.opencode[/\\\\]architecture([/\\\\]|$)/]")
  })
})
