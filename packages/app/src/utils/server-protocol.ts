import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}

export async function detectServerArchitecture(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
) {
  const response = await fetch(new URL("/api/architecture/resource", server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)
  if (!response?.headers.get("content-type")?.includes("application/json")) return false

  const value: unknown = await response.json().catch(() => undefined)
  if (!value || typeof value !== "object") return false
  if ("_tag" in value && typeof value._tag === "string" && value._tag.startsWith("Architecture")) return true
  if (!response.ok || !("data" in value)) return false
  return Array.isArray(value.data)
}
