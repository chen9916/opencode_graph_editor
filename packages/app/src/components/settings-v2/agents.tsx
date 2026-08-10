import type { Agent } from "@opencode-ai/sdk/v2/client"
import { createEventListener } from "@solid-primitives/event-listener"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createEffect, createMemo, createResource, type Accessor, type Component, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { normalizeAgentList } from "@/context/global-sync/utils"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { createMenuDismissController } from "@/utils/menu-dismiss-controller"
import { handleDocumentSearchKeydown } from "@/utils/search-keydown"
import { matchesModelSearch } from "../dialog-select-model-search"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type AgentItem = Agent
type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelKey = { providerID: string; modelID: string }
type ModelOption =
  | { kind: "default"; id: "default"; label: string; group: string }
  | { kind: "model"; id: string; providerID: string; modelID: string; providerName: string; label: string; group: string }

const DEFAULT_OPTION_ID = "default"
const PROVIDER_ICON_SIZE = 16

export const SettingsAgentsV2: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const models = useModels()
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
    if (agent.model) return agent.model
    const configured = serverSync().data.config.agent?.[agent.name]
    if (configured && Object.hasOwn(configured, "model")) return parseModel(configured.model)
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
    const connected = models
      .list()
      .map(modelItemOption)
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.label.localeCompare(b.label))
    const available = connected.filter((model) => models.visible({ providerID: model.providerID, modelID: model.modelID }))
    const connectedIDs = new Set(connected.map((model) => model.id))
    const unavailable = configuredModels()
      .filter((model) => !connectedIDs.has(`${model.providerID}/${model.modelID}`))
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
    return modelOptions().find((option) => option.id === `${model.providerID}/${model.modelID}`) ?? optionForModel(model)
  }

  const updateAgentModel = async (agent: AgentItem, option: ModelOption | null) => {
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
                      <AgentModelSelect
                        agentName={agent.name}
                        options={modelOptions}
                        current={() => currentOption(agent)}
                        placeholder={language.t("settings.agents.model.select.placeholder")}
                        disabled={saving[agent.name]}
                        onSelect={(option) => void updateAgentModel(agent, option)}
                      />
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
        </div>
      </div>
    </>
  )

  function optionForModel(model: ModelKey): ModelOption {
    const item = models.find(model)
    if (item) return modelItemOption(item)
    return {
      kind: "model",
      id: `${model.providerID}/${model.modelID}`,
      providerID: model.providerID,
      modelID: model.modelID,
      providerName: model.providerID,
      label: `${model.modelID} (${language.t("settings.agents.model.unavailable")})`,
      group: model.providerID,
    }
  }
}

const AgentModelSelect: Component<{
  agentName: string
  options: Accessor<ModelOption[]>
  current: Accessor<ModelOption | undefined>
  placeholder: string
  disabled?: boolean
  onSelect: (option: ModelOption) => void
}> = (props) => {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  const filterOptions = (search: string) => {
    const query = search.trim()
    if (!query) return props.options()
    return props.options().filter((option) => matchesOptionSearch(query, option))
  }
  const options = createMemo(() => filterOptions(store.search))
  const groups = createMemo(() => groupModelOptions(options()))
  const optionKeys = () => options().map((option) => option.id)
  const activeItem = () =>
    store.active ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`) : undefined
  const selectedProviderID = () => {
    const option = props.current()
    if (option?.kind === "model") return option.providerID
  }
  const selectedProviderName = () => {
    const option = props.current()
    if (option?.kind === "model") return option.providerName
  }
  const initialActive = () => {
    const current = props.current()?.id
    const keys = optionKeys()
    if (current && keys.includes(current)) return current
    return keys[0] ?? ""
  }
  const setOpen = (open: boolean) => {
    if (open) {
      dismiss.allowTriggerRestore()
      setStore({ open: true, active: initialActive() })
      setTimeout(() =>
        requestAnimationFrame(() => {
          searchRef?.focus()
          activeItem()?.scrollIntoView({ block: "nearest" })
        }),
      )
      return
    }
    setStore({ open: false, search: "", active: "" })
  }
  const selectOption = (option: ModelOption) => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(() => props.onSelect(option))
  }
  const selectActive = () => {
    const option = options().find((option) => option.id === store.active)
    if (option) selectOption(option)
  }
  const moveActive = (delta: number) => {
    const keys = optionKeys()
    if (keys.length === 0) return
    const index = keys.indexOf(store.active)
    const start = index === -1 ? 0 : index
    setStore("active", keys[(start + delta + keys.length) % keys.length])
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const setSearch = (value: string) => {
    setStore({ search: value, active: filterOptions(value)[0]?.id ?? "" })
  }

  createEffect(() => {
    if (!store.open) return
    createEventListener(
      document,
      "keydown",
      (event: KeyboardEvent) => handleDocumentSearchKeydown(searchRef, event, store.search, setSearch),
      true,
    )
  })

  return (
    <MenuV2 open={store.open} modal={false} placement="bottom-end" gutter={6} onOpenChange={setOpen}>
      <MenuV2.Trigger
        data-component="button-v2"
        data-size="normal"
        data-variant="ghost-muted"
        class="settings-v2-agent-model-trigger"
        data-action={`settings-agent-model-${props.agentName}`}
        disabled={props.disabled}
      >
        <span class="settings-v2-agent-model-option settings-v2-agent-model-value">
          <Show when={selectedProviderID()}>
            {(providerID) => (
              <ProviderIcon
                id={providerID()}
                width={PROVIDER_ICON_SIZE}
                height={PROVIDER_ICON_SIZE}
                class="settings-v2-agent-model-icon"
              />
            )}
          </Show>
          <span class="min-w-0 truncate">{props.current()?.label ?? props.placeholder}</span>
          <Show when={selectedProviderName()}>
            {(providerName) => (
              <>
                <span class="shrink-0 text-v2-text-text-faint">/</span>
                <span class="max-w-[120px] shrink truncate text-v2-text-text-faint">{providerName()}</span>
              </>
            )}
          </Show>
        </span>
        <Icon name="chevron-down" size="small" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content
          ref={(element: HTMLDivElement) => (contentRef = element)}
          class="settings-v2-agent-model-menu w-[300px] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none"
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-2.5 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(element) => (searchRef = element)}
                value={store.search}
                placeholder={language.t("dialog.model.search.placeholder")}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") return
                  event.stopPropagation()
                  if (event.key === "Escape") {
                    event.preventDefault()
                    dismiss.preventTriggerRestore()
                    setOpen(false)
                    return
                  }
                  if (event.altKey || event.metaKey) return
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)
                    return
                  }
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    selectActive()
                  }
                }}
              />
              <Show when={store.search.trim()}>
                <button
                  type="button"
                  class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  aria-label={language.t("common.clear")}
                >
                  <Icon name="close" size="small" />
                </button>
              </Show>
            </div>
          </div>
          <div class="h-px bg-v2-border-border-muted" />
          <ScrollView class="max-h-[220px] min-h-0">
            <div class="flex flex-col p-0.5 pt-0">
              <Show
                when={options().length > 0}
                fallback={
                  <div class="flex h-12 items-center px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                    {language.t("dialog.model.empty")}
                  </div>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <MenuV2.Group>
                      <MenuV2.GroupLabel class="gap-2 px-3">
                        <span class="min-w-0 truncate">{group.group}</span>
                      </MenuV2.GroupLabel>
                      <MenuV2.RadioGroup value={props.current()?.id}>
                        <For each={group.options}>
                          {(option) => (
                            <MenuV2.RadioItem
                              value={option.id}
                              data-option-key={option.id}
                              class="scroll-my-6 w-full"
                              classList={{ "!bg-v2-overlay-simple-overlay-hover": store.active === option.id }}
                              onMouseEnter={() => {
                                setStore("active", option.id)
                                setTimeout(() => searchRef?.focus())
                              }}
                              onSelect={() => selectOption(option)}
                            >
                              <span class="settings-v2-agent-model-option min-w-0">
                                <Show when={option.kind === "model"}>
                                  <ProviderIcon
                                    id={(option as Extract<ModelOption, { kind: "model" }>).providerID}
                                    width={PROVIDER_ICON_SIZE}
                                    height={PROVIDER_ICON_SIZE}
                                    class="settings-v2-agent-model-icon"
                                  />
                                </Show>
                                <span class="min-w-0 truncate leading-5">{option.label}</span>
                              </span>
                            </MenuV2.RadioItem>
                          )}
                        </For>
                      </MenuV2.RadioGroup>
                    </MenuV2.Group>
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function modelItemOption(model: ModelItem): Extract<ModelOption, { kind: "model" }> {
  return {
    kind: "model",
    id: `${model.provider.id}/${model.id}`,
    providerID: model.provider.id,
    modelID: model.id,
    providerName: model.provider.name,
    label: model.name,
    group: model.provider.name,
  }
}

function groupModelOptions(options: ModelOption[]) {
  const grouped = new Map<string, ModelOption[]>()
  options.forEach((option) => grouped.set(option.group, [...(grouped.get(option.group) ?? []), option]))
  return Array.from(grouped, ([group, options]) => ({ group, options }))
}

function matchesOptionSearch(query: string, option: ModelOption) {
  if (option.kind === "default") return matchesModelSearch(query, [option.label])
  return matchesModelSearch(query, [option.label, option.modelID, option.providerName, option.providerID])
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
