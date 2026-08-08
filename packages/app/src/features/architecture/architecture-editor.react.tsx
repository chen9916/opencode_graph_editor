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
} from "@xyflow/react"
import { useEffect, useId, useRef, useState } from "react"
import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureNode,
  ArchitectureOperation,
  ArchitecturePanelProps,
  ArchitectureResource,
  ArchitectureViewport,
} from "./contract"
import { applyOperations, flattenJournal, operationID } from "./journal"
import { toReactFlow, type ArchitectureFlowEdge, type ArchitectureFlowNode } from "./model"
import { ArchitectureEdgeView } from "./architecture-edge.react"
import { ArchitectureNodeView } from "./architecture-node.react"

const nodeTypes = { architecture: ArchitectureNodeView }
const edgeTypes = { architecture: ArchitectureEdgeView }
const connectionSides = ["top", "right", "bottom", "left"] as const satisfies ReadonlyArray<ArchitectureConnectionSide>

type SingleSelection = { readonly type: "node" | "edge"; readonly id: string }
type Selection = {
  readonly nodeIDs: ReadonlyArray<string>
  readonly edgeIDs: ReadonlyArray<string>
  readonly primary?: SingleSelection
}
type ContextMenu =
  | { readonly type: "pane"; readonly x: number; readonly y: number; readonly position: XYPosition }
  | { readonly type: "node" | "edge"; readonly id: string; readonly x: number; readonly y: number }
type EditorState = {
  readonly resource: ArchitectureResource
  readonly past: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
  readonly future: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
}
type ViewportMotion = {
  readonly active: boolean
  readonly last?: { readonly viewport: ArchitectureViewport; readonly time: number }
  readonly velocity: XYPosition
  readonly inertia?: number
}

const emptySelection: Selection = { nodeIDs: [], edgeIDs: [] }

export function ArchitectureEditor(props: ArchitecturePanelProps) {
  const base = props.draft?.base ?? props.snapshot
  const initial = props.draft?.operations ?? []
  const initialKey = `${base.resource.id}:${base.digest}:${initial.map((operation) => operation.id).join(":")}`
  const loaded = useRef(initialKey)
  const loadedResourceID = useRef(base.resource.id)
  const canvas = useRef<HTMLDivElement>(null)
  const viewportMotion = useRef<ViewportMotion>({ active: false, velocity: { x: 0, y: 0 } })
  const outlineID = useId()
  const inspectorID = useId()
  const [editor, setEditor] = useState<EditorState>(() => ({
    resource: applyOperations(base.resource, initial),
    past: initial.map((operation) => [operation]),
    future: [],
  }))
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [flow, setFlow] = useState<ReactFlowInstance<ArchitectureFlowNode, ArchitectureFlowEdge>>()
  const [filter, setFilter] = useState({ text: "", tag: "" })
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu>()
  const operations = flattenJournal(editor.past)
  const dirty = operations.length > 0 || (props.draft?.conflicts.length ?? 0) > 0
  const tags = unique(editor.resource.nodes.flatMap((node) => node.tags))
  const controlsPosition = props.direction === "rtl" ? "bottom-right" : "bottom-left"
  const minimapPosition = props.direction === "rtl" ? "top-left" : "top-right"
  const visibleNodes = editor.resource.nodes.filter((node) => nodeMatchesFilter(node, filter))
  const hasSelection = selection.nodeIDs.length > 0 || selection.edgeIDs.length > 0
  const filterActive = !!filter.text || !!filter.tag

  const commit = (batch: ReadonlyArray<ArchitectureOperation>) => {
    if (batch.length === 0) return
    const next = {
      resource: applyOperations(editor.resource, batch),
      past: [...editor.past, batch],
      future: [],
    }
    setEditor(next)
    props.onJournal(flattenJournal(next.past))
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

  const select = (next: SingleSelection | undefined) => {
    const selected = selectionFromSingle(next)
    setSelection((current) => (sameSelection(current, selected) ? current : selected))
    setNodes((current) => current.map((node) => ({ ...node, selected: selected.nodeIDs.includes(node.id) })))
    setEdges((current) => current.map((edge) => ({ ...edge, selected: selected.edgeIDs.includes(edge.id) })))
  }

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".architecture-editor__context-menu, .architecture-editor__wire-toolbar")
      )
        return
      setContextMenu(undefined)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setContextMenu(undefined)
    }
    document.addEventListener("pointerdown", pointer)
    document.addEventListener("keydown", keyboard)
    return () => {
      document.removeEventListener("pointerdown", pointer)
      document.removeEventListener("keydown", keyboard)
    }
  }, [])

  useEffect(() => () => cancelViewportInertia(viewportMotion.current), [])

  useEffect(() => {
    if (loaded.current === initialKey) return
    const resourceChanged = loadedResourceID.current !== base.resource.id
    loaded.current = initialKey
    loadedResourceID.current = base.resource.id
    setEditor({
      resource: applyOperations(base.resource, initial),
      past: initial.map((operation) => [operation]),
      future: [],
    })
    if (!resourceChanged) return
    select(undefined)
    setContextMenu(undefined)
    setOutlineOpen(false)
    setInspectorOpen(false)
  }, [base.digest, base.resource.id, initialKey])

  useEffect(() => {
    const next = toReactFlow(editor.resource, updateNodeText, {
      label: props.labels.connectionStyle,
      styles: {
        rectangular: props.labels.rectangular,
        curved: props.labels.curved,
        straight: props.labels.straight,
      },
      onChange: (edgeID, style) => changeEdgeStyle(edgeID, style),
    })
    const visible = new Set(
      editor.resource.nodes.filter((node) => nodeMatchesFilter(node, filter)).map((node) => node.id),
    )
    setNodes(
      next.nodes.map((node) => ({
        ...node,
        hidden: !visible.has(node.id),
        selected: selection.nodeIDs.includes(node.id),
      })),
    )
    setEdges(
      next.edges.map((edge) => ({
        ...edge,
        hidden: !visible.has(edge.source) || !visible.has(edge.target),
        selected: selection.edgeIDs.includes(edge.id),
      })),
    )
  }, [editor.resource, filter.tag, filter.text, selection, setEdges, setNodes])

  const undo = () => {
    const batch = editor.past.at(-1)
    if (!batch) return
    const past = editor.past.slice(0, -1)
    setEditor({
      resource: applyOperations(base.resource, flattenJournal(past)),
      past,
      future: [batch, ...editor.future],
    })
    props.onJournal(flattenJournal(past))
  }

  const redo = () => {
    const batch = editor.future[0]
    if (!batch) return
    const past = [...editor.past, batch]
    setEditor({
      resource: applyOperations(base.resource, flattenJournal(past)),
      past,
      future: editor.future.slice(1),
    })
    props.onJournal(flattenJournal(past))
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
    const selectedNodeIDs = new Set(selection.nodeIDs)
    const cascadedEdgeIDs = editor.resource.edges
      .filter((edge) => selectedNodeIDs.has(edge.source) || selectedNodeIDs.has(edge.target))
      .map((edge) => edge.id)
    const operations: ReadonlyArray<ArchitectureOperation> = [
      ...selection.nodeIDs.map(
        (nodeID): ArchitectureOperation => ({ id: operationID(), type: "node.remove", nodeID, cascade: true }),
      ),
      ...selection.edgeIDs
        .filter((edgeID) => !cascadedEdgeIDs.includes(edgeID))
        .map((edgeID): ArchitectureOperation => ({ id: operationID(), type: "edge.remove", edgeID })),
    ]
    props.onConfirm(props.labels.deleteSelectionConfirm, props.labels.delete, () => {
      commit(operations)
      select(undefined)
      setContextMenu(undefined)
    })
  }

  useEffect(() => {
    if (!props.action) return
    if (props.action.type === "save") props.onSave(operations)
    if (props.action.type === "reload") props.onReload()
    if (props.action.type === "fitView") fitSelection()
    if (props.action.type === "addNode") addNode()
    if (props.action.type === "undo") undo()
    if (props.action.type === "redo") redo()
    if (props.action.type === "delete") removeSelection()
  }, [props.action?.id])

  const onSelectionChange = (change: OnSelectionChangeParams<ArchitectureFlowNode, ArchitectureFlowEdge>) => {
    const next = selectionFromChange(change)
    setSelection((current) => (sameSelection(current, next) ? current : next))
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

  const reconnect = (edgeID: string, connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edge = editor.resource.edges.find((candidate) => candidate.id === edgeID)
    if (!edge) return
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
    if (!isViewportPointerEvent(event)) {
      viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
      return
    }
    viewportMotion.current = {
      active: true,
      velocity: { x: 0, y: 0 },
    }
  }

  const trackViewportMove = (event: MouseEvent | TouchEvent | null, viewport: ArchitectureViewport) => {
    if (!viewportMotion.current.active || !isViewportPointerEvent(event)) return
    const time = performance.now()
    const last = viewportMotion.current.last
    const nextVelocity = last
      ? {
          x: (viewport.x - last.viewport.x) / Math.max(16, time - last.time),
          y: (viewport.y - last.viewport.y) / Math.max(16, time - last.time),
        }
      : { x: 0, y: 0 }
    const velocity = {
      x: viewportMotion.current.velocity.x * 0.55 + nextVelocity.x * 0.45,
      y: viewportMotion.current.velocity.y * 0.55 + nextVelocity.y * 0.45,
    }
    viewportMotion.current = { active: true, last: { viewport, time }, velocity }
  }

  const finishViewportMove = (event: MouseEvent | TouchEvent | null, viewport: ArchitectureViewport) => {
    props.onViewport(viewport)
    const motion = viewportMotion.current
    viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
    if (!flow || !motion.active || !isViewportPointerEvent(event)) return
    const speed = Math.hypot(motion.velocity.x, motion.velocity.y)
    if (speed < 0.04) return
    glideViewport(viewport, {
      x: clamp(motion.velocity.x, -1.35, 1.35),
      y: clamp(motion.velocity.y, -1.35, 1.35),
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
      momentum = {
        x: momentum.x * Math.exp(-delta / 360),
        y: momentum.y * Math.exp(-delta / 360),
      }
      void flow.setViewport(current)
      if (Math.hypot(momentum.x, momentum.y) < 0.012 || elapsed > 920) {
        viewportMotion.current = { active: false, velocity: { x: 0, y: 0 } }
        props.onViewport(current)
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
        if (!(event.target instanceof Element)) return
        if (event.target.closest("button, input, textarea, select, [contenteditable='true']")) return
        event.currentTarget.focus({ preventScroll: true })
      }}
    >
      <header className="architecture-editor__toolbar">
        <div className="architecture-editor__heading">
          <div>
            <div className="architecture-editor__title" dir="auto">
              {editor.resource.name}
            </div>
            <div className="architecture-editor__summary">
              {props.labels.revision(base.resource.revision)} · {props.labels.nodes(editor.resource.nodes.length)} ·{" "}
              {props.labels.edges(editor.resource.edges.length)}
            </div>
          </div>
          <div className="architecture-editor__actions">
            <button type="button" onClick={() => addNode()} disabled={props.busy}>
              {props.labels.addNode}
            </button>
            <button type="button" onClick={undo} disabled={editor.past.length === 0 || props.busy}>
              {props.labels.undo}
            </button>
            <button type="button" onClick={redo} disabled={editor.future.length === 0 || props.busy}>
              {props.labels.redo}
            </button>
            <button type="button" onClick={fitSelection}>
              {selection.nodeIDs.length > 0 ? props.labels.fitSelection : props.labels.fitView}
            </button>
            <button type="button" onClick={props.onReload} disabled={props.busy}>
              {props.labels.reload}
            </button>
            <button
              type="button"
              onClick={() => props.onSave(operations)}
              disabled={operations.length === 0 || props.busy}
            >
              {props.labels.save}
            </button>
            <button type="button" onClick={() => props.onExport(operations)} disabled={!dirty}>
              {props.labels.exportPatch}
            </button>
            <button type="button" onClick={() => removeSelection()} disabled={!hasSelection || props.busy}>
              {props.labels.delete}
            </button>
          </div>
        </div>
      </header>
      <div className="architecture-editor__body" dir="ltr">
        <button
          type="button"
          className="architecture-editor__side-toggle architecture-editor__side-toggle--outline"
          data-open={outlineOpen || undefined}
          data-active={filterActive || undefined}
          aria-expanded={outlineOpen}
          aria-controls={outlineID}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          {props.labels.outlineTitle}
        </button>
        <button
          type="button"
          className="architecture-editor__side-toggle architecture-editor__side-toggle--inspector"
          data-open={inspectorOpen || undefined}
          aria-expanded={inspectorOpen}
          aria-controls={inspectorID}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          {props.labels.properties}
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
            onConnect={onConnect}
            onPaneClick={() => {
              select(undefined)
              setContextMenu(undefined)
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              if (!flow) return
              const at = menuPosition(event.clientX, event.clientY)
              select(undefined)
              setContextMenu({
                type: "pane",
                ...at,
                position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              })
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              const at = menuPosition(event.clientX, event.clientY)
              select({ type: "node", id: node.id })
              setContextMenu({ type: "node", id: node.id, ...at })
            }}
            onEdgeClick={(event, edge) => {
              event.stopPropagation()
              select({ type: "edge", id: edge.id })
              setContextMenu(undefined)
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault()
              const at = menuPosition(event.clientX, event.clientY)
              select({ type: "edge", id: edge.id })
              setContextMenu({ type: "edge", id: edge.id, ...at })
            }}
            onReconnect={(edge, connection) => reconnect(edge.id, connection)}
            onReconnectEnd={(_event, edge, _handle, connection) => {
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
            onNodesDelete={(removed) => {
              commit(
                removed.map((node) => ({ id: operationID(), type: "node.remove", nodeID: node.id, cascade: true })),
              )
              select(undefined)
              setContextMenu(undefined)
            }}
            onEdgesDelete={(removed) => {
              commit(removed.map((edge) => ({ id: operationID(), type: "edge.remove", edgeID: edge.id })))
              select(undefined)
              setContextMenu(undefined)
            }}
            onInit={setFlow}
            onMoveStart={startViewportMove}
            onMove={trackViewportMove}
            onMoveEnd={finishViewportMove}
            defaultViewport={props.viewport}
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
            fitView={!props.viewport}
            proOptions={{ hideAttribution: true }}
          >
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
                    onClick={() => removeSelection({ type: "node", id: contextMenu.id })}
                  >
                    {props.labels.delete}
                  </button>
                </>
              )}
              {contextMenu.type === "edge" && (
                <>
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
            {(props.draft?.conflicts.length ?? 0) > 0 && (
              <section className="architecture-editor__conflicts">
                <h3>{props.labels.conflicts}</h3>
                <ul>
                  {props.draft?.conflicts.map((conflict) => (
                    <li key={conflict.operation.id}>
                      <bdi>{conflict.operation.id}</bdi>: {props.labels.conflictReasons[conflict.reason]}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  )
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
      <ResourceForm
        resource={props.resource}
        labels={props.labels}
        onChange={(name) => props.onCommit([{ id: operationID(), type: "resource.update", name }])}
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
      <ResourceForm
        resource={props.resource}
        labels={props.labels}
        onChange={(name) => props.onCommit([{ id: operationID(), type: "resource.update", name }])}
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

function unique(values: ReadonlyArray<string>) {
  return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right))
}

function selectionFromSingle(selection: SingleSelection | undefined): Selection {
  if (!selection) return emptySelection
  if (selection.type === "node") return { nodeIDs: [selection.id], edgeIDs: [], primary: selection }
  return { nodeIDs: [], edgeIDs: [selection.id], primary: selection }
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

function nodeMatchesFilter(node: ArchitectureNode, filter: { readonly text: string; readonly tag: string }) {
  if (filter.tag && !node.tags.includes(filter.tag)) return false
  if (!filter.text) return true
  return [node.id, node.text, ...node.tags].join("\n").toLowerCase().includes(filter.text.toLowerCase())
}

function samePosition(left: XYPosition, right: XYPosition) {
  return left.x === right.x && left.y === right.y
}

function isViewportPointerEvent(event: MouseEvent | TouchEvent | null) {
  if (!event) return false
  if (typeof WheelEvent !== "undefined" && event instanceof WheelEvent) return false
  if (typeof MouseEvent !== "undefined" && event instanceof MouseEvent)
    return event.buttons > 0 || event.type === "mouseup"
  return "touches" in event || "changedTouches" in event
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cancelViewportInertia(motion: ViewportMotion) {
  if (motion.inertia === undefined || typeof cancelAnimationFrame !== "function") return
  cancelAnimationFrame(motion.inertia)
}

function connectionEndedDisconnected(connection: FinalConnectionState) {
  return connection.toHandle === null && connection.toNode === null
}

function connectionSide(value: string | null | undefined, fallback: ArchitectureConnectionSide) {
  return connectionSides.find((side) => side === value) ?? fallback
}
