import { afterAll, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import path from "path"
import { TestLLMServer } from "../../lib/llm-server"
import { callAuthProbe, disposeApps } from "./backend"
import { http } from "./dsl"
import { cleanupExercisePaths } from "./environment"
import { runScenario, withScenarioContext } from "./runner"
import type { Options } from "./types"

const options: Options = {
  mode: "auth",
  include: undefined,
  startAt: undefined,
  stopAt: undefined,
  failOnMissing: false,
  failOnSkip: false,
  scenarioTimeout: Duration.fromInputUnsafe("30 seconds"),
  progress: false,
  trace: false,
}

afterAll(async () => {
  await disposeApps()
  await Effect.runPromise(cleanupExercisePaths)
})

test("isolates auth-mode architecture reset probes from cwd", async () => {
  const key = `isolation${Date.now()}${Math.random().toString(36).slice(2)}`
  const resourceID = `auth_${key}`
  const scenario = http.protected
    .post(`/api/architecture/resource/{${key}}/reset`, "architecture.reset.auth-isolation")
    .inProject({ git: false })
    .mutating()
    .status(200)
  const cwdResource = path.join(process.cwd(), ".opencode", "architecture", "resources", `${resourceID}.json`)
  let directory: string | undefined

  expect(await Bun.file(cwdResource).exists()).toBe(false)

  await Effect.runPromise(
    withScenarioContext(
      options,
      scenario,
      "auth regression",
      (ctx) =>
        Effect.gen(function* () {
          directory = ctx.directory
          const missing = yield* callAuthProbe(scenario, ctx, "missing")
          const valid = yield* callAuthProbe(scenario, ctx, "valid")

          expect(missing.status).toBe(401)
          expect(valid.status).toBe(200)
          expect(ctx.directory).toBeDefined()
          expect(
            yield* Effect.promise(() =>
              Bun.file(
                path.join(ctx.directory!, ".opencode", "architecture", "resources", `${resourceID}.json`),
              ).exists(),
            ),
          ).toBe(true)
          expect(yield* Effect.promise(() => Bun.file(cwdResource).exists())).toBe(false)
        }),
      false,
    ).pipe(Effect.provide(TestLLMServer.layer), Effect.scoped),
  )

  expect(directory).toBeDefined()
  expect(await Bun.file(directory!).exists()).toBe(false)
  expect(await Bun.file(cwdResource).exists()).toBe(false)

  const result = await Effect.runPromise(runScenario(options)(scenario).pipe(Effect.provide(TestLLMServer.layer)))
  expect(result.status).toBe("pass")
  expect(await Bun.file(cwdResource).exists()).toBe(false)
})
