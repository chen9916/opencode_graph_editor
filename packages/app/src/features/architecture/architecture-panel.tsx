import { batch, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerArchitectureAvailable, useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import {
  architectureResourceQueryKey,
  architectureResourcesQueryKey,
  createArchitectureResource,
  listArchitectureResources,
  loadArchitectureResource,
  patchArchitectureResource,
  removeArchitectureResource,
} from "./api"
import { ArchitectureIsland } from "./architecture-island"
import { ARCHITECTURE_COMMAND_EVENT, type ArchitectureCommand } from "./commands"
import type {
  ArchitectureDraft,
  ArchitectureLabels,
  ArchitectureOperation,
  ArchitectureSnapshot,
  ArchitectureViewport,
} from "./contract"
import {
  architectureResourceEventInfo,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
  beginArchitectureLocalSave,
  isArchitectureLocalSaveEvent,
} from "./event"
import { rebaseOperations } from "./journal"
import "./architecture-panel.css"

export default function ArchitecturePanel() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const architectureAvailable = useServerArchitectureAvailable()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const mobile = createMediaQuery("(max-width: 767px)")
  const [persistedState, setPersistedState] = persisted(
    Persist.serverWorkspace(serverSDK().scope, sdk().directory, "architecture-editor.v2"),
    createStore({
      selectedID: undefined as string | undefined,
      drafts: {} as Record<string, ArchitectureDraft | undefined>,
      viewports: {} as Record<string, ArchitectureViewport | undefined>,
    }),
  )
  const [state, setState] = createStore({
    busy: false,
    action: undefined as { id: number; type: ArchitectureCommand } | undefined,
  })
  const resources = createQuery(() => ({
    queryKey: architectureResourcesQueryKey(sdk().url, sdk().directory),
    enabled: architectureAvailable() === true,
    queryFn: ({ signal }) => listArchitectureResources(serverSDK().currentApi, sdk().directory, signal),
  }))
  const resourceID = createMemo(() => {
    const selected = persistedState.selectedID
    if (selected && resources.data?.some((resource) => resource.id === selected)) return selected
    return resources.data?.[0]?.id
  })
  const resource = createQuery(() => ({
    queryKey: architectureResourceQueryKey(sdk().url, sdk().directory, resourceID() ?? ""),
    enabled: architectureAvailable() === true && !!resourceID(),
    queryFn: ({ signal }) => loadArchitectureResource(serverSDK().currentApi, sdk().directory, resourceID()!, signal),
  }))
  const draft = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.drafts[id] : undefined
  })
  const viewport = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.viewports[id] : undefined
  })
  const labels = createMemo<ArchitectureLabels>(() => ({
    title: language.t("architecture.panel.title"),
    revision: (revision) => language.t("architecture.panel.revision", { revision }),
    nodes: (count) => language.t("architecture.panel.nodes", { count }),
    edges: (count) => language.t("architecture.panel.edges", { count }),
    outlineTitle: language.t("architecture.outline.title"),
    inspectorTitle: language.t("architecture.inspector.title"),
    properties: language.t("architecture.panel.properties"),
    connectionStyle: language.t("architecture.field.connectionStyle"),
    sourceSide: language.t("architecture.field.sourceSide"),
    targetSide: language.t("architecture.field.targetSide"),
    sides: {
      top: language.t("architecture.side.top"),
      right: language.t("architecture.side.right"),
      bottom: language.t("architecture.side.bottom"),
      left: language.t("architecture.side.left"),
    },
    rectangular: language.t("architecture.connection.rectangular"),
    curved: language.t("architecture.connection.curved"),
    straight: language.t("architecture.connection.straight"),
    name: language.t("architecture.field.name"),
    text: language.t("architecture.field.text"),
    tags: language.t("architecture.field.tags"),
    tagHub: language.t("architecture.field.tagHub"),
    tagColor: language.t("architecture.field.tagColor"),
    tagUsage: (count) => language.t("architecture.field.tagUsage", { count }),
    noTags: language.t("architecture.field.noTags"),
    clearColor: language.t("architecture.field.clearColor"),
    search: language.t("architecture.filter.search"),
    allTags: language.t("architecture.filter.allTags"),
    clearFilters: language.t("architecture.filter.clear"),
    addNode: language.t("architecture.action.addNode"),
    save: language.t("architecture.action.save"),
    reload: language.t("architecture.action.reload"),
    fitView: language.t("architecture.action.fitView"),
    fitSelection: language.t("architecture.action.fitSelection"),
    undo: language.t("architecture.action.undo"),
    redo: language.t("architecture.action.redo"),
    delete: language.t("architecture.action.delete"),
    duplicate: language.t("architecture.action.duplicate"),
    exportPatch: language.t("architecture.action.exportPatch"),
    conflicts: language.t("architecture.conflict.title"),
    dirty: language.t("architecture.state.dirty"),
    clean: language.t("architecture.state.clean"),
    selectedItems: (nodes, edges) => language.t("architecture.state.selected", { nodes, edges }),
    moveSelectionHint: language.t("architecture.state.moveSelectionHint"),
    resourceDetails: language.t("architecture.resource.details"),
    discardConfirm: language.t("architecture.confirm.discard"),
    deleteNodeConfirm: language.t("architecture.confirm.deleteNode"),
    deleteEdgeConfirm: language.t("architecture.confirm.deleteEdge"),
    deleteSelectionConfirm: language.t("architecture.confirm.deleteSelection"),
    copied: language.t("architecture.toast.copied"),
    saveFailed: language.t("architecture.toast.saveFailed"),
    conflictReasons: {
      changed: language.t("architecture.conflict.changed"),
      missing: language.t("architecture.conflict.missing"),
      exists: language.t("architecture.conflict.exists"),
    },
  }))

  createEffect(() => {
    const id = resourceID()
    if (id && persistedState.selectedID !== id) setPersistedState("selectedID", id)
  })

  createEffect(() => {
    const current = sdk()
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      const type = String(event.type)
      const eventInfo = architectureResourceEventInfo({ type, properties: event.properties })
      if (!eventInfo) return
      const resourcesKey = architectureResourcesQueryKey(current.url, current.directory)
      if (type === "architecture.resource.removed") {
        queryClient.setQueryData(
          resourcesKey,
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            removeResourceSummary(current, eventInfo.resourceID),
        )
        setPersistedState("drafts", eventInfo.resourceID, undefined)
        setPersistedState("viewports", eventInfo.resourceID, undefined)
        if (persistedState.selectedID === eventInfo.resourceID) setPersistedState("selectedID", undefined)
        return
      }

      const pending = isArchitectureLocalSaveEvent({
        server: current.url,
        directory: current.directory,
        event: eventInfo,
      })
      if (!pending && !architectureSummaryMatchesEvent(queryClient.getQueryData(resourcesKey), eventInfo))
        void queryClient.refetchQueries({
          queryKey: resourcesKey,
          exact: true,
          type: "active",
        })

      if (eventInfo.resourceID !== resourceID()) return
      const resourceKey = architectureResourceQueryKey(current.url, current.directory, eventInfo.resourceID)
      if (!pending && !architectureSnapshotMatchesEvent(queryClient.getQueryData(resourceKey), eventInfo))
        void queryClient.refetchQueries({
          queryKey: resourceKey,
          exact: true,
          type: "active",
        })
    })
    onCleanup(unsubscribe)
  })

  const dirty = () => (draft()?.operations.length ?? 0) > 0 || (draft()?.conflicts.length ?? 0) > 0

  const command = (event: Event) => {
    const detail = (event as CustomEvent<ArchitectureCommand>).detail
    setState("action", { id: Date.now(), type: detail })
  }
  document.addEventListener(ARCHITECTURE_COMMAND_EVENT, command)
  onCleanup(() => document.removeEventListener(ARCHITECTURE_COMMAND_EVENT, command))

  createEffect(() => {
    const snapshot = resource.data
    const current = draft()
    const id = resourceID()
    if (!id || !snapshot || !current || current.operations.length > 0 || current.conflicts.length > 0) return
    setPersistedState("drafts", id, undefined)
  })

  const journal = (operations: ReadonlyArray<ArchitectureOperation>) => {
    const id = resourceID()
    const snapshot = draft()?.base ?? resource.data
    if (!id || !snapshot) return
    const conflicts = draft()?.conflicts ?? []
    if (operations.length === 0 && conflicts.length === 0) {
      setPersistedState("drafts", id, undefined)
      return
    }
    setPersistedState("drafts", id, { base: snapshot, operations, conflicts })
  }

  const save = async (operations: ReadonlyArray<ArchitectureOperation>) => {
    const id = resourceID()
    const base = draft()?.base ?? resource.data
    if (!id || !base || operations.length === 0 || state.busy) return false
    setState("busy", true)
    const finishLocalSave = beginArchitectureLocalSave({
      server: sdk().url,
      directory: sdk().directory,
      resourceID: id,
      revision: base.resource.revision + 1,
    })
    try {
      const saved = await patchArchitectureResource(serverSDK().currentApi, sdk().directory, base, operations)
      const conflicts = draft()?.conflicts ?? []
      batch(() => {
        queryClient.setQueryData(architectureResourceQueryKey(sdk().url, sdk().directory, id), saved)
        queryClient.setQueryData(
          architectureResourcesQueryKey(sdk().url, sdk().directory),
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateResourceSummaries(current, resourceSummary(saved)),
        )
        setPersistedState("drafts", id, conflicts.length > 0 ? { base: saved, operations: [], conflicts } : undefined)
      })
      return true
    } catch (error) {
      if (isConflict(error)) {
        const latest = await loadArchitectureResource(serverSDK().currentApi, sdk().directory, id)
        const rebased = rebaseOperations(base.resource, latest.resource, operations)
        batch(() => {
          queryClient.setQueryData(architectureResourceQueryKey(sdk().url, sdk().directory, id), latest)
          queryClient.setQueryData(
            architectureResourcesQueryKey(sdk().url, sdk().directory),
            (current: ArchitectureListResourcesOutput["data"] | undefined) =>
              updateResourceSummaries(current, resourceSummary(latest)),
          )
          setPersistedState("drafts", id, {
            base: latest,
            operations: rebased.operations,
            conflicts: [...(draft()?.conflicts ?? []), ...rebased.conflicts],
          })
        })
      } else {
        showToast({ variant: "error", title: labels().saveFailed })
      }
      return false
    } finally {
      finishLocalSave()
      setState("busy", false)
    }
  }

  const confirm = (message: string, confirmLabel: string, action: () => void) => {
    dialog.show(() => (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup title={labels().title} description={message} />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              action()
            }}
          >
            {confirmLabel}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    ))
  }

  const reloadResource = async () => {
    const id = resourceID()
    if (!id) return
    setPersistedState("drafts", id, undefined)
    await resource.refetch()
  }

  const reload = () => {
    if (!dirty()) {
      void reloadResource()
      return
    }
    confirm(labels().discardConfirm, labels().reload, () => void reloadResource())
  }

  const createResource = async () => {
    if (state.busy) return
    setState("busy", true)
    try {
      const created = await createArchitectureResource(serverSDK().currentApi, sdk().directory, {
        name: language.t("architecture.resource.defaultName", { number: (resources.data?.length ?? 0) + 1 }),
      })
      queryClient.setQueryData(architectureResourceQueryKey(sdk().url, sdk().directory, created.resource.id), created)
      await resources.refetch()
      setPersistedState("selectedID", created.resource.id)
    } catch {
      showToast({ variant: "error", title: language.t("architecture.toast.resourceCreateFailed") })
    } finally {
      setState("busy", false)
    }
  }

  const removeResource = () => {
    const current = resource.data
    if (!current || state.busy) return
    confirm(language.t("architecture.confirm.deleteResource"), labels().delete, () => {
      setState("busy", true)
      void removeArchitectureResource(serverSDK().currentApi, sdk().directory, current)
        .then(async () => {
          queryClient.setQueryData(
            architectureResourcesQueryKey(sdk().url, sdk().directory),
            (list: ArchitectureListResourcesOutput["data"] | undefined) =>
              removeResourceSummary(list, current.resource.id),
          )
          setPersistedState("drafts", current.resource.id, undefined)
          setPersistedState("viewports", current.resource.id, undefined)
          setPersistedState("selectedID", undefined)
          await resources.refetch()
        })
        .catch(() => showToast({ variant: "error", title: language.t("architecture.toast.resourceDeleteFailed") }))
        .finally(() => setState("busy", false))
    })
  }

  const exportPatch = (operations: ReadonlyArray<ArchitectureOperation>) => {
    const current = draft()
    if (!current) return
    void navigator.clipboard
      .writeText(
        JSON.stringify(
          {
            resourceID: current.base.resource.id,
            revision: current.base.resource.revision,
            digest: current.base.digest,
            operations,
            conflicts: current.conflicts,
          },
          null,
          2,
        ),
      )
      .then(() => showToast({ title: labels().copied }))
  }

  return (
    <div class="h-full min-h-0 overflow-hidden bg-v2-background-bg-base text-v2-text-primary flex flex-col">
      <Show
        when={architectureAvailable() !== false}
        fallback={<ArchitectureMessage value={language.t("architecture.panel.unsupported")} />}
      >
        <header class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-v2-border-subtle">
          <select
            class="architecture-panel__resource-select min-w-0 flex-1 rounded-md border border-v2-border-subtle bg-v2-background-bg-raised px-2 py-1"
            aria-label={language.t("architecture.resource.select")}
            value={resourceID() ?? ""}
            onChange={(event) => setPersistedState("selectedID", event.currentTarget.value)}
            disabled={!resources.data?.length || state.busy}
          >
            <Show when={!resources.data?.length}>
              <option value="">{language.t("architecture.resource.none")}</option>
            </Show>
            {resources.data?.map((item) => (
              <option value={item.id}>{item.name}</option>
            ))}
          </select>
          <ButtonV2 variant="ghost" onClick={() => void createResource()} disabled={state.busy}>
            {language.t("architecture.resource.new")}
          </ButtonV2>
          <ButtonV2 variant="ghost" onClick={removeResource} disabled={state.busy || !resource.data}>
            {language.t("architecture.resource.delete")}
          </ButtonV2>
        </header>
        <div class="min-h-0 flex-1">
          <Show
            when={!resources.isPending}
            fallback={<ArchitectureMessage value={language.t("architecture.panel.loading")} />}
          >
            <Show
              when={!resources.error}
              fallback={<ArchitectureMessage value={language.t("architecture.panel.error")} />}
            >
              <Show
                when={resourceID()}
                fallback={<ArchitectureMessage value={language.t("architecture.panel.empty.description")} />}
              >
                <Show
                  when={!resource.isPending}
                  fallback={<ArchitectureMessage value={language.t("architecture.panel.loading")} />}
                >
                  <Show
                    when={!resource.error}
                    fallback={<ArchitectureMessage value={language.t("architecture.panel.error")} />}
                  >
                    <Show when={resource.data}>
                      <ArchitectureIsland
                        direction={language.direction()}
                        mobile={mobile()}
                        snapshot={resource.data!}
                        draft={draft()}
                        viewport={viewport()}
                        busy={state.busy}
                        action={state.action}
                        labels={labels()}
                        onJournal={journal}
                        onViewport={(value) => {
                          const id = resourceID()
                          if (id) setPersistedState("viewports", id, value)
                        }}
                        onSave={(operations) => void save(operations)}
                        onReload={reload}
                        onExport={exportPatch}
                        onConfirm={confirm}
                      />
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ArchitectureMessage(props: { readonly value: string }) {
  return (
    <div class="h-full min-h-0 flex items-center justify-center px-6 text-center">
      <div class="max-w-80 text-13-regular text-v2-text-muted">{props.value}</div>
    </div>
  )
}

function resourceSummary(snapshot: ArchitectureSnapshot): ArchitectureListResourcesOutput["data"][number] {
  return {
    id: snapshot.resource.id,
    name: snapshot.resource.name,
    revision: snapshot.resource.revision,
    digest: snapshot.digest,
    nodes: snapshot.resource.nodes.length,
    edges: snapshot.resource.edges.length,
  }
}

function updateResourceSummaries(
  current: ArchitectureListResourcesOutput["data"] | undefined,
  summary: ArchitectureListResourcesOutput["data"][number],
) {
  const list = current ?? []
  const next = list.some((item) => item.id === summary.id)
    ? list.map((item) => (item.id === summary.id ? summary : item))
    : [...list, summary]
  return next.toSorted((left, right) => left.name.localeCompare(right.name))
}

function removeResourceSummary(current: ArchitectureListResourcesOutput["data"] | undefined, resourceID: string) {
  return current?.filter((item) => item.id !== resourceID)
}

function isConflict(value: unknown) {
  return !!value && typeof value === "object" && "_tag" in value && value._tag === "ArchitectureConflictError"
}
