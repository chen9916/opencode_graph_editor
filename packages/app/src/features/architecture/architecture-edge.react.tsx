/** @jsxImportSource react */

import { BaseEdge, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from "@xyflow/react"
import type { ArchitectureFlowEdge } from "./model"

export function ArchitectureEdgeView(props: EdgeProps<ArchitectureFlowEdge>) {
  const data = props.data
  if (!data) return null
  const path =
    data.style === "straight"
      ? getStraightPath(props)
      : data.style === "curved"
        ? getBezierPath(props)
        : getSmoothStepPath(props)
  const style =
    data.dimmed && !props.selected
      ? {
          ...props.style,
          opacity: 0.38,
          stroke: "var(--architecture-muted-wire)",
        }
      : props.style

  return (
    <BaseEdge
      id={props.id}
      path={path[0]}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      interactionWidth={props.interactionWidth}
      style={style}
    />
  )
}
