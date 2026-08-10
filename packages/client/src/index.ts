export * from "./generated/index"

import { OpenCode } from "./generated/index"
import type { ArchitectureGetResourceOutput, EventsSubscribeOutput, JsonValue } from "./generated/types"

type LocationInput = { readonly location?: { readonly directory?: string; readonly workspace?: string } }
type Located<T> = {
  readonly location: { readonly directory: string; readonly workspaceID?: string; readonly project: ProjectCurrent }
  readonly data: T
}
type RequestOptions = { readonly signal?: AbortSignal; readonly headers?: HeadersInit }

export type OpenCodeClient = ReturnType<typeof OpenCode.make>
export type OpenCodeEvent = any
export type HealthGetOutput = { readonly healthy: true; readonly version?: string }

export type AgentListInput = LocationInput
export type AgentListOutput = Located<
  Array<{
    readonly id: string
    readonly name?: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
    readonly request: { readonly headers?: Record<string, string>; readonly body?: Record<string, JsonValue>; readonly settings: Record<string, JsonValue> }
    readonly system?: string
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps?: number
    readonly permissions: ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
  }>
>
export type AgentApi = { readonly list: (input?: AgentListInput, options?: RequestOptions) => Promise<AgentListOutput> }

export type CommandInfo = {
  readonly name: string
  readonly template: string
  readonly description?: string
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly id: string; readonly variant?: string }
  readonly subtask?: boolean
}
export type CommandListInput = LocationInput
export type CommandListOutput = Located<CommandInfo[]>
export type CommandApi = { readonly list: (input?: CommandListInput, options?: RequestOptions) => Promise<CommandListOutput> }

export type FileDiffInfo = {
  readonly file: string
  readonly patch: string
  readonly additions: number
  readonly deletions: number
  readonly status?: "added" | "deleted" | "modified"
}

export type IntegrationMethod =
  | { readonly id: string; readonly type: "oauth"; readonly label: string; readonly prompts?: ReadonlyArray<IntegrationPrompt> }
  | { readonly type: "key"; readonly label?: string }
  | { readonly type: "env"; readonly names: ReadonlyArray<string> }
export type IntegrationPrompt =
  | { readonly type: "text"; readonly key: string; readonly message: string; readonly placeholder?: string; readonly when?: IntegrationPromptWhen }
  | {
      readonly type: "select"
      readonly key: string
      readonly message: string
      readonly options: Array<{ readonly label: string; readonly value: string; readonly hint?: string }>
      readonly when?: IntegrationPromptWhen
    }
type IntegrationPromptWhen = { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
export type IntegrationOauthConnectOutput = Located<{
  readonly attemptID: string
  readonly url: string
  readonly instructions: string
  readonly mode: "auto" | "code"
  readonly time: { readonly created: number | string; readonly expires: number | string }
}>

export type McpStatus = "connected" | "needs_auth" | "disabled" | "failed" | "needs_client_registration" | "pending"
export type McpServer = { readonly name: string; readonly status: { readonly status: McpStatus; readonly message?: string; readonly error?: string } }
export type McpResource = { readonly server: string; readonly uri: string; readonly name: string; readonly description?: string; readonly mime?: string; readonly mimeType?: string }
export type McpListInput = LocationInput
export type McpListOutput = Located<McpServer[]>
export type McpResourceCatalogInput = LocationInput
export type McpResourceCatalogOutput = Located<{ readonly resources: McpResource[] }>

export type ModelDefaultOutput = Located<{ readonly providerID: string; readonly id: string; readonly variant?: string } | undefined>
export type ModelListOutput = Located<
  Array<{
    readonly id: string
    readonly providerID: string
    readonly modelID: string
    readonly name: string
    readonly family?: string
    readonly package?: string
    readonly capabilities: { readonly tools: boolean; readonly input: ReadonlyArray<string>; readonly output: ReadonlyArray<string> }
    readonly cost: ReadonlyArray<{ readonly tier?: { readonly type: "context"; readonly size: number }; readonly input: number; readonly output: number; readonly cache: { readonly read: number; readonly write: number } }>
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
    readonly status: "alpha" | "beta" | "deprecated" | "active"
    readonly enabled?: boolean
    readonly settings?: Record<string, JsonValue>
    readonly headers?: Record<string, string>
    readonly variants: ReadonlyArray<{ readonly id: string; readonly settings?: Record<string, JsonValue> }>
    readonly time: { readonly released: number }
  }>
>

export type PermissionV2Request = {
  readonly id: string
  readonly sessionID: string
  readonly action: string
  readonly resources: readonly string[]
  readonly save?: readonly string[]
  readonly metadata?: Record<string, JsonValue>
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
}

export type Project = {
  readonly id: string
  readonly name?: string
  readonly directory?: string
  readonly worktree: string
  readonly vcs?: "git"
  readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
  readonly sandboxes?: ReadonlyArray<string>
  readonly time?: unknown
}
export type ProjectCurrent = { readonly id: string; readonly directory: string; readonly workspaceID?: string; readonly vcs?: "git" }
export type ProjectCurrentInput = LocationInput
export type ProjectCurrentOutput = ProjectCurrent
export type ProjectListOutput = Project[]

export type ProviderListOutput = Located<Array<{ readonly id: string; readonly name: string; readonly package?: string; readonly enabled?: boolean; readonly settings?: Record<string, JsonValue> }>>

export type QuestionRejectInput = { readonly sessionID: string; readonly requestID: string }
export type QuestionRejectOutput = void
export type QuestionReplyInput = { readonly sessionID: string; readonly requestID: string; readonly answers: ReadonlyArray<ReadonlyArray<string>> }
export type QuestionReplyOutput = void
export type QuestionRequest = { readonly id: string; readonly sessionID: string; readonly question?: string; readonly questions?: Array<{ readonly question: string; readonly header: string; readonly options: Array<{ readonly label: string; readonly description: string }>; readonly multiple?: boolean; readonly custom?: boolean }>; readonly options?: string[] }
export type QuestionRequestListInput = LocationInput
export type QuestionRequestListOutput = Located<QuestionRequest[]>

export type ReferenceListInput = LocationInput
export type ReferenceListOutput = Located<Array<{ readonly name: string; readonly source: any; readonly path: string; readonly type?: string; readonly title?: string; readonly description?: string }>>
export type ReferenceApi = { readonly list: (input?: ReferenceListInput, options?: RequestOptions) => Promise<ReferenceListOutput> }

export type FileListInput = LocationInput & { readonly path?: string }
export type FileListOutput = Located<Array<{ readonly path: string; readonly type: "file" | "directory" }>>
export type FileFindInput = LocationInput & { readonly query: string; readonly type?: "file" | "directory"; readonly limit?: number }
export type FileFindOutput = FileListOutput

export type SessionInfo = {
  readonly id: string
  readonly parentID?: string
  readonly projectID: string
  readonly agent?: string
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
  readonly cost: number
  readonly tokens: { readonly input: number; readonly output: number; readonly reasoning: number; readonly cache: { readonly read: number; readonly write: number } }
  readonly time: { readonly created: number; readonly updated: number; readonly archived?: number }
  readonly title?: string
  readonly location: { readonly directory: string; readonly workspaceID?: string; readonly project?: ProjectCurrent }
  readonly subpath?: string
  readonly revert?: { readonly messageID: string; readonly partID?: string; readonly snapshot?: string }
}
export type SessionListInput = {
  readonly workspace?: string
  readonly limit?: number
  readonly order?: "asc" | "desc"
  readonly search?: string
  readonly directory?: string
  readonly project?: string
  readonly subpath?: string
  readonly parentID?: string | null
  readonly cursor?: string
}
export type SessionListOutput = { readonly data: SessionInfo[]; readonly cursor: { readonly previous?: string | null; readonly next?: string | null } }
export type SessionActiveOutput = Record<string, { readonly type: "running" }>
type UserAdmittedInput = {
  readonly admittedSeq: number
  readonly id: string
  readonly sessionID: string
  readonly timeCreated: number
  readonly type: "user" | "compaction"
  readonly data?: { readonly text?: string }
  readonly delivery?: "steer" | "queue"
}
export type SessionPromptInput = {
  readonly sessionID: string
  readonly id?: string
  readonly text: string
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID?: string; readonly id?: string; readonly variant?: string }
  readonly variant?: string
  readonly delivery?: "steer" | "queue"
  readonly resume?: boolean
  readonly files?: ReadonlyArray<SessionPromptFile>
  readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: Mention }>
  readonly modelContext?: ReadonlyArray<SessionModelContext>
  readonly legacyParts?: ReadonlyArray<unknown>
}
export type SessionPromptOutput = UserAdmittedInput
export type SessionCommandInput = Omit<SessionPromptInput, "text"> & { readonly text?: string; readonly command: string; readonly arguments?: string; readonly agent?: string; readonly model?: { readonly providerID: string; readonly id?: string; readonly modelID?: string; readonly variant?: string } }
export type SessionCommandOutput = UserAdmittedInput
export type SessionShellInput = { readonly sessionID: string; readonly id?: string; readonly command: string; readonly agent?: string; readonly model?: { readonly providerID: string; readonly modelID?: string; readonly id?: string; readonly variant?: string } }
export type SessionShellOutput = void
export type SessionCompactInput = { readonly sessionID: string; readonly id?: string; readonly model?: { readonly providerID: string; readonly modelID?: string; readonly id?: string; readonly variant?: string } }
export type SessionCompactOutput = UserAdmittedInput | void
export type SessionApi = {
  readonly list: (input?: SessionListInput, options?: RequestOptions) => Promise<SessionListOutput>
  readonly create: (input?: { readonly id?: string; readonly location?: { readonly directory?: string; readonly workspace?: string }; readonly agent?: string; readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } }) => Promise<SessionInfo>
  readonly get: (input: { readonly sessionID: string }) => Promise<SessionInfo>
  readonly active: () => Promise<SessionActiveOutput>
  readonly prompt: (input: SessionPromptInput) => Promise<SessionPromptOutput>
  readonly command: (input: SessionCommandInput) => Promise<SessionCommandOutput>
  readonly shell: (input: SessionShellInput) => Promise<SessionShellOutput>
  readonly compact: (input: SessionCompactInput) => Promise<SessionCompactOutput>
  readonly rename: (input: { readonly sessionID: string; readonly title: string; readonly directory?: string }) => Promise<void>
  readonly remove: (input: { readonly sessionID: string; readonly directory?: string }) => Promise<void>
  readonly fork: (input: { readonly sessionID: string; readonly messageID?: string }) => Promise<SessionInfo>
  readonly interrupt: (input: { readonly sessionID: string }) => Promise<void>
  readonly message: (input: { readonly sessionID: string; readonly messageID: string }) => Promise<SessionMessageInfo>
  readonly revert: { readonly stage: (input: { readonly sessionID: string; readonly messageID: string; readonly files?: ReadonlyArray<string> }) => Promise<{ readonly messageID: string }>; readonly clear: (input: { readonly sessionID: string }) => Promise<void>; readonly commit: (input: { readonly sessionID: string }) => Promise<void> }
}

export type Mention = { readonly text: string; readonly start: number; readonly end: number }
export type SessionPromptFile = { readonly uri: string; readonly mime?: string; readonly name?: string; readonly mention?: Mention; readonly source?: { readonly type: "uri"; readonly uri: string } | { readonly type: "data" } | { readonly type: "inline" }; readonly data?: string }
export type SessionMessageFile = { readonly uri?: string; readonly mime: string; readonly name?: string; readonly mention?: Mention; readonly source: { readonly type: "uri"; readonly uri: string } | { readonly type: "data" } | { readonly type: "inline" }; readonly data?: string }
export type SessionModelContext = { readonly text: string; readonly description?: string; readonly metadata?: Record<string, JsonValue> }
type MessageBase = { readonly id: string; readonly metadata?: Record<string, JsonValue>; readonly time: { readonly created: number; readonly completed?: number } }
export type SessionMessageAgent = MessageBase & { readonly type: "agent-switched"; readonly agent: string }
export type SessionMessageModel = MessageBase & { readonly type: "model-switched"; readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }; readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string } }
export type SessionMessageUser = MessageBase & { readonly type: "user"; readonly text: string; readonly files?: ReadonlyArray<SessionMessageFile>; readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: Mention }>; readonly modelContext?: ReadonlyArray<SessionModelContext> }
export type SessionMessageSynthetic = MessageBase & { readonly type: "synthetic"; readonly text: string; readonly description?: string }
export type SessionMessageShell = MessageBase & { readonly type: "shell"; readonly shellID: string; readonly command: string; readonly status: "running" | "completed" | "error" | "exited"; readonly exit?: number; readonly output?: { readonly output: string; readonly cursor?: number; readonly size?: number; readonly truncated?: boolean } }
export type SessionMessageAssistantTool = {
  readonly type: "tool"
  readonly id: string
  readonly name: string
  readonly executed?: boolean
  readonly providerState?: JsonValue
  readonly providerResultState?: JsonValue
  readonly state:
    | { readonly status: "streaming"; readonly input: string }
    | { readonly status: "running"; readonly input: Record<string, unknown>; readonly metadata?: Record<string, unknown> }
    | { readonly status: "completed"; readonly input: Record<string, unknown>; readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string } | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }>; readonly metadata?: Record<string, unknown> }
    | { readonly status: "error"; readonly input: Record<string, unknown>; readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string } | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }>; readonly error: { readonly type: string; readonly message: string }; readonly metadata?: Record<string, unknown> }
  readonly time: { readonly created: number; readonly ran?: number; readonly completed?: number; readonly pruned?: number }
}
type AssistantContent = { readonly type: "text"; readonly text: string } | { readonly type: "reasoning"; readonly text: string; readonly state?: Record<string, unknown>; readonly time?: { readonly created: number; readonly completed?: number } } | SessionMessageAssistantTool
export type SessionMessageAssistant = MessageBase & { readonly type: "assistant"; readonly agent: string; readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }; readonly content: ReadonlyArray<AssistantContent>; readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }; readonly finish?: string; readonly retry?: { readonly attempt: number; readonly at: number; readonly error?: { readonly type: string; readonly message: string } }; readonly cost?: number; readonly tokens?: SessionInfo["tokens"]; readonly error?: { readonly type: string; readonly message: string } }
export type SessionMessageCompaction = MessageBase & ({ readonly type: "compaction"; readonly status?: "completed"; readonly reason: "auto" | "manual"; readonly summary: string; readonly recent: string } | { readonly type: "compaction"; readonly status: "running"; readonly reason: "auto" | "manual"; readonly summary: string; readonly recent: string } | { readonly type: "compaction"; readonly status: "failed"; readonly reason: "auto" | "manual"; readonly error: { readonly type: string; readonly message: string } })
export type SessionMessageSkill = MessageBase & { readonly type: "skill"; readonly skill: string; readonly name: string; readonly text: string }
export type SessionMessageInfo = SessionMessageAgent | SessionMessageModel | SessionMessageUser | SessionMessageSynthetic | SessionMessageShell | SessionMessageAssistant | SessionMessageCompaction | SessionMessageSkill
export type SessionPendingMessage =
  | { readonly type: "user"; readonly data: { readonly metadata?: Record<string, JsonValue>; readonly text: string; readonly files?: ReadonlyArray<SessionMessageFile>; readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: Mention }>; readonly modelContext?: ReadonlyArray<SessionModelContext> } }
  | { readonly type: "synthetic"; readonly data: { readonly metadata?: Record<string, JsonValue>; readonly text: string; readonly description?: string } }

export type Json = JsonValue
export type CatalogApi = {
  readonly agent: AgentApi
  readonly command: CommandApi
  readonly model: { readonly list: (input?: LocationInput) => Promise<ModelListOutput>; readonly default: (input?: LocationInput) => Promise<ModelDefaultOutput> }
  readonly provider: { readonly list: (input?: LocationInput) => Promise<ProviderListOutput> }
  readonly reference: ReferenceApi
}
export type ArchitectureOutput = ArchitectureGetResourceOutput
