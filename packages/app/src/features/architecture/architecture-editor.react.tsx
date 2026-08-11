/** @jsxImportSource react */

import "@xyflow/react/dist/style.css"
import "./architecture.css"

import {
  Background,
  ConnectionMode,
  Controls,
  type FinalConnectionState,
  MiniMap,
  ReactFlow,
  SelectionMode,
  type Connection,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type XYPosition,
  useEdgesState,
  useNodesState,
  useStoreApi,
  useUpdateNodeInternals,
} from "@xyflow/react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureInstanceChange,
  ArchitectureNode,
  ArchitectureOperation,
  ArchitecturePanelProps,
  ArchitectureResource,
  ArchitectureSelectionPrompt,
  ArchitectureViewport,
} from "./contract"
import { architectureCommandMatches } from "./commands"
import {
  architectureEditedNodeHintsForResourceSync,
  architectureResourceHintKey,
  clearArchitectureEditedNodeHint,
  filterArchitectureEditedNodeHints,
} from "./edit-hint"
import {
  architectureEditorPendingOperations,
  architectureEditorLiveInstanceKey,
  architectureInstanceChange,
  commitArchitectureEditorHistory,
  createArchitectureEditorHistory,
  redoArchitectureEditorHistory,
  syncArchitectureEditorHistorySource,
  undoArchitectureEditorHistory,
} from "./editor-state"
import { operationID } from "./journal"
import { tagColorsKey, toReactFlow, type ArchitectureFlowEdge, type ArchitectureFlowNode } from "./model"
import { architectureInstanceIsDirty } from "./resource-state"
import { ArchitectureEdgeView } from "./architecture-edge.react"
import { ArchitectureNodeView } from "./architecture-node.react"
import {
  additiveSelectionModifierAfterKeyboardChange,
  hasAdditiveSelectionModifier,
  selectionForGestureChange,
  selectedNodesForContextDelete,
  type Selection,
  type SelectionGesture,
} from "./selection-state"

const nodeTypes = { architecture: ArchitectureNodeView }
const edgeTypes = { architecture: ArchitectureEdgeView }
const connectionSides = ["top", "right", "bottom", "left"] as const satisfies ReadonlyArray<ArchitectureConnectionSide>

type SingleSelection = { readonly type: "node" | "edge"; readonly id: string }
type ContextMenu =
  | { readonly type: "pane"; readonly x: number; readonly y: number; readonly position: XYPosition }
  | {
      readonly type: "node" | "edge"
      readonly id: string
      readonly x: number
      readonly y: number
      readonly selection: Selection
    }
type AskPopover = {
  readonly x: number
  readonly y: number
  readonly selection: Selection
  readonly text: string
}
type ViewportMotion = {
  readonly active: boolean
  readonly last?: { readonly viewport: ArchitectureViewport; readonly time: number }
  readonly velocity: XYPosition
  readonly inertia?: number
}

const emptySelection: Selection = { nodeIDs: [], edgeIDs: [] }

export function ArchitectureEditor(props: ArchitecturePanelProps) {
  const base = props.pending?.base ?? props.snapshot
  const initial = props.pending?.operations ?? []
  const historyOrigin = props.pending?.origin ?? base
  const historySource = props.pending?.journalBase ?? base.resource
  const liveInstanceKey = architectureEditorLiveInstanceKey({ base, liveInstanceVersion: props.liveInstanceVersion })
  const loadedResourceID = useRef(base.resource.id)
  const canvas = useRef<HTMLDivElement>(null)
  const visibleViewport = useRef<ArchitectureViewport | undefined>(props.viewport)
  const viewportMotion = useRef<ViewportMotion>({ active: false, velocity: { x: 0, y: 0 } })
  const reconnectedEdgeIDs = useRef(new Set<string>())
  const locallyAuthoredResourceKeys = useRef(new Set<string>())
  const selectionRef = useRef<Selection>(emptySelection)
  const pendingSelection = useRef<Selection>()
  const latestChange = useRef<ArchitectureInstanceChange>()
  const selectionGesture = useRef<SelectionGesture>()
  const additiveSelectionModifier = useRef(false)
  const handledAction = useRef<number>()
  const suppressEmptySelectionUntil = useRef(0)
  const connecting = useRef(false)
  const outlineID = useId()
  const inspectorID = useId()
  const [editor, setEditor] = useState(() => createArchitectureEditorHistory(historySource, initial))
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [flow, setFlow] = useState<ReactFlowInstance<ArchitectureFlowNode, ArchitectureFlowEdge>>()
  const [filter, setFilter] = useState({ text: "", tag: "" })
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu>()
  const [askPopover, setAskPopover] = useState<AskPopover>()
  const [editedHintNodeIDs, setEditedHintNodeIDs] = useState<ReadonlyArray<string>>([])
  const operations = architectureEditorPendingOperations(editor)
  latestChange.current = architectureInstanceChange(
    editor.resource,
    operations,
    base,
    historyOrigin,
    props.pending?.conflicts ?? [],
    props.server,
    props.directory,
  )
  const dirty = architectureInstanceIsDirty({ pending: props.pending, operations })
  const tags = unique(editor.resource.nodes.flatMap((node) => node.tags))
  const controlsPosition = props.direction === "rtl" ? "bottom-right" : "bottom-left"
  const minimapPosition = props.direction === "rtl" ? "top-left" : "top-right"
  const visibleNodes = editor.resource.nodes.filter((node) => nodeMatchesFilter(node, filter))
  const hasSelection = selection.nodeIDs.length > 0 || selection.edgeIDs.length > 0
  const filterActive = !!filter.text || !!filter.tag
  const nodeIDsKey = editor.resource.nodes.map((node) => node.id).join(",")
  const nodeInternalsKey = editor.resource.nodes
    .map((node) => [node.id, node.layout.position.x, node.layout.position.y, node.text, ...node.tags].join("\u001f"))
    .join("\u001e")
  const resourceTagColorsKey = tagColorsKey(editor.resource.tagColors)
  const editedHintNodeIDsKey = editedHintNodeIDs.join(",")

  useLayoutEffect(() => {
    const resourceChanged = loadedResourceID.current !== base.resource.id
    loadedResourceID.current = base.resource.id
    locallyAuthoredResourceKeys.current.clear()
    const next = syncArchitectureEditorHistorySource(editor, historySource, initial)
    setEditor(next)
    latestChange.current = architectureInstanceChange(
      next.resource,
      architectureEditorPendingOperations(next),
      base,
      historyOrigin,
      props.pending?.conflicts ?? [],
      props.server,
      props.directory,
    )
    setEditedHintNodeIDs([])
    resetTransientLoadState({ closePanels: resourceChanged })
  }, [liveInstanceKey])

  const keepExistingEditedNodeHints = (resource: ArchitectureResource) => {
    setEditedHintNodeIDs((current) =>
      filterArchitectureEditedNodeHints(
        current,
        resource.nodes.map((node) => node.id),
      ),
    )
  }

  const rememberLocalResource = (resource: ArchitectureResource) => {
    locallyAuthoredResourceKeys.current.add(architectureResourceHintKey(resource))
    if (locallyAuthoredResourceKeys.current.size <= 12) return
    const oldest = locallyAuthoredResourceKeys.current.values().next().value
    if (oldest) locallyAuthoredResourceKeys.current.delete(oldest)
  }

  const clearEditedNodeHint = (nodeID: string) => {
    setEditedHintNodeIDs((current) => clearArchitectureEditedNodeHint(current, nodeID))
  }

  const resetTransientLoadState = (input: { readonly closePanels: boolean }) => {
    cancelViewportInertia(viewportMotion.current)
    viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
    reconnectedEdgeIDs.current.clear()
    pendingSelection.current = undefined
    selectionGesture.current = undefined
    additiveSelectionModifier.current = false
    suppressEmptySelectionUntil.current = 0
    connecting.current = false
    applySelection(emptySelection)
    setContextMenu(undefined)
    setAskPopover(undefined)
    if (!input.closePanels) return
    setOutlineOpen(false)
    setInspectorOpen(false)
  }

  const commit = (batch: ReadonlyArray<ArchitectureOperation>) => {
    if (batch.length === 0) return
    const next = commitArchitectureEditorHistory(editor, batch)
    rememberLocalResource(next.resource)
    setEditor(next)
    keepExistingEditedNodeHints(next.resource)
    latestChange.current = architectureInstanceChange(
      next.resource,
      architectureEditorPendingOperations(next),
      base,
      historyOrigin,
      props.pending?.conflicts ?? [],
      props.server,
      props.directory,
    )
    props.onJournal(latestChange.current)
  }

  const updateNodeText = (node: ArchitectureNode, text: string) => {
    if (text === node.text) return
    commit([{ id: operationID(), type: "node.update", node: { ...node, text } }])
  }

  const projected = toReactFlow(editor.resource, updateNodeText, {
    label: props.labels.connectionStyle,
    styles: {
      rectangular: props.labels.rectangular,
      curved: props.labels.curved,
      straight: props.labels.straight,
    },
    onChange: (edgeID, style) => changeEdgeStyle(edgeID, style),
  })
  const [nodes, setNodes, onNodesChange] = useNodesState(projected.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(projected.edges)

  const changeEdgeStyle = (edgeID: string, style: ArchitectureEdgeStyle) => {
    const edge = editor.resource.edges.find((candidate) => candidate.id === edgeID)
    if (!edge || (edge.style ?? "rectangular") === style) return
    commit([{ id: operationID(), type: "edge.update", edge: { ...edge, style } }])
  }

  const applySelection = (selected: Selection) => {
    selectionRef.current = selected
    setSelection((current) => (sameSelection(current, selected) ? current : selected))
    setNodes((current) => applyNodeSelection(current, selected))
    setEdges((current) => applyEdgeSelection(current, selected))
  }

  const replaceFlowElements = (resource: ArchitectureResource) => {
    const next = toReactFlow(resource, updateNodeText, {
      label: props.labels.connectionStyle,
      styles: {
        rectangular: props.labels.rectangular,
        curved: props.labels.curved,
        straight: props.labels.straight,
      },
      onChange: (edgeID, style) => changeEdgeStyle(edgeID, style),
    })
    const visible = new Set(resource.nodes.filter((node) => nodeMatchesFilter(node, filter)).map((node) => node.id))
    const editedHints = new Set(editedHintNodeIDs)
    const selected = selectionInResource(pendingSelection.current ?? selectionRef.current, resource)
    pendingSelection.current = undefined
    selectionRef.current = selected
    setSelection((current) => (sameSelection(current, selected) ? current : selected))
    setNodes(
      next.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          dimmed: filterActive && !visible.has(node.id),
          editedHint: editedHints.has(node.id),
          onEditedHintSeen: clearEditedNodeHint,
        },
        selected: selected.nodeIDs.includes(node.id),
      })),
    )
    setEdges(
      next.edges.map((edge) => {
        const dimmed = filterActive && (!visible.has(edge.source) || !visible.has(edge.target))
        return {
          ...edge,
          data: edge.data ? { ...edge.data, dimmed } : edge.data,
          selected: selected.edgeIDs.includes(edge.id),
        }
      }),
    )
  }

  const select = (next: SingleSelection | undefined) => {
    const selected = selectionFromSingle(next)
    pendingSelection.current = selected
    if (next) suppressEmptySelectionUntil.current = performanceNow() + 220
    applySelection(selected)
  }

  const clearSelectionGesture = () => {
    selectionGesture.current = undefined
    additiveSelectionModifier.current = false
  }

  const clearSelectionGestureAfterReactFlow = () => queueMicrotask(clearSelectionGesture)

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".architecture-editor__context-menu, .architecture-editor__ask-popover, .architecture-editor__wire-toolbar",
        )
      )
        return
      setContextMenu(undefined)
      setAskPopover(undefined)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setContextMenu(undefined)
      setAskPopover(undefined)
    }
    document.addEventListener("pointerdown", pointer)
    document.addEventListener("keydown", keyboard)
    return () => {
      document.removeEventListener("pointerdown", pointer)
      document.removeEventListener("keydown", keyboard)
    }
  }, [])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      additiveSelectionModifier.current = additiveSelectionModifierAfterKeyboardChange(
        event,
        selectionGesture.current,
        additiveSelectionModifier.current,
      )
    }
    window.addEventListener("keydown", keyboard)
    window.addEventListener("keyup", keyboard)
    window.addEventListener("pointerup", clearSelectionGestureAfterReactFlow)
    window.addEventListener("pointercancel", clearSelectionGestureAfterReactFlow)
    window.addEventListener("blur", clearSelectionGestureAfterReactFlow)
    return () => {
      window.removeEventListener("keydown", keyboard)
      window.removeEventListener("keyup", keyboard)
      window.removeEventListener("pointerup", clearSelectionGestureAfterReactFlow)
      window.removeEventListener("pointercancel", clearSelectionGestureAfterReactFlow)
      window.removeEventListener("blur", clearSelectionGestureAfterReactFlow)
    }
  }, [])

  useEffect(() => () => cancelViewportInertia(viewportMotion.current), [])

  useLayoutEffect(() => {
    replaceFlowElements(editor.resource)
  }, [editor.resource, filter.tag, filter.text, filterActive, resourceTagColorsKey, editedHintNodeIDsKey, setEdges, setNodes])

  const undo = () => {
    const next = undoArchitectureEditorHistory(editor)
    if (next === editor) return
    rememberLocalResource(next.resource)
    setEditor(next)
    keepExistingEditedNodeHints(next.resource)
    latestChange.current = architectureInstanceChange(
      next.resource,
      architectureEditorPendingOperations(next),
      base,
      historyOrigin,
      props.pending?.conflicts ?? [],
      props.server,
      props.directory,
    )
    props.onJournal(latestChange.current)
  }

  const redo = () => {
    const next = redoArchitectureEditorHistory(editor)
    if (next === editor) return
    rememberLocalResource(next.resource)
    setEditor(next)
    keepExistingEditedNodeHints(next.resource)
    latestChange.current = architectureInstanceChange(
      next.resource,
      architectureEditorPendingOperations(next),
      base,
      historyOrigin,
      props.pending?.conflicts ?? [],
      props.server,
      props.directory,
    )
    props.onJournal(latestChange.current)
  }

  const addNode = (position?: XYPosition) => {
    const id = `node_${Date.now().toString(36)}`
    const node: ArchitectureNode = {
      id,
      text: "New node",
      tags: [],
      layout: {
        position: {
          x: position?.x ?? (editor.resource.nodes.length % 4) * 260,
          y: position?.y ?? Math.floor(editor.resource.nodes.length / 4) * 170,
        },
      },
    }
    commit([{ id: operationID(), type: "node.create", node }])
    select({ type: "node", id })
    setContextMenu(undefined)
  }

  const duplicateNode = (nodeID: string) => {
    const current = editor.resource.nodes.find((node) => node.id === nodeID)
    if (!current) return
    const id = `node_${Date.now().toString(36)}`
    commit([
      {
        id: operationID(),
        type: "node.create",
        node: {
          ...current,
          id,
          layout: { position: { x: current.layout.position.x + 36, y: current.layout.position.y + 36 } },
        },
      },
    ])
    select({ type: "node", id })
    setContextMenu(undefined)
  }

  const removeSelection = (target?: SingleSelection) => {
    if (!target && selection.nodeIDs.length === 1 && selection.edgeIDs.length === 0) {
      removeSelection({ type: "node", id: selection.nodeIDs[0]! })
      return
    }
    if (!target && selection.edgeIDs.length === 1 && selection.nodeIDs.length === 0) {
      removeSelection({ type: "edge", id: selection.edgeIDs[0]! })
      return
    }
    if (target?.type === "node") {
      props.onConfirm(props.labels.deleteNodeConfirm, props.labels.delete, () => {
        commit([{ id: operationID(), type: "node.remove", nodeID: target.id, cascade: true }])
        select(undefined)
        setContextMenu(undefined)
      })
      return
    }
    if (target?.type === "edge") {
      props.onConfirm(props.labels.deleteEdgeConfirm, props.labels.delete, () => {
        commit([{ id: operationID(), type: "edge.remove", edgeID: target.id }])
        select(undefined)
        setContextMenu(undefined)
      })
      return
    }
    if (!hasSelection) return
    removeSelectedItems(selection, props.labels.deleteSelectionConfirm)
  }

  const removeNodeContextSelection = (menu: { readonly id: string; readonly selection: Selection }) => {
    const selected = selectedNodesForContextDelete({ type: "node", id: menu.id }, menu.selection)
    if (selected.nodeIDs.length === 1) {
      removeSelection({ type: "node", id: selected.nodeIDs[0]! })
      return
    }
    removeSelectedItems(selected, props.labels.deleteSelectionConfirm)
  }

  const removeSelectedItems = (selected: Selection, confirmation: string) => {
    const selectedNodeIDs = new Set(selected.nodeIDs)
    const cascadedEdgeIDs = editor.resource.edges
      .filter((edge) => selectedNodeIDs.has(edge.source) || selectedNodeIDs.has(edge.target))
      .map((edge) => edge.id)
    const operations: ReadonlyArray<ArchitectureOperation> = [
      ...selected.nodeIDs.map(
        (nodeID): ArchitectureOperation => ({ id: operationID(), type: "node.remove", nodeID, cascade: true }),
      ),
      ...selected.edgeIDs
        .filter((edgeID) => !cascadedEdgeIDs.includes(edgeID))
        .map((edgeID): ArchitectureOperation => ({ id: operationID(), type: "edge.remove", edgeID })),
    ]
    props.onConfirm(confirmation, props.labels.delete, () => {
      commit(operations)
      select(undefined)
      setContextMenu(undefined)
    })
  }

  useEffect(() => {
    const action = props.action
    if (!action) return
    if (
      !architectureCommandMatches(action, {
        server: props.server,
        directory: props.directory,
        resourceID: base.resource.id,
      }) ||
      handledAction.current === action.id
    )
      return
    handledAction.current = action.id
    if (action.type === "save") props.onSave(latestChange.current!)
    if (action.type === "reload") props.onReload()
    if (action.type === "fitView") fitSelection()
    if (action.type === "addNode") addNode()
    if (action.type === "undo") undo()
    if (action.type === "redo") redo()
    if (action.type === "delete") removeSelection()
    if (action.type === "exportPatch") props.onExport(operations)
    if (action.type === "exportResource") props.onExportResource(editor.resource)
    if (action.type === "duplicateResource") props.onDuplicate(latestChange.current!)
  }, [
    props.action?.id,
    props.action?.server,
    props.action?.directory,
    props.action?.resourceID,
    props.server,
    props.directory,
    base.resource.id,
  ])

  const onSelectionChange = (change: OnSelectionChangeParams<ArchitectureFlowNode, ArchitectureFlowEdge>) => {
    const next = selectionFromChange(change)
    if (isEmptySelection(next) && (connecting.current || performanceNow() < suppressEmptySelectionUntil.current)) return
    if (selectionGesture.current && !additiveSelectionModifier.current) selectionGesture.current = undefined
    applySelection(selectionForGestureChange(selectionGesture.current, additiveSelectionModifier.current, next))
  }

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edge: ArchitectureEdge = {
      id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connectionSide(connection.sourceHandle, "right"),
      targetHandle: connectionSide(connection.targetHandle, "left"),
      style: "rectangular",
    }
    commit([{ id: operationID(), type: "edge.create", edge }])
    select({ type: "edge", id: edge.id })
  }

  const menuPosition = (x: number, y: number) => ({
    x: Math.max(
      8,
      Math.min(x - (canvas.current?.getBoundingClientRect().left ?? 0), (canvas.current?.clientWidth ?? 216) - 208),
    ),
    y: Math.max(
      8,
      Math.min(y - (canvas.current?.getBoundingClientRect().top ?? 0), (canvas.current?.clientHeight ?? 252) - 244),
    ),
  })

  const askPosition = (menu: ContextMenu) => ({
    x: Math.max(8, Math.min(menu.x + 208, (canvas.current?.clientWidth ?? 316) - 316)),
    y: Math.max(8, Math.min(menu.y, (canvas.current?.clientHeight ?? 244) - 236)),
  })

  const openAskPopover = (menu: Extract<ContextMenu, { readonly type: "node" | "edge" }>) => {
    setAskPopover({ ...askPosition(menu), selection: menu.selection, text: "" })
    setContextMenu(undefined)
  }

  const sendAskSelection = () => {
    if (!askPopover) return
    const text = askPopover.text.trim()
    if (!text) return
    props.onAskSelection?.(selectionPrompt(editor.resource, askPopover.selection, text))
    setAskPopover(undefined)
  }

  const reconnect = (edgeID: string, connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edge = editor.resource.edges.find((candidate) => candidate.id === edgeID)
    if (!edge) return
    reconnectedEdgeIDs.current.add(edgeID)
    commit([
      {
        id: operationID(),
        type: "edge.update",
        edge: {
          ...edge,
          source: connection.source,
          target: connection.target,
          sourceHandle: connectionSide(connection.sourceHandle, edge.sourceHandle ?? "right"),
          targetHandle: connectionSide(connection.targetHandle, edge.targetHandle ?? "left"),
        },
      },
    ])
  }

  const disconnect = (edgeID: string) => {
    if (!editor.resource.edges.some((edge) => edge.id === edgeID)) return
    commit([{ id: operationID(), type: "edge.remove", edgeID }])
    select(undefined)
    setContextMenu(undefined)
  }

  const commitNodePositions = (
    nodeIDs: ReadonlyArray<string>,
    movedNodes: ReadonlyArray<ArchitectureFlowNode> = flow?.getNodes() ?? nodes,
  ) => {
    const operations = nodeIDs.flatMap((nodeID): ArchitectureOperation[] => {
      const moved = movedNodes.find((node) => node.id === nodeID)
      const current = editor.resource.nodes.find((node) => node.id === nodeID)
      if (!moved || !current || samePosition(moved.position, current.layout.position)) return []
      return [{ id: operationID(), type: "node.position", nodeID, position: moved.position }]
    })
    commit(operations)
  }

  const fitSelection = () => {
    if (selection.nodeIDs.length === 0) {
      void flow?.fitView({ padding: 0.15, duration: 180 })
      return
    }
    void flow?.fitView({
      padding: 0.22,
      duration: 200,
      nodes: selection.nodeIDs.map((id) => ({ id })),
    })
  }

  const startViewportMove = (event: MouseEvent | TouchEvent | null) => {
    cancelViewportInertia(viewportMotion.current)
    if (!isViewportPanStartEvent(event)) {
      viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
      return
    }
    viewportMotion.current = {
      active: true,
      velocity: { x: 0, y: 0 },
    }
  }

  const trackViewportMove = (event: MouseEvent | TouchEvent | null, viewport: ArchitectureViewport) => {
    visibleViewport.current = viewport
    if (!viewportMotion.current.active || !isViewportMotionEvent(event)) return
    const time = performance.now()
    const last = viewportMotion.current.last
    const nextVelocity = last
      ? {
          x: (viewport.x - last.viewport.x) / Math.max(16, time - last.time),
          y: (viewport.y - last.viewport.y) / Math.max(16, time - last.time),
        }
      : { x: 0, y: 0 }
    const velocity = {
      x: viewportMotion.current.velocity.x * 0.35 + nextVelocity.x * 0.65,
      y: viewportMotion.current.velocity.y * 0.35 + nextVelocity.y * 0.65,
    }
    viewportMotion.current = { active: true, last: { viewport, time }, velocity }
  }

  const finishViewportMove = (event: MouseEvent | TouchEvent | null, viewport: ArchitectureViewport) => {
    visibleViewport.current = viewport
    props.onViewport({
      server: props.server,
      directory: props.directory,
      resourceID: base.resource.id,
      viewport,
    })
    const motion = viewportMotion.current
    viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
    if (!flow || !motion.active || !isViewportMotionEvent(event)) return
    const speed = Math.hypot(motion.velocity.x, motion.velocity.y)
    if (speed < 0.04) return
    glideViewport(viewport, {
      x: clamp(motion.velocity.x, -2.8, 2.8),
      y: clamp(motion.velocity.y, -2.8, 2.8),
    })
  }

  const glideViewport = (start: ArchitectureViewport, velocity: XYPosition) => {
    if (!flow || typeof requestAnimationFrame !== "function") return
    const started = performance.now()
    let last = started
    let current = start
    let momentum = velocity
    const step = (time: number) => {
      const elapsed = time - started
      const delta = Math.min(24, time - last)
      last = time
      current = {
        x: current.x + momentum.x * delta,
        y: current.y + momentum.y * delta,
        zoom: current.zoom,
      }
      visibleViewport.current = current
      momentum = {
        x: momentum.x * Math.exp(-delta / 150),
        y: momentum.y * Math.exp(-delta / 150),
      }
      void flow.setViewport(current)
      if (Math.hypot(momentum.x, momentum.y) < 0.025 || elapsed > 420) {
        viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
        props.onViewport({
          server: props.server,
          directory: props.directory,
          resourceID: base.resource.id,
          viewport: current,
        })
        return
      }
      viewportMotion.current = {
        active: false,
        velocity: momentum,
        inertia: requestAnimationFrame(step),
      }
    }
    viewportMotion.current = {
      active: false,
      velocity,
      inertia: requestAnimationFrame(step),
    }
  }

  const selected =
    selection.primary?.type === "node"
      ? editor.resource.nodes.find((node) => node.id === selection.primary?.id)
      : selection.primary?.type === "edge"
        ? editor.resource.edges.find((edge) => edge.id === selection.primary?.id)
        : undefined

  return (
    <div
      className="architecture-editor"
      dir={props.direction}
      data-prevent-session-autofocus
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        cancelViewportInertia(viewportMotion.current)
        if (!(event.target instanceof Element)) return
        if (event.target.closest("button, input, textarea, select, [contenteditable='true']")) return
        event.currentTarget.focus({ preventScroll: true })
      }}
    >
      <div className="architecture-editor__body" dir="ltr">
        <button
          type="button"
          className="architecture-editor__side-toggle architecture-editor__side-toggle--outline"
          data-open={outlineOpen || undefined}
          data-active={filterActive || undefined}
          aria-expanded={outlineOpen}
          aria-controls={outlineID}
          aria-label={props.labels.outlineTitle}
          title={props.labels.outlineTitle}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <span aria-hidden="true" />
        </button>
        <button
          type="button"
          className="architecture-editor__side-toggle architecture-editor__side-toggle--inspector"
          data-open={inspectorOpen || undefined}
          aria-expanded={inspectorOpen}
          aria-controls={inspectorID}
          aria-label={props.labels.properties}
          title={props.labels.properties}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          <span aria-hidden="true" />
        </button>
        {outlineOpen && (
          <aside
            id={outlineID}
            className="architecture-editor__outline"
            aria-label={props.labels.outlineTitle}
            dir={props.direction}
          >
            <div className="architecture-editor__panel-heading">
              <strong>{props.labels.outlineTitle}</strong>
              <button type="button" aria-label={props.labels.outlineTitle} onClick={() => setOutlineOpen(false)}>
                ×
              </button>
            </div>
            <div className="architecture-editor__outline-filter">
              <input
                data-prevent-session-autofocus
                aria-label={props.labels.search}
                placeholder={props.labels.search}
                value={filter.text}
                onChange={(event) => setFilter({ ...filter, text: event.currentTarget.value })}
              />
              <div>
                <select
                  aria-label={props.labels.tags}
                  value={filter.tag}
                  onChange={(event) => setFilter({ ...filter, tag: event.currentTarget.value })}
                >
                  <option value="">{props.labels.allTags}</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setFilter({ text: "", tag: "" })} disabled={!filterActive}>
                  {props.labels.clearFilters}
                </button>
              </div>
            </div>
            <ul>
              {visibleNodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className={selection.nodeIDs.includes(node.id) ? "is-selected" : undefined}
                    onClick={() => {
                      select({ type: "node", id: node.id })
                      setContextMenu(undefined)
                      void flow?.setCenter(node.layout.position.x, node.layout.position.y, {
                        zoom: 1,
                        duration: 200,
                      })
                    }}
                  >
                    <bdi>{node.text.split("\n")[0]}</bdi>
                    <span>{node.tags.join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <div
          ref={canvas}
          className="architecture-editor__canvas"
          dir="ltr"
          onContextMenu={(event) => {
            if (event.defaultPrevented || !flow) return
            event.preventDefault()
            const at = menuPosition(event.clientX, event.clientY)
            select(undefined)
            setAskPopover(undefined)
            setContextMenu({
              type: "pane",
              ...at,
              position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            })
          }}
        >
          <ReactFlow<ArchitectureFlowNode, ArchitectureFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onSelectionStart={(event) => {
              additiveSelectionModifier.current = hasAdditiveSelectionModifier(event)
              selectionGesture.current = additiveSelectionModifier.current ? { base: selectionRef.current } : undefined
            }}
            onSelectionEnd={clearSelectionGestureAfterReactFlow}
            onConnectStart={() => {
              connecting.current = true
              suppressEmptySelectionUntil.current = performanceNow() + 220
            }}
            onConnectEnd={() => {
              connecting.current = false
              suppressEmptySelectionUntil.current = performanceNow() + 120
            }}
            onConnect={onConnect}
            onPaneClick={() => {
              select(undefined)
              setContextMenu(undefined)
              setAskPopover(undefined)
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              if (!flow) return
              const at = menuPosition(event.clientX, event.clientY)
              select(undefined)
              setAskPopover(undefined)
              setContextMenu({
                type: "pane",
                ...at,
                position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              })
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              const at = menuPosition(event.clientX, event.clientY)
              const next = selectionForContextTarget({ type: "node", id: node.id }, selectionRef.current)
              pendingSelection.current = next
              suppressEmptySelectionUntil.current = performanceNow() + 220
              applySelection(next)
              setAskPopover(undefined)
              setContextMenu({ type: "node", id: node.id, selection: next, ...at })
            }}
            onNodeClick={(event, node) => {
              event.stopPropagation()
              if (event.shiftKey) {
                const next = selectionWithNode({ type: "node", id: node.id }, selectionRef.current)
                pendingSelection.current = next
                suppressEmptySelectionUntil.current = performanceNow() + 220
                applySelection(next)
              } else if (!event.ctrlKey && !event.metaKey) {
                select({ type: "node", id: node.id })
              }
              setContextMenu(undefined)
              setAskPopover(undefined)
            }}
            onEdgeClick={(event, edge) => {
              event.stopPropagation()
              select({ type: "edge", id: edge.id })
              setContextMenu(undefined)
              setAskPopover(undefined)
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault()
              const at = menuPosition(event.clientX, event.clientY)
              const next = selectionForContextTarget({ type: "edge", id: edge.id }, selectionRef.current)
              pendingSelection.current = next
              suppressEmptySelectionUntil.current = performanceNow() + 220
              applySelection(next)
              setAskPopover(undefined)
              setContextMenu({ type: "edge", id: edge.id, selection: next, ...at })
            }}
            onReconnect={(edge, connection) => reconnect(edge.id, connection)}
            onReconnectEnd={(_event, edge, _handle, connection) => {
              if (reconnectedEdgeIDs.current.delete(edge.id)) return
              if (!connectionEndedDisconnected(connection)) return
              disconnect(edge.id)
            }}
            onNodeDragStop={(_event, node, draggedNodes) =>
              commitNodePositions(
                draggedNodes.length > 1
                  ? draggedNodes.map((dragged) => dragged.id)
                  : selection.nodeIDs.includes(node.id)
                    ? selection.nodeIDs
                    : [node.id],
                draggedNodes.length > 1 ? draggedNodes : (flow?.getNodes() ?? [node]),
              )
            }
            onInit={setFlow}
            onMoveStart={startViewportMove}
            onMove={trackViewportMove}
            onMoveEnd={finishViewportMove}
            defaultViewport={visibleViewport.current ?? props.viewport}
            connectionMode={ConnectionMode.Loose}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={["Shift", "Control", "Meta"]}
            deleteKeyCode="none"
            elementsSelectable
            elevateEdgesOnSelect
            nodesConnectable
            nodesDraggable
            edgesReconnectable
            fitView={!visibleViewport.current && !props.viewport}
            proOptions={{ hideAttribution: true }}
          >
            <SelectionLassoCleanup />
            <NodeInternalsRefresh nodeIDs={nodeIDsKey} refreshKey={`${nodeInternalsKey}\u001e${resourceTagColorsKey}`} />
            <Background />
            <Controls position={controlsPosition} />
            {!props.mobile && <MiniMap position={minimapPosition} pannable zoomable />}
          </ReactFlow>
          {(dirty || hasSelection) && (
            <div className="architecture-editor__canvas-status" dir={props.direction}>
              {dirty && <span>{props.labels.dirty}</span>}
              {hasSelection && (
                <span>{props.labels.selectedItems(selection.nodeIDs.length, selection.edgeIDs.length)}</span>
              )}
            </div>
          )}
          {contextMenu && (
            <div
              className="architecture-editor__context-menu"
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              dir={props.direction}
              onContextMenu={(event) => event.preventDefault()}
            >
              {contextMenu.type === "pane" && (
                <>
                  <button type="button" role="menuitem" onClick={() => addNode(contextMenu.position)}>
                    {props.labels.addNode}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(undefined)
                      void flow?.fitView({ padding: 0.15 })
                    }}
                  >
                    {props.labels.fitView}
                  </button>
                </>
              )}
              {contextMenu.type === "node" && (
                <>
                  <button type="button" role="menuitem" onClick={() => openAskPopover(contextMenu)}>
                    {props.labels.askSelection}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setInspectorOpen(true)
                      setContextMenu(undefined)
                    }}
                  >
                    {props.labels.properties}
                  </button>
                  <button type="button" role="menuitem" onClick={() => duplicateNode(contextMenu.id)}>
                    {props.labels.duplicate}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="architecture-editor__danger"
                    onClick={() => removeNodeContextSelection(contextMenu)}
                  >
                    {props.labels.delete}
                  </button>
                </>
              )}
              {contextMenu.type === "edge" && (
                <>
                  <button type="button" role="menuitem" onClick={() => openAskPopover(contextMenu)}>
                    {props.labels.askSelection}
                  </button>
                  <EdgeStyleControls
                    labels={props.labels}
                    style={
                      editor.resource.edges.find((edge) => edge.id === contextMenu.id)?.style ?? "rectangular"
                    }
                    onChange={(style) => changeEdgeStyle(contextMenu.id, style)}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    className="architecture-editor__danger"
                    onClick={() => removeSelection({ type: "edge", id: contextMenu.id })}
                  >
                    {props.labels.delete}
                  </button>
                </>
              )}
            </div>
          )}
          {askPopover && (
            <form
              className="architecture-editor__ask-popover"
              style={{ left: askPopover.x, top: askPopover.y }}
              dir={props.direction}
              onSubmit={(event) => {
                event.preventDefault()
                sendAskSelection()
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="architecture-editor__ask-title">
                {props.labels.selectedItems(askPopover.selection.nodeIDs.length, askPopover.selection.edgeIDs.length)}
              </div>
              <div className="architecture-editor__ask-context-indicator">
                {props.labels.askSelectionContextAttached}
              </div>
              <textarea
                data-prevent-session-autofocus
                autoFocus
                aria-label={props.labels.askSelectionLabel}
                value={askPopover.text}
                placeholder={props.labels.askSelectionPlaceholder}
                onChange={(event) => setAskPopover({ ...askPopover, text: event.currentTarget.value })}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendAskSelection()
                }}
              />
              <div className="architecture-editor__ask-actions">
                <button type="button" onClick={() => setAskPopover(undefined)}>
                  {props.labels.cancel}
                </button>
                <button type="submit" disabled={!askPopover.text.trim()}>
                  {props.labels.send}
                </button>
              </div>
            </form>
          )}
        </div>
        {inspectorOpen && (
          <aside
            id={inspectorID}
            className="architecture-editor__inspector"
            aria-label={props.labels.inspectorTitle}
            dir={props.direction}
          >
            <div className="architecture-editor__panel-heading">
              <strong>{props.labels.properties}</strong>
              <button type="button" aria-label={props.labels.properties} onClick={() => setInspectorOpen(false)}>
                ×
              </button>
            </div>
            <Inspector
              key={
                selection.primary
                  ? `${selection.primary.type}:${selection.primary.id}`
                  : `${selection.nodeIDs.join(":")}|${selection.edgeIDs.join(":")}`
              }
              resource={editor.resource}
              selection={selection}
              selected={selected}
              labels={props.labels}
              onEdgeStyle={changeEdgeStyle}
              onCommit={commit}
            />
            {(props.pending?.conflicts.length ?? 0) > 0 && (
              <section className="architecture-editor__conflicts">
                <h3>{props.labels.conflicts}</h3>
                <ul>
                  {props.pending?.conflicts.map((conflict) => (
                    <li key={conflict.operation.id}>
                      <bdi>{conflict.operation.id}</bdi>: {props.labels.conflictReasons[conflict.reason]}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <RuntimeDebugView runtimeView={props.runtimeView} labels={props.labels} />
          </aside>
        )}
      </div>
    </div>
  )
}

function RuntimeDebugView(props: {
  readonly runtimeView: ArchitecturePanelProps["runtimeView"]
  readonly labels: ArchitecturePanelProps["labels"]
}) {
  const value = (item: string | number | undefined) =>
    item === undefined || item === "" ? props.labels.debug.none : item
  return (
    <details className="architecture-editor__runtime-debug">
      <summary>{props.labels.debug.title}</summary>
      <dl>
        <dt>{props.labels.debug.resourceID}</dt>
        <dd>
          <bdi>{value(props.runtimeView.selectedResourceID)}</bdi>
        </dd>
        <dt>{props.labels.debug.dirty}</dt>
        <dd>{props.runtimeView.dirty ? props.labels.debug.yes : props.labels.debug.no}</dd>
        <dt>{props.labels.debug.dirtyReasons}</dt>
        <dd>
          {props.runtimeView.dirtyReasons.length > 0 ? (
            <ul>
              {props.runtimeView.dirtyReasons.map((reason) => (
                <li key={reason}>{props.labels.debug.reasons[reason]}</li>
              ))}
            </ul>
          ) : (
            props.labels.debug.none
          )}
        </dd>
        <dt>{props.labels.debug.syncStatus}</dt>
        <dd>{props.labels.debug.statuses[props.runtimeView.syncStatus]}</dd>
        <dt>{props.labels.debug.pendingOperations}</dt>
        <dd>{props.runtimeView.operationCount}</dd>
        <dt>{props.labels.debug.conflicts}</dt>
        <dd>{props.runtimeView.conflictCount}</dd>
        <dt>{props.labels.debug.liveInstance}</dt>
        <dd>{props.runtimeView.hasLiveInstance ? props.labels.debug.yes : props.labels.debug.no}</dd>
        <dt>{props.labels.debug.savedRevision}</dt>
        <dd>{value(props.runtimeView.savedRevision)}</dd>
        <dt>{props.labels.debug.savedDigest}</dt>
        <dd>
          <bdi>{value(props.runtimeView.savedDigest)}</bdi>
        </dd>
        <dt>{props.labels.debug.visibleRevision}</dt>
        <dd>{value(props.runtimeView.visibleRevision)}</dd>
        <dt>{props.labels.debug.visibleDigest}</dt>
        <dd>
          <bdi>{value(props.runtimeView.visibleDigest)}</bdi>
        </dd>
      </dl>
      <section className="architecture-editor__runtime-debug-activity">
        <h4>{props.labels.debug.activity}</h4>
        {props.runtimeView.debugEvents.length > 0 ? (
          <ol>
            {props.runtimeView.debugEvents.map((event) => (
              <li key={event.id}>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <span>
                  {props.labels.debug.eventTypes[event.type]} · {props.labels.debug.eventStatuses[event.status]}
                </span>
                <small>
                  {event.operationCount === undefined ? undefined : (
                    <span>
                      {props.labels.debug.pendingOperations}: {event.operationCount}
                    </span>
                  )}
                  {event.conflictCount === undefined ? undefined : (
                    <span>
                      {props.labels.debug.conflicts}: {event.conflictCount}
                    </span>
                  )}
                  {event.revision === undefined ? undefined : (
                    <span>
                      {props.labels.debug.visibleRevision}: {event.revision}
                    </span>
                  )}
                  {event.digest === undefined ? undefined : (
                    <span>
                      {props.labels.debug.visibleDigest}: <bdi>{event.digest}</bdi>
                    </span>
                  )}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>{props.labels.debug.noActivity}</p>
        )}
      </section>
    </details>
  )
}

function SelectionLassoCleanup() {
  const store = useStoreApi<ArchitectureFlowNode, ArchitectureFlowEdge>()
  useEffect(() => {
    const cleanup = () => {
      const state = store.getState()
      if (!state.userSelectionActive && !state.userSelectionRect && !state.nodesSelectionActive) return
      store.setState({ userSelectionActive: false, userSelectionRect: null, nodesSelectionActive: false })
    }
    const cleanupAfterReactFlow = () => queueMicrotask(cleanup)
    window.addEventListener("pointerup", cleanupAfterReactFlow)
    window.addEventListener("pointercancel", cleanupAfterReactFlow)
    window.addEventListener("blur", cleanupAfterReactFlow)
    return () => {
      window.removeEventListener("pointerup", cleanupAfterReactFlow)
      window.removeEventListener("pointercancel", cleanupAfterReactFlow)
      window.removeEventListener("blur", cleanupAfterReactFlow)
    }
  }, [store])
  return null
}

function NodeInternalsRefresh(props: { readonly nodeIDs: string; readonly refreshKey: string }) {
  const updateNodeInternals = useUpdateNodeInternals()
  useLayoutEffect(() => {
    const nodeIDs = props.nodeIDs.split(",").filter(Boolean)
    if (nodeIDs.length === 0) return
    if (typeof requestAnimationFrame !== "function") {
      updateNodeInternals(nodeIDs)
      return
    }
    const frame = requestAnimationFrame(() => updateNodeInternals(nodeIDs))
    return () => cancelAnimationFrame(frame)
  }, [props.nodeIDs, props.refreshKey, updateNodeInternals])
  return null
}

function Inspector(props: {
  readonly resource: ArchitectureResource
  readonly selection: Selection
  readonly selected: ArchitectureNode | ArchitectureEdge | undefined
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onEdgeStyle: (edgeID: string, style: ArchitectureEdgeStyle) => void
  readonly onCommit: (operations: ReadonlyArray<ArchitectureOperation>) => void
}) {
  if (!props.selection.primary)
    return (
      <ResourceHub
        resource={props.resource}
        labels={props.labels}
        onCommit={props.onCommit}
      />
    )
  if (props.selection.nodeIDs.length + props.selection.edgeIDs.length > 1)
    return (
      <div className="architecture-editor__detail">
        <h3>{props.labels.selectedItems(props.selection.nodeIDs.length, props.selection.edgeIDs.length)}</h3>
        <p>{props.labels.moveSelectionHint}</p>
      </div>
    )
  if (!props.selected)
    return (
      <ResourceHub
        resource={props.resource}
        labels={props.labels}
        onCommit={props.onCommit}
      />
    )
  if (props.selection.primary.type === "edge") {
    const edge = props.selected as ArchitectureEdge
    const updateSide = (field: "sourceHandle" | "targetHandle", side: ArchitectureConnectionSide) =>
      props.onCommit([
        {
          id: operationID(),
          type: "edge.update",
          edge: { ...edge, [field]: side },
        },
      ])
    return (
      <div className="architecture-editor__detail">
        <h3 dir="auto">{edge.id}</h3>
        <div>
          <bdi>{edge.source}</bdi> → <bdi>{edge.target}</bdi>
        </div>
        <div className="architecture-editor__form">
          <label>
            {props.labels.sourceSide}
            <select
              value={edge.sourceHandle ?? "right"}
              onChange={(event) => updateSide("sourceHandle", connectionSide(event.currentTarget.value, "right"))}
            >
              {connectionSides.map((side) => (
                <option key={side} value={side}>
                  {props.labels.sides[side]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {props.labels.targetSide}
            <select
              value={edge.targetHandle ?? "left"}
              onChange={(event) => updateSide("targetHandle", connectionSide(event.currentTarget.value, "left"))}
            >
              {connectionSides.map((side) => (
                <option key={side} value={side}>
                  {props.labels.sides[side]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <EdgeStyleControls
          labels={props.labels}
          style={edge.style ?? "rectangular"}
          onChange={(style) => props.onEdgeStyle(edge.id, style)}
        />
      </div>
    )
  }
  return (
    <NodeForm
      node={props.selected as ArchitectureNode}
      labels={props.labels}
      onChange={(node) => props.onCommit([{ id: operationID(), type: "node.update", node }])}
    />
  )
}

function EdgeStyleControls(props: {
  readonly labels: ArchitecturePanelProps["labels"]
  readonly style: ArchitectureEdgeStyle
  readonly onChange: (style: ArchitectureEdgeStyle) => void
}) {
  return (
    <div className="architecture-editor__edge-styles" aria-label={props.labels.connectionStyle}>
      <span>{props.labels.connectionStyle}</span>
      <div>
        {(
          [
            ["rectangular", props.labels.rectangular],
            ["curved", props.labels.curved],
            ["straight", props.labels.straight],
          ] as const
        ).map(([style, label]) => (
          <button key={style} type="button" aria-pressed={props.style === style} onClick={() => props.onChange(style)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResourceHub(props: {
  readonly resource: ArchitectureResource
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onCommit: (operations: ReadonlyArray<ArchitectureOperation>) => void
}) {
  const [tab, setTab] = useState<"details" | "tags">("details")
  return (
    <div className="architecture-editor__detail">
      <div className="architecture-editor__tabs" role="tablist" aria-label={props.labels.properties}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "details"}
          onClick={() => setTab("details")}
        >
          {props.labels.resourceDetails}
        </button>
        <button type="button" role="tab" aria-selected={tab === "tags"} onClick={() => setTab("tags")}>
          {props.labels.tagHub}
        </button>
      </div>
      {tab === "details" ? (
        <ResourceForm
          resource={props.resource}
          labels={props.labels}
          onChange={(name) => props.onCommit([{ id: operationID(), type: "resource.update", name }])}
        />
      ) : (
        <TagHub resource={props.resource} labels={props.labels} onCommit={props.onCommit} />
      )}
    </div>
  )
}

function ResourceForm(props: {
  readonly resource: ArchitectureResource
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onChange: (name: string) => void
}) {
  const commit = (input: HTMLInputElement) => {
    const name = input.value.trim()
    if (!name) {
      input.value = props.resource.name
      return
    }
    input.value = name
    if (name !== props.resource.name) props.onChange(name)
  }
  return (
    <form
      className="architecture-editor__form"
      onSubmit={(event) => {
        event.preventDefault()
        const input = event.currentTarget.elements.namedItem("name")
        if (input instanceof HTMLInputElement) commit(input)
      }}
    >
      <h3>{props.labels.resourceDetails}</h3>
      <label>
        {props.labels.name}
        <input
          name="name"
          defaultValue={props.resource.name}
          required
          onBlur={(event) => commit(event.currentTarget)}
        />
      </label>
    </form>
  )
}

function TagHub(props: {
  readonly resource: ArchitectureResource
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onCommit: (operations: ReadonlyArray<ArchitectureOperation>) => void
}) {
  const tags = tagSummaries(props.resource)
  if (tags.length === 0) return <p className="architecture-editor__empty-detail">{props.labels.noTags}</p>
  return (
    <div className="architecture-editor__tag-hub">
      {tags.map((tag) => (
        <div className="architecture-editor__tag-row" key={tag.label}>
          <div className="architecture-editor__tag-name">
            <TagNameInput
              tag={tag.label}
              labels={props.labels}
              onRename={(next) => props.onCommit(renameTagOperations(props.resource, tag.label, next))}
            />
            <span>{props.labels.tagUsage(tag.count)}</span>
          </div>
          <TagColorInput
            tag={tag.label}
            color={tag.color}
            labels={props.labels}
            onChange={(color) =>
              props.onCommit([
                {
                  id: operationID(),
                  type: "tag.color",
                  tag: tag.label,
                  color,
                },
              ])
            }
          />
          <button
            type="button"
            disabled={!tag.color}
            aria-label={props.labels.clearColor}
            title={props.labels.clearColor}
            onClick={() =>
              props.onCommit([{ id: operationID(), type: "tag.color", tag: tag.label, color: undefined }])
            }
          >
            {props.labels.clearFilters}
          </button>
        </div>
      ))}
    </div>
  )
}

function TagColorInput(props: {
  readonly tag: string
  readonly color: string | undefined
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onChange: (color: string) => void
}) {
  const [value, setValue] = useState(props.color ?? fallbackTagColor(props.tag))
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setValue(props.color ?? fallbackTagColor(props.tag))
    setDirty(false)
  }, [props.color, props.tag])
  const commit = () => {
    if (!dirty || value === props.color) {
      setDirty(false)
      return
    }
    props.onChange(value)
    setDirty(false)
  }
  return (
    <label className="architecture-editor__tag-color">
      <span>{props.labels.tagColor}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value)
          setDirty(true)
        }}
        onBlur={commit}
      />
    </label>
  )
}

function TagNameInput(props: {
  readonly tag: string
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onRename: (tag: string) => void
}) {
  const [value, setValue] = useState(props.tag)
  useEffect(() => setValue(props.tag), [props.tag])
  const commit = () => {
    const tag = cleanTag(value)
    if (!tag || tag === props.tag) {
      setValue(props.tag)
      return
    }
    props.onRename(tag)
  }
  return (
    <input
      aria-label={props.labels.name}
      value={value}
      maxLength={128}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setValue(props.tag)
          event.currentTarget.blur()
          return
        }
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )
}

function NodeForm(props: {
  readonly node: ArchitectureNode
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onChange: (node: ArchitectureNode) => void
}) {
  const commit = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const text = String(data.get("text") ?? "").trim()
    if (!text) {
      const input = form.elements.namedItem("text")
      if (input instanceof HTMLTextAreaElement) input.value = props.node.text
      return
    }
    const tags = unique(
      String(data.get("tags") ?? "")
        .split(/[\n,]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    )
    if (
      text === props.node.text &&
      tags.length === props.node.tags.length &&
      tags.every((tag, index) => tag === props.node.tags[index])
    )
      return
    props.onChange({
      ...props.node,
      text,
      tags,
    })
  }
  return (
    <form
      className="architecture-editor__form"
      onSubmit={(event) => {
        event.preventDefault()
        commit(event.currentTarget)
      }}
      data-prevent-session-autofocus
    >
      <label>
        {props.labels.text}
        <textarea
          name="text"
          defaultValue={props.node.text}
          required
          onBlur={(event) => {
            if (event.currentTarget.form) commit(event.currentTarget.form)
          }}
        />
      </label>
      <label>
        {props.labels.tags}
        <textarea
          name="tags"
          defaultValue={props.node.tags.join(", ")}
          onBlur={(event) => {
            if (event.currentTarget.form) commit(event.currentTarget.form)
          }}
        />
      </label>
    </form>
  )
}

function tagSummaries(resource: ArchitectureResource) {
  return unique(resource.nodes.flatMap((node) => node.tags)).map((label) => ({
    label,
    color: resource.tagColors?.[label],
    count: resource.nodes.filter((node) => node.tags.includes(label)).length,
  }))
}

function renameTagOperations(resource: ArchitectureResource, current: string, next: string): ArchitectureOperation[] {
  const targetExists = resource.nodes.some((node) => node.tags.includes(next))
  const operations = resource.nodes.flatMap((node): ArchitectureOperation[] => {
    if (!node.tags.includes(current)) return []
    return [
      {
        id: operationID(),
        type: "node.update",
        node: {
          ...node,
          tags: unique(node.tags.map((tag) => (tag === current ? next : tag))),
        },
      },
    ]
  })
  const color = resource.tagColors?.[current]
  if (!color) return operations
  return [
    { id: operationID(), type: "tag.color", tag: current, color: undefined },
    ...operations,
    ...(targetExists || resource.tagColors?.[next]
      ? []
      : [{ id: operationID(), type: "tag.color", tag: next, color } satisfies ArchitectureOperation]),
  ]
}

function cleanTag(value: string) {
  const tag = value.trim()
  if (!tag || tag.length > 128 || /[\n,]/.test(tag)) return undefined
  return tag
}

function fallbackTagColor(tag: string) {
  const colors = ["#4c82ff", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"]
  const index = Array.from(tag).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length
  return colors[index]!
}

function unique(values: ReadonlyArray<string>) {
  return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right))
}

function applyNodeSelection(nodes: ArchitectureFlowNode[], selection: Selection) {
  const selected = new Set(selection.nodeIDs)
  const next = nodes.map((node) =>
    node.selected === selected.has(node.id) ? node : { ...node, selected: selected.has(node.id) },
  )
  return next.every((node, index) => node === nodes[index]) ? nodes : next
}

function applyEdgeSelection(edges: ArchitectureFlowEdge[], selection: Selection) {
  const selected = new Set(selection.edgeIDs)
  const next = edges.map((edge) =>
    edge.selected === selected.has(edge.id) ? edge : { ...edge, selected: selected.has(edge.id) },
  )
  return next.every((edge, index) => edge === edges[index]) ? edges : next
}

function selectionInResource(selection: Selection, resource: ArchitectureResource): Selection {
  const nodeIDs = new Set(resource.nodes.map((node) => node.id))
  const edgeIDs = new Set(resource.edges.map((edge) => edge.id))
  const next = {
    nodeIDs: selection.nodeIDs.filter((id) => nodeIDs.has(id)),
    edgeIDs: selection.edgeIDs.filter((id) => edgeIDs.has(id)),
  }
  const primary =
    selection.primary?.type === "node" && next.nodeIDs.includes(selection.primary.id)
      ? selection.primary
      : selection.primary?.type === "edge" && next.edgeIDs.includes(selection.primary.id)
        ? selection.primary
        : next.nodeIDs[0]
          ? ({ type: "node", id: next.nodeIDs[0] } as const)
          : next.edgeIDs[0]
            ? ({ type: "edge", id: next.edgeIDs[0] } as const)
            : undefined
  return primary ? { ...next, primary } : next
}

function selectionFromSingle(selection: SingleSelection | undefined): Selection {
  if (!selection) return emptySelection
  if (selection.type === "node") return { nodeIDs: [selection.id], edgeIDs: [], primary: selection }
  return { nodeIDs: [], edgeIDs: [selection.id], primary: selection }
}

function selectionForContextTarget(target: SingleSelection, current: Selection): Selection {
  const targetSelected =
    target.type === "node" ? current.nodeIDs.includes(target.id) : current.edgeIDs.includes(target.id)
  if (targetSelected && current.nodeIDs.length + current.edgeIDs.length > 1) return { ...current, primary: target }
  return selectionFromSingle(target)
}

function selectionWithNode(target: { readonly type: "node"; readonly id: string }, current: Selection): Selection {
  return {
    nodeIDs: current.nodeIDs.includes(target.id) ? current.nodeIDs : [...current.nodeIDs, target.id],
    edgeIDs: current.edgeIDs,
    primary: target,
  }
}

function selectionFromChange(change: OnSelectionChangeParams<ArchitectureFlowNode, ArchitectureFlowEdge>): Selection {
  const nodeIDs = change.nodes.map((node) => node.id)
  const edgeIDs = change.edges.map((edge) => edge.id)
  return {
    nodeIDs,
    edgeIDs,
    primary: nodeIDs[0]
      ? { type: "node", id: nodeIDs[0] }
      : edgeIDs[0]
        ? { type: "edge", id: edgeIDs[0] }
        : undefined,
  }
}

function sameSelection(left: Selection, right: Selection) {
  return (
    sameIDs(left.nodeIDs, right.nodeIDs) &&
    sameIDs(left.edgeIDs, right.edgeIDs) &&
    left.primary?.type === right.primary?.type &&
    left.primary?.id === right.primary?.id
  )
}

function sameIDs(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function isEmptySelection(selection: Selection) {
  return selection.nodeIDs.length === 0 && selection.edgeIDs.length === 0
}

function selectionPrompt(
  resource: ArchitectureResource,
  selection: Selection,
  message: string,
): ArchitectureSelectionPrompt {
  return {
    message,
    resourceID: resource.id,
    resourceName: resource.name,
    nodeIDs: selection.nodeIDs,
    edgeIDs: selection.edgeIDs,
    nodes: selection.nodeIDs.flatMap((id) => {
      const node = resource.nodes.find((candidate) => candidate.id === id)
      if (!node) return []
      return [
        {
          id: node.id,
          text: shortSummary(node.text),
          tags: node.tags,
          position: node.layout.position,
        },
      ]
    }),
    edges: selection.edgeIDs.flatMap((id) => {
      const edge = resource.edges.find((candidate) => candidate.id === id)
      if (!edge) return []
      return [
        {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          style: edge.style,
        },
      ]
    }),
  }
}

function shortSummary(text: string) {
  const summary = text.replace(/\s+/g, " ").trim()
  if (summary.length <= 160) return summary
  return `${summary.slice(0, 157)}...`
}

function nodeMatchesFilter(node: ArchitectureNode, filter: { readonly text: string; readonly tag: string }) {
  if (filter.tag && !node.tags.includes(filter.tag)) return false
  if (!filter.text) return true
  return [node.id, node.text, ...node.tags].join("\n").toLowerCase().includes(filter.text.toLowerCase())
}

function samePosition(left: XYPosition, right: XYPosition) {
  return left.x === right.x && left.y === right.y
}

function isViewportMotionEvent(event: MouseEvent | TouchEvent | null) {
  if (!event) return false
  if (typeof WheelEvent !== "undefined" && event instanceof WheelEvent) return false
  if (typeof MouseEvent !== "undefined" && event instanceof MouseEvent)
    return event.buttons > 0 || event.type === "mouseup"
  return "touches" in event || "changedTouches" in event
}

function isViewportPanStartEvent(event: MouseEvent | TouchEvent | null) {
  if (!event) return false
  if (!isViewportMotionEvent(event)) return false
  if (!(event.target instanceof Element)) return true
  return !event.target.closest(
    ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .architecture-editor__side-toggle, .architecture-editor__context-menu, .architecture-editor__ask-popover, .architecture-editor__wire-toolbar",
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cancelViewportInertia(motion: ViewportMotion) {
  if (motion.inertia === undefined || typeof cancelAnimationFrame !== "function") return
  cancelAnimationFrame(motion.inertia)
}

function performanceNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}

function connectionEndedDisconnected(connection: FinalConnectionState | null | undefined) {
  return connection?.toHandle === null && connection.toNode === null
}

function connectionSide(value: string | null | undefined, fallback: ArchitectureConnectionSide) {
  return connectionSides.find((side) => side === value) ?? fallback
}
