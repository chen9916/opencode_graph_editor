import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"
import { userVisibleTextPart } from "./message-user-text"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("userVisibleTextPart", () => {
  test("uses only the non-synthetic non-ignored user text", () => {
    const part = userVisibleTextPart([
      { id: "part_context", type: "text", text: "full graph context", synthetic: true },
      { id: "part_hidden", type: "text", text: "ignored", ignored: true },
      { id: "part_visible", type: "text", text: "short question" },
    ] as never)

    expect(part?.text).toBe("short question")
  })
})
