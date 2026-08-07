/** @jsxImportSource react */

import { BaseEdge, EdgeToolbar, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from "@xyflow/react"
import type { ArchitectureEdgeStyle } from "./contract"
import type { ArchitectureFlowEdge } from "./model"

const styles = ["smoothstep", "default", "straight"] as const satisfies ReadonlyArray<ArchitectureEdgeStyle>

export function ArchitectureEdgeView(props: EdgeProps<ArchitectureFlowEdge>) {
  const data = props.data
  if (!data) return null
  const controls = data.controls
  const path =
    data.style === "straight"
      ? getStraightPath(props)
      : data.style === "default"
        ? getBezierPath(props)
        : getSmoothStepPath(props)

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path[0]}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
        style={props.style}
      />
      {props.selected && controls && (
        <EdgeToolbar
          edgeId={props.id}
          x={path[1]}
          y={path[2]}
          alignY="bottom"
          isVisible
          className="architecture-editor__wire-toolbar-anchor nodrag nopan"
        >
          <div
            className="architecture-editor__wire-toolbar"
            aria-label={controls.label}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {styles.map((style) => (
              <button
                key={style}
                type="button"
                title={controls.styles[style]}
                aria-label={controls.styles[style]}
                aria-pressed={data.style === style}
                data-wire-style={style}
                onClick={() => controls.onChange(props.id, style)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        </EdgeToolbar>
      )}
    </>
  )
}
