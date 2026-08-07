import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
  OpenCode,
  type AgentApi,
  type CatalogApi,
  type CommandApi,
  type FileFindInput,
  type FileFindOutput,
  type FileDiffInfo,
  type FileListInput,
  type FileListOutput,
  type McpListInput,
  type McpListOutput,
  type McpResourceCatalogInput,
  type McpResourceCatalogOutput,
  type McpResource,
  type McpServer,
  type ProjectCurrentInput,
  type ProjectCurrentOutput,
  type ProjectListOutput,
  type ProviderListOutput,
  type QuestionRejectInput,
  type QuestionRejectOutput,
  type QuestionReplyInput,
  type QuestionReplyOutput,
  type QuestionRequestListInput,
  type QuestionRequestListOutput,
  type ReferenceApi,
  type SessionApi,
  type SessionCommandInput,
  type SessionMessageInfo,
  type SessionPromptInput,
} from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

type CurrentApi = ReturnType<typeof OpenCode.make>
type CurrentSdk = ReturnType<typeof createSdkForServer>
type RequestOptions = { readonly signal?: AbortSignal; readonly headers?: HeadersInit }
type LocationInput = { readonly location?: { readonly directory?: string; readonly workspace?: string } }

export type ServerApi = CatalogApi & {
  readonly architecture: CurrentApi["architecture"]
  readonly event: { readonly subscribe: CurrentApi["events"]["subscribe"] }
  readonly session: SessionApi
  readonly message: { readonly list: (input: { readonly sessionID: string; readonly limit?: number; readonly order?: "asc" | "desc"; readonly cursor?: string }, options?: RequestOptions) => Promise<{ readonly data: ReadonlyArray<SessionMessageInfo>; readonly cursor: { readonly previous?: string | null; readonly next?: string | null } }> }
  readonly file: { readonly list: (input?: FileListInput, options?: RequestOptions) => Promise<FileListOutput>; readonly find: (input: FileFindInput, options?: RequestOptions) => Promise<FileFindOutput> }
  readonly project: { readonly list: () => Promise<ProjectListOutput>; readonly current: (input?: ProjectCurrentInput) => Promise<ProjectCurrentOutput>; readonly directories: (input: { readonly projectID: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }) => Promise<ReadonlyArray<{ readonly directory: string }>> }
  readonly integration: {
    readonly get: CurrentApi["integrations"]["get"]
    readonly connect: { readonly key: CurrentApi["integrations"]["connectKey"] }
    readonly oauth: { readonly connect: CurrentApi["integrations"]["connectOauth"]; readonly complete: (input: { readonly integrationID?: string; readonly attemptID: string; readonly code?: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<void>; readonly status: (input: { readonly integrationID?: string; readonly attemptID: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => ReturnType<CurrentApi["integrations"]["attemptStatus"]>; readonly cancel: CurrentApi["integrations"]["attemptCancel"] }
  }
  readonly permission: CurrentSdk["permission"] & { readonly request: { readonly list: (input?: LocationInput, options?: RequestOptions) => ReturnType<CurrentApi["permissions"]["listRequests"]> }; readonly reply: (input: { readonly sessionID: string; readonly requestID: string; readonly reply: "once" | "always" | "reject"; readonly message?: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<void> }
  readonly question: CurrentSdk["question"] & { readonly request: { readonly list: (input?: QuestionRequestListInput, options?: RequestOptions) => Promise<QuestionRequestListOutput> }; readonly reply: (input: QuestionReplyInput, options?: RequestOptions) => Promise<QuestionReplyOutput>; readonly reject: (input: QuestionRejectInput, options?: RequestOptions) => Promise<QuestionRejectOutput> }
  readonly mcp: Omit<CurrentSdk["mcp"], "connect" | "disconnect"> & { readonly connect: (input: { readonly server: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<void>; readonly disconnect: (input: { readonly server: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<void>; readonly list: (input?: McpListInput, options?: RequestOptions) => Promise<McpListOutput>; readonly resource: { readonly catalog: (input?: McpResourceCatalogInput, options?: RequestOptions) => Promise<McpResourceCatalogOutput> } }
  readonly vcs: Omit<CurrentSdk["vcs"], "status" | "diff"> & { readonly status: (input?: { readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<{ readonly data: FileDiffInfo[] }>; readonly diff: (input: { readonly location?: { readonly directory?: string; readonly workspace?: string }; readonly mode?: "branch" | "working" | "git"; readonly context?: number }, options?: RequestOptions) => Promise<{ readonly data: FileDiffInfo[] }> }
  readonly pty: { readonly list: CurrentSdk["v2"]["pty"]["list"]; readonly create: (input?: { readonly location?: { readonly directory?: string; readonly workspace?: string }; readonly title?: string; readonly command?: string; readonly args?: ReadonlyArray<string>; readonly cwd?: string; readonly env?: Record<string, string> }, options?: RequestOptions) => Promise<{ readonly data: { readonly id: string; readonly title?: string; readonly status?: string } }>; readonly get: (input: { readonly ptyID: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => Promise<{ readonly data: { readonly id: string; readonly title?: string; readonly status: string } }>; readonly update: CurrentSdk["v2"]["pty"]["update"]; readonly remove: CurrentSdk["v2"]["pty"]["remove"] }
}

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerApi {
  const sdk = createSdkForServer({ server: input.server, fetch: input.fetch, throwOnError: true })
  const current = OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })

  return ({
    architecture: current.architecture,
    event: { subscribe: current.events.subscribe },
    agent: {
      list: async (value?: LocationInput, options?: RequestOptions) => {
        const result = await current.agents.list(value, options)
        return {
          ...result,
          data: result.data.map((agent) => ({
            ...agent,
            request: { ...agent.request, settings: agent.request.body },
          })),
        }
      },
    },
    command: current.commands,
    model: {
      list: async (value?: LocationInput, options?: RequestOptions) => {
        const result = await current.models.list(value, options)
        return {
          ...result,
          data: result.data.map((model) => ({
            ...model,
            modelID: model.api.id,
            package: model.api.type === "aisdk" ? model.api.package : undefined,
            settings: model.request.body,
            headers: model.request.headers,
            variants: model.variants.map((variant) => ({ ...variant, settings: variant.body })),
          })),
        }
      },
      default: async (_value?: LocationInput, _options?: RequestOptions) => ({ location: { directory: "", project: { id: "", directory: "" } }, data: undefined }),
    },
    provider: {
      list: async (value?: LocationInput, options?: RequestOptions): Promise<ProviderListOutput> => {
        const result = await current.providers.list(value, options)
        return {
          ...result,
          data: result.data.map((provider) => ({ ...provider, settings: provider.request.body })),
        }
      },
    },
    reference: current.references,
    session: {
      list: current.sessions.list,
      create: current.sessions.create,
      get: current.sessions.get,
      active: current.sessions.active,
      message: current.sessions.message,
      prompt: (value: SessionPromptInput) =>
        current.sessions.prompt({
          sessionID: value.sessionID,
          id: value.id,
          prompt: {
            type: "user",
            text: value.text,
            files: value.files?.map((file) => ({ uri: file.uri, name: file.name, source: file.mention })),
            agents: value.agents?.map((agent) => ({ name: agent.name, source: agent.mention })),
          },
          delivery: value.delivery,
          resume: value.resume,
        } as unknown as Parameters<typeof current.sessions.prompt>[0]),
      compact: current.sessions.compact,
      interrupt: current.sessions.interrupt,
      revert: { stage: current.sessions.stage, clear: current.sessions.clear, commit: current.sessions.commit },
      rename: async (value: { readonly sessionID: string; readonly title: string; readonly directory?: string }) => {
        await sdk.session.update({ sessionID: value.sessionID, title: value.title, directory: value.directory })
      },
      remove: async (value: { readonly sessionID: string; readonly directory?: string }) => {
        await sdk.session.delete({ sessionID: value.sessionID, directory: value.directory })
      },
      fork: async (value: { readonly sessionID: string; readonly messageID?: string }) => (await sdk.session.fork(value, { throwOnError: true })).data,
      command: async (value: SessionCommandInput) =>
        current.sessions.prompt({
          sessionID: value.sessionID,
          id: value.id,
          prompt: {
            type: "command",
            command: value.command,
            arguments: value.arguments ?? "",
            files: value.files?.map((file) => ({ uri: file.uri, name: file.name, source: file.mention })),
          },
          delivery: value.delivery,
          resume: value.resume,
        } as unknown as Parameters<typeof current.sessions.prompt>[0]),
      shell: (value: { readonly sessionID: string; readonly command: string; readonly agent?: string; readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string } }) => sdk.session.shell(value, { throwOnError: true }).then(() => undefined),
    },
    message: { list: current.messages.list as ServerApi["message"]["list"] },
    file: { list: current.files.list, find: current.files.find },
    project: {
      list: async () => (await sdk.project.list(undefined, { throwOnError: true })).data ?? [],
      current: async (value?: ProjectCurrentInput) => {
        const result = await sdk.project.current(value?.location, { throwOnError: true })
        return { id: result.data.id, directory: result.data.worktree, vcs: result.data.vcs }
      },
      directories: async (value: { readonly projectID: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }) => (await sdk.project.directories({ projectID: value.projectID, directory: value.location?.directory, workspace: value.location?.workspace }, { throwOnError: true })).data ?? [],
    },
    integration: {
      get: current.integrations.get,
      connect: { key: current.integrations.connectKey },
      oauth: {
        connect: current.integrations.connectOauth,
        complete: (value: { readonly attemptID: string; readonly code?: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => current.integrations.attemptComplete(value, options),
        status: (value: { readonly attemptID: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }, options?: RequestOptions) => current.integrations.attemptStatus(value, options),
        cancel: current.integrations.attemptCancel,
      },
    },
    permission: Object.assign(sdk.permission, { reply: (value: { readonly sessionID: string; readonly requestID: string; readonly reply: "once" | "always" | "reject"; readonly message?: string }) => current.permissions.reply(value), request: { list: current.permissions.listRequests } }),
    question: Object.assign(sdk.question, { reply: current.questions.reply, reject: current.questions.reject, request: { list: current.questions.listRequests } }),
    mcp: Object.assign(sdk.mcp, {
      list: async (value?: McpListInput) => {
        const result = await sdk.mcp.status({ directory: value?.location?.directory, workspace: value?.location?.workspace }, { throwOnError: true })
        return { location: { directory: value?.location?.directory ?? "", project: { id: "", directory: value?.location?.directory ?? "" } }, data: Object.entries(result.data ?? {}).map(([name, status]) => ({ name, status })) as McpServer[] }
      },
      connect: async (value: { readonly server: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }) => {
        await sdk.mcp.connect({ name: value.server, directory: value.location?.directory, workspace: value.location?.workspace })
      },
      disconnect: async (value: { readonly server: string; readonly location?: { readonly directory?: string; readonly workspace?: string } }) => {
        await sdk.mcp.disconnect({ name: value.server, directory: value.location?.directory, workspace: value.location?.workspace })
      },
      resource: {
        catalog: async (value?: McpResourceCatalogInput) => {
          const result = await sdk.experimental.resource.list({ directory: value?.location?.directory, workspace: value?.location?.workspace }, { throwOnError: true })
          return { location: { directory: value?.location?.directory ?? "", project: { id: "", directory: value?.location?.directory ?? "" } }, data: { resources: Object.entries(result.data ?? {}).map(([key, resource]) => ({ ...resource, server: resource.client ?? key.split(":", 1)[0] })) as McpResource[] } }
        },
      },
    }),
    vcs: Object.assign(sdk.vcs, {
      status: (value?: { readonly location?: { readonly directory?: string; readonly workspace?: string } }) => sdk.vcs.status({ directory: value?.location?.directory, workspace: value?.location?.workspace }, { throwOnError: true }),
      diff: (value: { readonly location?: { readonly directory?: string; readonly workspace?: string }; readonly mode?: "branch" | "working" | "git"; readonly context?: number }) => sdk.vcs.diff({ directory: value.location?.directory, workspace: value.location?.workspace, mode: value.mode === "working" ? "git" : (value.mode ?? "git"), context: value.context }, { throwOnError: true }),
    }),
    pty: Object.assign(sdk.v2.pty, {
      create: async (value?: { readonly location?: { readonly directory?: string; readonly workspace?: string }; readonly title?: string; readonly command?: string; readonly args?: ReadonlyArray<string>; readonly cwd?: string; readonly env?: Record<string, string> }) => {
        const result = await sdk.v2.pty.create(value && { ...value, args: value.args ? [...value.args] : undefined }, { throwOnError: true })
        return "data" in result && result.data && "data" in result.data ? { data: result.data.data } : result
      },
    }),
  }) as unknown as ServerApi
}
