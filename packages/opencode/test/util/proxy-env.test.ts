import { afterEach, describe, expect, test } from "bun:test"
import { ProxyEnv } from "@/util/proxy-env"

const originalEnv = new Map<string, string | undefined>()

function setEnv(key: string, value: string) {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key])
  process.env[key] = value
}

function removeEnv(key: string) {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key])
  delete process.env[key]
}

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
})

describe("ProxyEnv.getProxyForUrl", () => {
  test("uses configured proxy before environment proxy", () => {
    setEnv("HTTPS_PROXY", "http://env-proxy:7890")

    expect(ProxyEnv.getProxyForUrl("https://api.example.com/v1", { proxy: "http://local-proxy:7890" })).toBe(
      "http://local-proxy:7890",
    )
  })

  test("false configured proxy disables environment proxy", () => {
    setEnv("HTTPS_PROXY", "http://env-proxy:7890")

    expect(ProxyEnv.getProxyForUrl("https://api.example.com/v1", { proxy: false })).toBeUndefined()
  })

  test("falls back to environment proxy", () => {
    setEnv("HTTPS_PROXY", "env-proxy:7890")

    expect(ProxyEnv.getProxyForUrl("https://api.example.com/v1")).toBe("https://env-proxy:7890")
  })

  test("uses configured noProxy exclusions", () => {
    setEnv("HTTPS_PROXY", "http://env-proxy:7890")
    setEnv("NO_PROXY", "")

    expect(
      ProxyEnv.getProxyForUrl("https://api.example.com/v1", {
        proxy: "http://local-proxy:7890",
        noProxy: [".example.com"],
      }),
    ).toBeUndefined()
  })

  test("configured noProxy overrides environment exclusions", () => {
    setEnv("HTTPS_PROXY", "http://env-proxy:7890")
    setEnv("NO_PROXY", ".example.com")

    expect(
      ProxyEnv.getProxyForUrl("https://api.example.com/v1", {
        proxy: "http://local-proxy:7890",
        noProxy: ["localhost"],
      }),
    ).toBe("http://local-proxy:7890")
  })

  test("all_proxy environment fallback still works", () => {
    removeEnv("HTTPS_PROXY")
    removeEnv("https_proxy")
    setEnv("ALL_PROXY", "socks5://127.0.0.1:1080")

    expect(ProxyEnv.getProxyForUrl("https://api.example.com/v1")).toBe("socks5://127.0.0.1:1080")
  })
})
