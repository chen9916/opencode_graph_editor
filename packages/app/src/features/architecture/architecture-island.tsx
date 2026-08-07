import { createEffect, onCleanup } from "solid-js"
import type { ArchitecturePanelProps } from "./contract"

export function ArchitectureIsland(props: ArchitecturePanelProps) {
  let element: HTMLDivElement | undefined
  let state:
    | {
        render: (props: ArchitecturePanelProps) => void
        dispose: () => void
      }
    | undefined
  let disposed = false

  const ready = Promise.all([import("react"), import("react-dom/client"), import("./architecture-editor.react")]).then(
    ([react, reactDom, editor]) => {
      if (!element || disposed) return
      const root = reactDom.createRoot(element)
      state = {
        render: (next) => root.render(react.createElement(editor.ArchitectureEditor, next)),
        dispose: () => root.unmount(),
      }
      state.render(props)
    },
  )

  createEffect(() => {
    const next = { ...props }
    void ready.then(() => state?.render(next))
  })

  onCleanup(() => {
    disposed = true
    state?.dispose()
    state = undefined
  })

  return <div ref={element} class="architecture-island" data-prevent-session-autofocus />
}
