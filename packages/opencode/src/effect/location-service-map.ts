import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Effect, Layer, ManagedRuntime } from "effect"

// Location entries expire independently; the owning map intentionally lives
// for the process so every in-process runtime resolves the same live services.
const runtime = ManagedRuntime.make(locationServiceMapLayer)
const service = Effect.promise(() => runtime.runPromise(LocationServiceMap.Service))

export const layer = Layer.effect(
  LocationServiceMap.Service,
  service,
)

export const dispose = () => runtime.dispose()

export * as ProcessLocationServiceMap from "./location-service-map"
