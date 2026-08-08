import { expect, test } from "bun:test"
import { Ignore } from "@opencode-ai/core/filesystem/ignore"

test("match nested and non-nested", () => {
  expect(Ignore.match("node_modules/index.js")).toBe(true)
  expect(Ignore.match("node_modules")).toBe(true)
  expect(Ignore.match("node_modules/")).toBe(true)
  expect(Ignore.match("node_modules/bar")).toBe(true)
  expect(Ignore.match("node_modules/bar/")).toBe(true)
})

test("matches managed architecture storage", () => {
  expect(Ignore.match(".opencode/architecture")).toBe(true)
  expect(Ignore.match(".opencode/architecture/resources/design.json")).toBe(true)
  expect(Ignore.match("packages/app/.opencode/architecture/resources/design.json")).toBe(true)
  expect(Ignore.match(".opencode/agent/custom.md")).toBe(false)
})
