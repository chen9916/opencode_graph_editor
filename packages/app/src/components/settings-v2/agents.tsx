import type { Agent } from "@opencode-ai/sdk/v2/client"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { createMemo, createResource, type Accessor, type Component, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { normalizeAgentList } from "@/context/global-sync/utils"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type AgentItem = Agent
type ModelKey = { providerID: string; modelID: string }
type ModelOption =
  | { kind: "default"; id: "default"; label: string; group: string }
  | { kind: "model"; id: string; providerID: string; modelID: string; providerName: string; label: string; group: string }

const DEFAULT_OPTION_ID = "default"
const PROVIDER_ICON_SIZE = 16

export const SettingsAgentsV2: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const protocol = useServerProtocol()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const [saving, setSaving] = createStore<Record<string, boolean>>({})

  const directoryStore = createMemo(() => {
    const directory = props.directory()
    if (!directory) return
    return serverSync().child(directory)[0]
  })

  const [globalAgents] = createResource(
    () => (props.directory() ? undefined : serverSdk().scope),
    async (scope) => {
      if (!scope) return []
      if ((await serverSdk().protocol) === "v1") return normalizeAgentList((await serverSdk().client.app.agents()).data ?? [])
      return normalizeAgentList((await serverSdk().api.agent.list()).data)
    },
    { initialValue: [] as AgentItem[] },
  )

  const agents = createMemo(() => {
    const items = props.directory() ? (directoryStore()?.agent ?? []) : globalAgents()
    return items
      .filter((agent) => !agent.hidden)
      .slice()
      .sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || a.name.localeCompare(b.name))
  })

  const selectedModel = (agent: AgentItem) => {
    const configured = serverSync().data.config.agent?.[agent.name]
    if (configured && Object.hasOwn(configured, "model")) return parseModel(configured.model)
    return agent.model
  }

  const configuredModels = createMemo(() => {
    const seen = new Set<string>()
    return agents().flatMap((agent) => {
      const model = selectedModel(agent)
      if (!model) return []
      const key = `${model.providerID}/${model.modelID}`
      if (seen.has(key)) return []
      seen.add(key)
      return [model]
    })
  })

  const modelOptions = createMemo<ModelOption[]>(() => {
    const defaultOption: ModelOption = {
      kind: "default",
      id: DEFAULT_OPTION_ID,
      label: language.t("settings.agents.model.default"),
      group: language.t("common.default"),
    }
    const available = models
      .list()
      .map((model) => ({
        kind: "model" as const,
        id: `${model.provider.id}/${model.id}`,
        providerID: model.provider.id,
        modelID: model.id,
        providerName: model.provider.name,
        label: model.name,
        group: model.provider.name,
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.label.localeCompare(b.label))
    const availableIDs = new Set(available.map((model) => model.id))
    const unavailable = configuredModels()
      .filter((model) => !availableIDs.has(`${model.providerID}/${model.modelID}`))
      .map((model) => ({
        kind: "model" as const,
        id: `${model.providerID}/${model.modelID}`,
        providerID: model.providerID,
        modelID: model.modelID,
        providerName: model.providerID,
        label: `${model.modelID} (${language.t("settings.agents.model.unavailable")})`,
        group: model.providerID,
      }))
    return [defaultOption, ...available, ...unavailable]
  })

  const currentOption = (agent: AgentItem) => {
    const model = selectedModel(agent)
    if (!model) return modelOptions()[0]
    return modelOptions().find((option) => option.id === `${model.providerID}/${model.modelID}`)
  }

  const updateAgentModel = async (agent: AgentItem, option: ModelOption | null) => {
    if (protocol() !== "v1") return
    if (!option) return
    const before = serverSync().data.config.agent ?? {}
    const model = option.kind === "model" ? `${option.providerID}/${option.modelID}` : undefined
    const next = {
      ...before,
      [agent.name]: {
        ...(before[agent.name] ?? {}),
        model,
      },
    }
    setSaving(agent.name, true)
    serverSync().set("config", "agent", next)
    await serverSync()
      .updateConfig({ agent: { [agent.name]: { model } } })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.agents.toast.updated.title"),
          description: language.t("settings.agents.toast.updated.description", { agent: agent.name }),
        })
      })
      .catch((error: unknown) => {
        serverSync().set("config", "agent", before)
        showToast({
          variant: "error",
          title: language.t("settings.agents.toast.updateFailed.title"),
          description: formatServerError(error, language.t),
        })
      })
      .finally(() => setSaving(agent.name, false))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.agents.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-agents">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.agents.section.defaults")}</h3>
          <Show
            when={protocol() === "v1"}
            fallback={<div class="settings-v2-agent-empty">{language.t("settings.agents.unsupported")}</div>}
          >
            <SettingsListV2>
              <Show
                when={agents().length > 0}
                fallback={<div class="settings-v2-agent-empty">{language.t("settings.agents.empty")}</div>}
              >
                <For each={agents()}>
                  {(agent) => (
                    <SettingsRowV2
                      title={
                        <span class="settings-v2-agent-title">
                          <span>{agent.name}</span>
                          <Tag>{modeLabel(language.t, agent.mode)}</Tag>
                        </span>
                      }
                      description={agent.description ?? language.t("settings.agents.row.description")}
                    >
                      <div class="settings-v2-agent-controls">
                        <SelectV2
                          appearance="inline"
                          data-action={`settings-agent-model-${agent.name}`}
                          options={modelOptions()}
                          current={currentOption(agent)}
                          value={(option) => option.id}
                          label={(option) => option.label}
                          groupBy={(option) => option.group}
                          placeholder={language.t("settings.agents.model.select.placeholder")}
                          disabled={saving[agent.name]}
                          placement="bottom-end"
                          gutter={6}
                          valueClass="settings-v2-agent-model-value"
                          onSelect={(option) => void updateAgentModel(agent, option)}
                        >
                          {(option) => (
                            <span class="settings-v2-agent-model-option">
                              <Show when={option.kind === "model"}>
                                <ProviderIcon
                                  id={(option as Extract<ModelOption, { kind: "model" }>).providerID}
                                  width={PROVIDER_ICON_SIZE}
                                  height={PROVIDER_ICON_SIZE}
                                  class="settings-v2-agent-model-icon"
                                />
                              </Show>
                              <span>{option.label}</span>
                            </span>
                          )}
                        </SelectV2>
                        <Show when={selectedModel(agent)}>
                          <ButtonV2
                            size="normal"
                            variant="ghost-muted"
                            disabled={saving[agent.name]}
                            onClick={() => void updateAgentModel(agent, modelOptions()[0])}
                          >
                            {language.t("common.clear")}
                          </ButtonV2>
                        </Show>
                      </div>
                    </SettingsRowV2>
                  )}
                </For>
              </Show>
            </SettingsListV2>
          </Show>
        </div>
      </div>
    </>
  )
}

function modeRank(mode: AgentItem["mode"]) {
  if (mode === "primary") return 0
  if (mode === "subagent") return 1
  return 2
}

function parseModel(value: string | undefined): ModelKey | undefined {
  if (!value) return
  const separator = value.indexOf("/")
  if (separator === -1) return
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  }
}

function modeLabel(t: (key: string) => string, mode: AgentItem["mode"]) {
  if (mode === "primary") return t("settings.agents.mode.primary")
  if (mode === "subagent") return t("settings.agents.mode.subagent")
  return t("settings.agents.mode.all")
}
