import { describe, expect, test } from "bun:test"
import {
  additiveSelectionModifierAfterKeyboardChange,
  hasAdditiveSelectionModifier,
  mergeSelection,
  selectionForGestureChange,
  type Selection,
} from "./selection-state"

describe("architecture selection state", () => {
  test("merges drag selection against the gesture start instead of the live accumulation", () => {
    const base: Selection = {
      nodeIDs: ["existing-node"],
      edgeIDs: [],
      primary: { type: "node", id: "existing-node" },
    }

    const first = mergeSelection(base, {
      nodeIDs: ["existing-node", "new-node"],
      edgeIDs: [],
      primary: { type: "node", id: "new-node" },
    })

    const second = mergeSelection(base, {
      nodeIDs: ["existing-node"],
      edgeIDs: [],
      primary: { type: "node", id: "existing-node" },
    })

    expect(first.nodeIDs).toEqual(["existing-node", "new-node"])
    expect(first.primary).toEqual({ type: "node", id: "new-node" })
    expect(second.nodeIDs).toEqual(["existing-node"])
    expect(second.primary).toEqual({ type: "node", id: "existing-node" })
  })

  test("keeps the original selection when the additive drag box is empty", () => {
    const base: Selection = {
      nodeIDs: ["existing-node"],
      edgeIDs: ["existing-edge"],
      primary: { type: "edge", id: "existing-edge" },
    }

    expect(mergeSelection(base, { nodeIDs: [], edgeIDs: [] })).toEqual(base)
  })

  test("ignores a stored gesture base when additive modifiers are no longer active", () => {
    const base: Selection = {
      nodeIDs: ["stale-node"],
      edgeIDs: [],
      primary: { type: "node", id: "stale-node" },
    }
    const next: Selection = {
      nodeIDs: ["plain-node"],
      edgeIDs: [],
      primary: { type: "node", id: "plain-node" },
    }

    expect(selectionForGestureChange({ base }, false, next)).toEqual(next)
  })

  test("merges a trailing additive drag-box change against the gesture base", () => {
    const base: Selection = {
      nodeIDs: ["existing-node"],
      edgeIDs: [],
      primary: { type: "node", id: "existing-node" },
    }
    const boxed: Selection = {
      nodeIDs: ["boxed-node"],
      edgeIDs: [],
      primary: { type: "node", id: "boxed-node" },
    }

    expect(selectionForGestureChange({ base }, true, boxed)).toEqual({
      nodeIDs: ["existing-node", "boxed-node"],
      edgeIDs: [],
      primary: { type: "node", id: "boxed-node" },
    })
  })

  test("treats shift, ctrl, and meta as additive selection modifiers", () => {
    expect(hasAdditiveSelectionModifier({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe(true)
    expect(hasAdditiveSelectionModifier({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe(true)
    expect(hasAdditiveSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe(true)
    expect(hasAdditiveSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false)
  })

  test("keeps an additive drag-box gesture latched after modifier keyup", () => {
    const gesture = { base: { nodeIDs: ["existing-node"], edgeIDs: [] } }

    expect(
      additiveSelectionModifierAfterKeyboardChange(
        { shiftKey: false, ctrlKey: false, metaKey: false },
        gesture,
        true,
      ),
    ).toBe(true)
  })

  test("clears the additive modifier after keyup when no drag-box gesture is active", () => {
    expect(
      additiveSelectionModifierAfterKeyboardChange(
        { shiftKey: false, ctrlKey: false, metaKey: false },
        undefined,
        true,
      ),
    ).toBe(false)
  })
})
