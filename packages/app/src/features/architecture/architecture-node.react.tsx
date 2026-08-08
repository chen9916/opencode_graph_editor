/** @jsxImportSource react */

import type { NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"
import { useRef, useState, type PointerEvent } from "react"
import type { ArchitectureConnectionSide } from "./contract"
import { architectureNodeClass, type ArchitectureFlowNode } from "./model"

export function ArchitectureNodeView(props: NodeProps<ArchitectureFlowNode>) {
  const node = props.data.node
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(node.text)
  const [activeSocket, setActiveSocket] = useState<ArchitectureConnectionSide>()
  const cancelled = useRef(false)
  const revealSocket = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const vertical =
      y < rect.height - y
        ? ({ side: "top", distance: y } as const)
        : ({ side: "bottom", distance: rect.height - y } as const)
    const horizontal =
      x < rect.width - x
        ? ({ side: "left", distance: x } as const)
        : ({ side: "right", distance: rect.width - x } as const)
    setActiveSocket(vertical.distance < horizontal.distance ? vertical.side : horizontal.side)
  }
  const save = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const value = text.trim()
    setEditing(false)
    if (!value || value === node.text) return
    props.data.onTextChange(node, value)
  }
  return (
    <div
      className={architectureNodeClass()}
      data-active-socket={activeSocket}
      data-selected={props.selected || undefined}
      onPointerMove={revealSocket}
      onPointerLeave={() => setActiveSocket(undefined)}
      onDoubleClick={() => {
        cancelled.current = false
        setText(node.text)
        setEditing(true)
      }}
    >
      <Handle id="top" className="architecture-node__socket" data-side="top" type="source" position={Position.Top} />
      <Handle
        id="right"
        className="architecture-node__socket"
        data-side="right"
        type="source"
        position={Position.Right}
      />
      <Handle
        id="bottom"
        className="architecture-node__socket"
        data-side="bottom"
        type="source"
        position={Position.Bottom}
      />
      <Handle
        id="left"
        className="architecture-node__socket"
        data-side="left"
        type="source"
        position={Position.Left}
      />
      {editing ? (
        <textarea
          className="architecture-node__text-input nodrag nowheel"
          value={text}
          autoFocus
          rows={Math.max(2, text.split("\n").length)}
          onChange={(event) => setText(event.currentTarget.value)}
          onBlur={save}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              cancelled.current = true
              setText(node.text)
              setEditing(false)
              return
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save()
          }}
        />
      ) : (
        <div className="architecture-node__text" dir="auto">
          {node.text}
        </div>
      )}
      {node.tags.length > 0 && (
        <div className="architecture-node__tags">
          {node.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}
