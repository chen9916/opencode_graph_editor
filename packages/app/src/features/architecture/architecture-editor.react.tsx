/** @jsxImportSource react */

import "@xyflow/react/dist/style.css"
import "./architecture.css"

import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type XYPosition,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import type {
  ArchitectureConnectionSide,
  ArchitectureEdge,
  ArchitectureEdgeStyle,
  ArchitectureNode,
  ArchitectureOperation,
  ArchitecturePanelProps,
  ArchitectureResource,
} from "./contract"
import { applyOperations, flattenJournal, operationID } from "./journal"
import { toReactFlow, type ArchitectureFlowEdge, type ArchitectureFlowNode } from "./model"
import { ArchitectureEdgeView } from "./architecture-edge.react"
import { ArchitectureNodeView } from "./architecture-node.react"

const nodeTypes = { architecture: ArchitectureNodeView }
const edgeTypes = { architecture: ArchitectureEdgeView }
const connectionSides = ["top", "right", "bottom", "left"] as const satisfies ReadonlyArray<ArchitectureConnectionSide>

type Selection = { readonly type: "node" | "edge"; readonly id: string }
type ContextMenu =
  | { readonly type: "pane"; readonly x: number; readonly y: number; readonly position: XYPosition }
  | { readonly type: "node" | "edge"; readonly id: string; readonly x: number; readonly y: number }
type EditorState = {
  readonly resource: ArchitectureResource
  readonly past: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
  readonly future: ReadonlyArray<ReadonlyArray<ArchitectureOperation>>
}

export function ArchitectureEditor(props: ArchitecturePanelProps) {
  const base = props.draft?.base ?? props.snapshot
  const initial = props.draft?.operations ?? []
  const initialKey = `${base.digest}:${initial.map((operation) => operation.id).join(":")}`
  const loaded = useRef(initialKey)
  const canvas = useRef<HTMLDivElement>(null)
  const outlineID = useId()
  const inspectorID = useId()
  const [editor, setEditor] = useState<EditorState>(() => ({
    resource: applyOperations(base.resource, initial),
    past: initial.map((operation) => [operation]),
    future: [],
  }))
  const [selection, setSelection] = useState<Selection>()
  const [flow, setFlow] = useState<ReactFlowInstance<ArchitectureFlowNode, ArchitectureFlowEdge>>()
  const [filter, setFilter] = useState({ text: "", tag: "" })
  const [outlineOpen, setOutlineOpen] = useState(!props.mobile)
  const [inspectorOpen, setInspectorOpen] = useState(!props.mobile)
  const [contextMenu, setContextMenu] = useState<ContextMenu>()
  const operations = flattenJournal(editor.past)
  const dirty = operations.length > 0 || (props.draft?.conflicts.length ?? 0) > 0
  const tags = unique(editor.resource.nodes.flatMap((node) => node.tags))
  const controlsPosition = props.direction === "rtl" ? "bottom-right" : "bottom-left"
  const minimapPosition = props.direction === "rtl" ? "top-left" : "top-right"

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

  const projected = toReactFlow(editor.resource, updateNodeText, props.edgeStyles, {
    label: props.labels.connectionStyle,
    styles: {
      smoothstep: props.labels.rectangular,
      default: props.labels.curved,
      straight: props.labels.straight,
    },
    onChange: props.onEdgeStyle,
  })
  const [nodes, setNodes, onNodesChange] = useNodesState(projected.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(projected.edges)

  const select = (next: Selection | undefined) => {
    setSelection((current) => (current?.type === next?.type && current?.id === next?.id ? current : next))
    setNodes((current) => current.map((node) => ({ ...node, selected: next?.type === "node" && next.id === node.id })))
    setEdges((current) => current.map((edge) => ({ ...edge, selected: next?.type === "edge" && next.id === edge.id })))
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

  useEffect(() => {
    if (loaded.current === initialKey) return
    loaded.current = initialKey
    setEditor({
      resource: applyOperations(base.resource, initial),
      past: initial.map((operation) => [operation]),
      future: [],
    })
    select(undefined)
    setContextMenu(undefined)
  }, [base.digest, initialKey])

  useEffect(() => {
    const next = toReactFlow(editor.resource, updateNodeText, props.edgeStyles, {
      label: props.labels.connectionStyle,
      styles: {
        smoothstep: props.labels.rectangular,
        default: props.labels.curved,
        straight: props.labels.straight,
      },
      onChange: props.onEdgeStyle,
    })
    const visible = new Set(
      editor.resource.nodes
        .filter((node) => {
          if (filter.tag && !node.tags.includes(filter.tag)) return false
          if (!filter.text) return true
          return [node.id, node.text, ...node.tags].join("\n").toLowerCase().includes(filter.text.toLowerCase())
        })
        .map((node) => node.id),
    )
    setNodes(
      next.nodes.map((node) => ({
        ...node,
        hidden: !visible.has(node.id),
        selected: selection?.type === "node" && selection.id === node.id,
      })),
    )
    setEdges(
      next.edges.map((edge) => ({
        ...edge,
        hidden: !visible.has(edge.source) || !visible.has(edge.target),
        selected: selection?.type === "edge" && selection.id === edge.id,
      })),
    )
  }, [editor.resource, filter.tag, filter.text, props.edgeStyles, setEdges, setNodes])

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

  const removeSelection = (target = selection) => {
    if (!target) return
    if (target.type === "node") {
      props.onConfirm(props.labels.deleteNodeConfirm, props.labels.delete, () => {
        commit([{ id: operationID(), type: "node.remove", nodeID: target.id, cascade: true }])
        select(undefined)
        setContextMenu(undefined)
      })
      return
    }
    props.onConfirm(props.labels.deleteEdgeConfirm, props.labels.delete, () => {
      commit([{ id: operationID(), type: "edge.remove", edgeID: target.id }])
      select(undefined)
      setContextMenu(undefined)
    })
  }

  useEffect(() => {
    if (!props.action) return
    if (props.action.type === "save") props.onSave(operations)
    if (props.action.type === "reload") props.onReload()
    if (props.action.type === "fitView") void flow?.fitView({ padding: 0.15 })
    if (props.action.type === "addNode") addNode()
  }, [props.action?.id])

  const onSelectionChange = (change: OnSelectionChangeParams) => {
    const node = change.nodes[0]
    if (node) {
      setSelection((current) =>
        current?.type === "node" && current.id === node.id ? current : { type: "node", id: node.id },
      )
      return
    }
    const edge = change.edges[0]
    setSelection((current) => {
      if (!edge) return current ? undefined : current
      return current?.type === "edge" && current.id === edge.id ? current : { type: "edge", id: edge.id }
    })
  }

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edge: ArchitectureEdge = {
      id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connectionSide(connection.sourceHandle, "right"),
      targetHandle: connectionSide(connection.targetHandle, "left"),
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

  const selected =
    selection?.type === "node"
      ? editor.resource.nodes.find((node) => node.id === selection.id)
      : selection?.type === "edge"
        ? editor.resource.edges.find((edge) => edge.id === selection.id)
        : undefined

  return (
    <div className="architecture-editor" dir={props.direction} data-prevent-session-autofocus>
      <header className="architecture-editor__toolbar">
        <div className="architecture-editor__heading">
          <div>
            <div className="architecture-editor__title" dir="auto">
              {editor.resource.name}
            </div>
            <div className="architecture-editor__summary">
              {props.labels.revision(base.resource.revision)} · {props.labels.nodes(editor.resource.nodes.length)} ·{" "}
              {props.labels.edges(editor.resource.edges.length)} · {dirty ? props.labels.dirty : props.labels.clean}
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
            <button type="button" onClick={() => void flow?.fitView({ padding: 0.15 })}>
              {props.labels.fitView}
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
          </div>
        </div>
        <div className="architecture-editor__filters">
          <input
            data-prevent-session-autofocus
            aria-label={props.labels.search}
            placeholder={props.labels.search}
            value={filter.text}
            onChange={(event) => setFilter({ ...filter, text: event.currentTarget.value })}
          />
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
          <button
            type="button"
            aria-expanded={outlineOpen}
            aria-controls={outlineID}
            onClick={() => setOutlineOpen((open) => !open)}
          >
            {props.labels.outlineTitle}
          </button>
          <button
            type="button"
            aria-expanded={inspectorOpen}
            aria-controls={inspectorID}
            onClick={() => setInspectorOpen((open) => !open)}
          >
            {props.labels.properties}
          </button>
          <button type="button" onClick={() => removeSelection()} disabled={!selection || props.busy}>
            {props.labels.delete}
          </button>
        </div>
      </header>
      <div className="architecture-editor__body" dir="ltr">
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
            <ul>
              {editor.resource.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className={selection?.type === "node" && selection.id === node.id ? "is-selected" : undefined}
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
            onNodeDragStop={(_event, node) =>
              commit([{ id: operationID(), type: "node.position", nodeID: node.id, position: node.position }])
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
            onMoveEnd={(_event, viewport) => props.onViewport(viewport)}
            defaultViewport={props.viewport}
            connectionMode={ConnectionMode.Loose}
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
                    style={props.edgeStyles[contextMenu.id] ?? "smoothstep"}
                    onChange={(style) => props.onEdgeStyle(contextMenu.id, style)}
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
              key={selection ? `${selection.type}:${selection.id}` : "none"}
              resource={editor.resource}
              selection={selection}
              selected={selected}
              edgeStyle={selection?.type === "edge" ? (props.edgeStyles[selection.id] ?? "smoothstep") : undefined}
              labels={props.labels}
              onEdgeStyle={props.onEdgeStyle}
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
  readonly selection: Selection | undefined
  readonly selected: ArchitectureNode | ArchitectureEdge | undefined
  readonly edgeStyle: ArchitectureEdgeStyle | undefined
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onEdgeStyle: (edgeID: string, style: ArchitectureEdgeStyle) => void
  readonly onCommit: (operations: ReadonlyArray<ArchitectureOperation>) => void
}) {
  if (!props.selection || !props.selected)
    return (
      <ResourceForm
        resource={props.resource}
        labels={props.labels}
        onSave={(name) => props.onCommit([{ id: operationID(), type: "resource.update", name }])}
      />
    )
  if (props.selection.type === "edge") {
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
          style={props.edgeStyle ?? "smoothstep"}
          onChange={(style) => props.onEdgeStyle(edge.id, style)}
        />
      </div>
    )
  }
  return (
    <NodeForm
      node={props.selected as ArchitectureNode}
      labels={props.labels}
      onSave={(node) => props.onCommit([{ id: operationID(), type: "node.update", node }])}
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
            ["smoothstep", props.labels.rectangular],
            ["default", props.labels.curved],
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
  readonly onSave: (name: string) => void
}) {
  return (
    <form
      className="architecture-editor__form"
      onSubmit={(event) => {
        event.preventDefault()
        const name = String(new FormData(event.currentTarget).get("name") ?? "").trim()
        if (name) props.onSave(name)
      }}
    >
      <h3>{props.labels.resourceDetails}</h3>
      <label>
        {props.labels.name}
        <input name="name" defaultValue={props.resource.name} required />
      </label>
      <button type="submit">{props.labels.save}</button>
    </form>
  )
}

function NodeForm(props: {
  readonly node: ArchitectureNode
  readonly labels: ArchitecturePanelProps["labels"]
  readonly onSave: (node: ArchitectureNode) => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const text = String(data.get("text") ?? "").trim()
    if (!text) return
    props.onSave({
      ...props.node,
      text,
      tags: unique(
        String(data.get("tags") ?? "")
          .split(/[\n,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    })
  }
  return (
    <form className="architecture-editor__form" onSubmit={submit} data-prevent-session-autofocus>
      <label>
        {props.labels.text}
        <textarea name="text" defaultValue={props.node.text} required />
      </label>
      <label>
        {props.labels.tags}
        <textarea name="tags" defaultValue={props.node.tags.join(", ")} />
      </label>
      <button type="submit">{props.labels.save}</button>
    </form>
  )
}

function unique(values: ReadonlyArray<string>) {
  return Array.from(new Set(values)).toSorted((left, right) => left.localeCompare(right))
}

function connectionSide(value: string | null | undefined, fallback: ArchitectureConnectionSide) {
  return connectionSides.find((side) => side === value) ?? fallback
}
