import { describe, expect, test } from "bun:test"
import { detectServerArchitecture, detectServerProtocol } from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect }) as typeof globalThis.fetch

describe("detectServerProtocol", () => {
  test("keeps combined servers on V1 session behavior", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      if (path === "/api/architecture/resource") return Promise.resolve(json({ data: [] }))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
    expect(await detectServerArchitecture(server, fetcher)).toBe(true)
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the transitional V1 API health response", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })
})

describe("detectServerArchitecture", () => {
  test("rejects a legacy HTML catch-all", async () => {
    const fetcher = mockFetch(() =>
      Promise.resolve(new Response("<!doctype html>", { status: 404, headers: { "content-type": "text/html" } })),
    )

    expect(await detectServerArchitecture(server, fetcher)).toBe(false)
  })

  test("recognizes typed Architecture errors as route support", async () => {
    const fetcher = mockFetch(() =>
      Promise.resolve(json({ _tag: "ArchitectureUnavailableError", message: "Location unavailable" }, 503)),
    )

    expect(await detectServerArchitecture(server, fetcher)).toBe(true)
  })

  test("uses configured server authentication", async () => {
    const authorization: Array<string | null> = []
    const fetcher = mockFetch((_input, init) => {
      authorization.push(new Headers(init?.headers).get("authorization"))
      return Promise.resolve(json({ data: [] }))
    })

    expect(
      await detectServerArchitecture(
        { ...server, username: "alice", password: "secret" },
        fetcher,
      ),
    ).toBe(true)
    expect(authorization[0]).toBe(`Basic ${btoa("alice:secret")}`)
  })
})
