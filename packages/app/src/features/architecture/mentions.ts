import { createEffect, createResource, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerArchitectureAvailable, useServerSDK } from "@/context/server-sdk"
import { listArchitectureResources } from "./api"

export function useArchitectureResourceMentions() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const available = useServerArchitectureAvailable()
  const [resources, actions] = createResource(
    () => (available() === true ? { api: serverSDK().currentApi, directory: sdk().directory } : undefined),
    (input) => listArchitectureResources(input.api, input.directory).catch(() => []),
  )
  createEffect(() => {
    const current = sdk()
    if (available() !== true) return
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      if (String(event.type).startsWith("architecture.resource.")) void actions.refetch()
    })
    onCleanup(unsubscribe)
  })
  return resources
}
