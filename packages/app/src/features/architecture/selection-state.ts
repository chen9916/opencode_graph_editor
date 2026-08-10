export type Selection = {
  readonly nodeIDs: ReadonlyArray<string>
  readonly edgeIDs: ReadonlyArray<string>
  readonly primary?: { readonly type: "node" | "edge"; readonly id: string }
}
export type SelectionGesture = { readonly base: Selection }
export type SelectionModifierState = {
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

export function hasAdditiveSelectionModifier(input: SelectionModifierState) {
  return input.shiftKey || input.ctrlKey || input.metaKey
}

export function additiveSelectionModifierAfterKeyboardChange(
  input: SelectionModifierState,
  gesture: SelectionGesture | undefined,
  current: boolean,
) {
  if (hasAdditiveSelectionModifier(input)) return true
  if (gesture) return current
  return false
}

export function selectionForGestureChange(
  gesture: SelectionGesture | undefined,
  modifierActive: boolean,
  next: Selection,
): Selection {
  if (!gesture || !modifierActive) return next
  return mergeSelection(gesture.base, next)
}

export function selectedNodesForContextDelete(target: { readonly type: "node"; readonly id: string }, current: Selection) {
  const nodeIDs = current.nodeIDs.includes(target.id) ? current.nodeIDs : [target.id]
  return { nodeIDs, edgeIDs: [], primary: target } satisfies Selection
}

export function mergeSelection(base: Selection, next: Selection): Selection {
  const nodeIDs = mergeIDs(base.nodeIDs, next.nodeIDs)
  const edgeIDs = mergeIDs(base.edgeIDs, next.edgeIDs)
  const primary = next.primary ?? base.primary
  return primary ? { nodeIDs, edgeIDs, primary } : { nodeIDs, edgeIDs }
}

function mergeIDs(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  const seen = new Set<string>()
  return [...left, ...right].filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
