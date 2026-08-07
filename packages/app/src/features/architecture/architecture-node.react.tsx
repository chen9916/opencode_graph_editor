/** @jsxImportSource react */

import type { NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"
import { useRef, useState } from "react"
import { architectureNodeClass, type ArchitectureFlowNode } from "./model"

export function ArchitectureNodeView(props: NodeProps<ArchitectureFlowNode>) {
  const node = props.data.node
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(node.text)
  const cancelled = useRef(false)
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
      data-selected={props.selected || undefined}
      onDoubleClick={() => {
        cancelled.current = false
        setText(node.text)
        setEditing(true)
      }}
    >
      <Handle id="top" type="source" position={Position.Top} />
      <Handle id="right" type="source" position={Position.Right} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
      <Handle id="left" type="source" position={Position.Left} />
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
