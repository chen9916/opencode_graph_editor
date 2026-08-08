import { createEffect, onCleanup } from "solid-js"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { useSDK } from "@/context/sdk"
import { useServerArchitectureAvailable, useServerSDK } from "@/context/server-sdk"
import { architectureResourcesQueryKey, listArchitectureResources } from "./api"
import { architectureResourceEventInfo, architectureSummaryMatchesEvent, isArchitectureLocalSaveEvent } from "./event"

export function useArchitectureResourceMentions() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const available = useServerArchitectureAvailable()
  const queryClient = useQueryClient()
  const resources = createQuery(() => ({
    queryKey: architectureResourcesQueryKey(sdk().url, sdk().directory),
    enabled: available() === true,
    queryFn: ({ signal }) => listArchitectureResources(serverSDK().currentApi, sdk().directory, signal).catch(() => []),
  }))
  createEffect(() => {
    const current = sdk()
    if (available() !== true) return
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      const eventInfo = architectureResourceEventInfo({ type: String(event.type), properties: event.properties })
      if (!eventInfo) return
      const queryKey = architectureResourcesQueryKey(current.url, current.directory)
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (isArchitectureLocalSaveEvent({ server: current.url, directory: current.directory, event: eventInfo })) return
        if (event.type !== "architecture.resource.removed" && architectureSummaryMatchesEvent(resources.data, eventInfo))
          return
        void queryClient.refetchQueries({ queryKey, exact: true, type: "active" })
      }, 50)
      timers.add(timer)
    })
    onCleanup(() => {
      unsubscribe()
      timers.forEach(clearTimeout)
    })
  })
  return () => resources.data
}
