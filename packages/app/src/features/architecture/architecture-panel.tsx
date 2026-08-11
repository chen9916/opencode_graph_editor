import { batch, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import { sendFollowupDraft } from "@/components/prompt-input/submit"
import type { Prompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useServerArchitectureAvailable, useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import {
  architectureResourceDraftQueryKey,
  architectureResourceQueryKey,
  architectureResourcesQueryKey,
  createArchitectureResource,
  listArchitectureResources,
  loadArchitectureResource,
  loadArchitectureResourceDraft,
  loadArchitectureResourceDraftSnapshot,
  removeArchitectureResource,
  commitArchitectureResourceDraft,
  reloadArchitectureResourceDraft,
  updateArchitectureResourceDraft,
} from "./api"
import { ArchitectureIsland } from "./architecture-island"
import {
  ARCHITECTURE_COMMAND_EVENT,
  architectureCommandRequest,
  architectureCommandRequestTarget,
  architectureCommandRequestType,
  dispatchArchitectureCommand,
  type ArchitectureCommandAction,
} from "./commands"
import type {
  ArchitectureDraft,
  ArchitectureDraftChange,
  ArchitectureLabels,
  ArchitectureLiveDraftCache,
  ArchitectureOperation,
  ArchitectureResource,
  ArchitectureSelectionPrompt,
  ArchitectureSnapshot,
  ArchitectureViewport,
} from "./contract"
import {
  architectureDraftEventIsStale,
  architectureResourceEventInfo,
  architectureResourceDraftEventCache,
  architectureResourceDraftEventInfo,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
} from "./event"
import { createArchitectureCacheOrder, guardedArchitectureCacheResponse } from "./cache-order"
import { downloadArchitectureResourceExport } from "./export"
import {
  createArchitectureDraftSynchronizer,
  discardSavedArchitectureLiveDraftCache,
  latestArchitectureLiveDraftCache,
  reconcileArchitectureDraft,
} from "./live-draft"
import {
  architectureDraftCanSkipSave,
  architectureDraftIsDirty,
  architectureDraftResourceID,
  architectureResourceSelectionOptions,
  architectureResourceSummary,
  latestArchitectureSnapshot,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
  selectedArchitectureSnapshot,
  selectedArchitectureResourceSummary,
  updateArchitectureResourceSummaries,
} from "./resource-state"
import { architectureSelectionText } from "./selection-prompt"
import "./architecture-panel.css"

export default function ArchitecturePanel() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const workspaceKey = createMemo(() => `${serverSDK().scope}\0${sdk().url}\0${sdk().directory}`)
  return <Show when={workspaceKey()} keyed>{(_workspace) => <ArchitecturePanelWorkspace />}</Show>
}

function ArchitecturePanelWorkspace() {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const architectureAvailable = useServerArchitectureAvailable()
  const sync = useSync()
  const serverSync = useServerSync()
  const local = useLocal()
  const params = useParams()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const mobile = createMediaQuery("(max-width: 767px)")
  let panel: HTMLDivElement | undefined
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.serverWorkspace(serverSDK().scope, sdk().directory, "architecture-editor.v2"),
    createStore({
      selectedID: undefined as string | undefined,
      drafts: {} as Record<string, ArchitectureDraft | undefined>,
      viewports: {} as Record<string, ArchitectureViewport | undefined>,
    }),
  )
  const [state, setState] = createStore({
    busy: false,
    action: undefined as ArchitectureCommandAction | undefined,
  })
  const draftSynchronizers = new Map<string, ReturnType<typeof createArchitectureDraftSynchronizer>>()
  const cacheOrder = createArchitectureCacheOrder()
  const setArchitectureQueryData = <T,>(
    key: readonly unknown[],
    value: T | ((current: T | undefined) => T | undefined),
  ) => {
    cacheOrder.mark(key)
    queryClient.setQueryData<T>(key, value)
  }
  const operationScope = (resourceID: string) => {
    const workspace = sdk()
    return {
      api: serverSDK().currentApi,
      server: workspace.url,
      directory: workspace.directory,
      resourceID,
    }
  }
  const resources = createQuery(() => {
    const workspace = sdk()
    const api = serverSDK().currentApi
    const key = architectureResourcesQueryKey(workspace.url, workspace.directory)
    return {
      queryKey: key,
      enabled: architectureAvailable() === true,
      queryFn: ({ signal }) =>
        guardedArchitectureCacheResponse<ArchitectureListResourcesOutput["data"]>({
          cacheOrder,
          key,
          current: () => queryClient.getQueryData<ArchitectureListResourcesOutput["data"]>(key),
          observe: () => listArchitectureResources(api, workspace.directory, signal),
        }),
      refetchInterval: state.busy ? false : 2_000,
      refetchIntervalInBackground: true,
    }
  })
  const resourceID = createMemo(() =>
    persistedReady() ? resolveArchitectureResourceID(persistedState.selectedID, resources.data) : undefined,
  )
  const persistedDraft = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.drafts[id] : undefined
  })
  const localDirty = () => architectureDraftIsDirty({ draft: persistedDraft() })
  const resource = createQuery(() => {
    const id = resourceID()
    const workspace = sdk()
    const api = serverSDK().currentApi
    const key = architectureResourceQueryKey(workspace.url, workspace.directory, id ?? "")
    return {
      queryKey: key,
      enabled: architectureAvailable() === true && !!id,
      queryFn: ({ signal }) =>
        guardedArchitectureCacheResponse<ArchitectureSnapshot>({
          cacheOrder,
          key,
          current: () => queryClient.getQueryData<ArchitectureSnapshot>(key),
          observe: () => loadArchitectureResource(api, workspace.directory, id!, signal),
        }),
      refetchInterval: state.busy || localDirty() ? false : 2_000,
      refetchIntervalInBackground: true,
      reconcile: latestArchitectureSnapshot,
    }
  })
  const liveDraft = createQuery(() => {
    const id = resourceID()
    const workspace = sdk()
    const api = serverSDK().currentApi
    const key = architectureResourceDraftQueryKey(workspace.url, workspace.directory, id ?? "")
    return {
      queryKey: key,
      enabled: architectureAvailable() === true && !!id,
      queryFn: ({ signal }) =>
        guardedArchitectureCacheResponse<ArchitectureLiveDraftCache>({
          cacheOrder,
          key,
          current: () => queryClient.getQueryData<ArchitectureLiveDraftCache>(key),
          observe: () => loadArchitectureResourceDraft(api, workspace.directory, id!, signal),
        }),
      refetchInterval: state.busy ? false : 2_000,
      refetchIntervalInBackground: true,
      reconcile: latestArchitectureLiveDraftCache,
    }
  })
  const activeSnapshot = createMemo(() => selectedArchitectureSnapshot(resourceID(), resource.data))
  const activeLiveDraft = createMemo(() => {
    const id = resourceID()
    const current = liveDraft.data
    if (!id || current === undefined || current === null) return current
    if (current.snapshot.resource.id !== id) return undefined
    return current
  })
  const draftSynchronizer = (scope: ReturnType<typeof operationScope>) => {
    const key = `${scope.server}\0${scope.directory}\0${scope.resourceID}`
    const current = draftSynchronizers.get(key)
    if (current) return current
    const created = createArchitectureDraftSynchronizer({
      patch: (base, operations) => updateArchitectureResourceDraft(scope.api, scope.directory, base, operations),
      update: (updated) =>
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(scope.server, scope.directory, scope.resourceID),
          (current) => (updated ? latestArchitectureLiveDraftCache(current, updated) : updated),
        ),
      adopt: (draft) =>
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(scope.server, scope.directory, scope.resourceID),
          draft,
        ),
    })
    draftSynchronizers.set(key, created)
    return created
  }
  const draft = createMemo(() => {
    const current = persistedDraft()
    const live = activeLiveDraft()
    if (current) return live ? { ...current, live } : current
    if (!live) return undefined
    return {
      base: live.snapshot,
      origin: live.snapshot,
      operations: [],
      conflicts: [],
      live,
    }
  })
  const dirty = () => architectureDraftIsDirty({ draft: draft() })
  const resourceOptions = createMemo(() =>
    architectureResourceSelectionOptions(resources.data, draft()?.live?.snapshot ?? activeSnapshot()),
  )
  const selectedResource = createMemo(() => selectedArchitectureResourceSummary(resourceID(), resourceOptions()))
  const viewport = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.viewports[id] : undefined
  })

  createEffect(() => {
    const id = resourceID()
    const snapshot = activeSnapshot()
    if (!id || !snapshot) return
    const workspace = sdk()
    setArchitectureQueryData<ArchitectureLiveDraftCache>(
      architectureResourceDraftQueryKey(workspace.url, workspace.directory, id),
      (current) => discardSavedArchitectureLiveDraftCache(current, snapshot),
    )
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
    askSelection: language.t("architecture.action.askSelection"),
    askSelectionPlaceholder: language.t("architecture.ask.placeholder"),
    askSelectionLabel: language.t("architecture.ask.label"),
    askSelectionContextAttached: language.t("architecture.ask.contextAttached"),
    send: language.t("prompt.action.send"),
    cancel: language.t("common.cancel"),
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
    askSelectionFailed: language.t("architecture.toast.askSelectionFailed"),
    conflictReasons: {
      changed: language.t("architecture.conflict.changed"),
      missing: language.t("architecture.conflict.missing"),
      exists: language.t("architecture.conflict.exists"),
    },
  }))

  createEffect(() => {
    const id = resourceID()
    if (persistedReady() && id && persistedState.selectedID !== id) setPersistedState("selectedID", id)
  })

  createEffect(() => {
    const current = sdk()
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      const type = String(event.type)
      const resourcesKey = architectureResourcesQueryKey(current.url, current.directory)
      const draftEventInfo = architectureResourceDraftEventInfo({
        type,
        properties: event.properties,
        data: "data" in event ? event.data : undefined,
      })
      if (draftEventInfo) {
        const draftKey = architectureResourceDraftQueryKey(current.url, current.directory, draftEventInfo.resourceID)
        const resourceKey = architectureResourceQueryKey(current.url, current.directory, draftEventInfo.resourceID)
        if (architectureDraftEventIsStale(queryClient.getQueryData<ArchitectureSnapshot>(resourceKey), draftEventInfo))
          return
        const eventDraft = architectureResourceDraftEventCache(draftEventInfo)
        if (eventDraft === null) {
          setArchitectureQueryData<ArchitectureLiveDraftCache>(draftKey, null)
          if (draftEventInfo.resourceID === resourceID()) {
            void queryClient.refetchQueries({ queryKey: resourcesKey, exact: true, type: "active" })
            void queryClient.refetchQueries({ queryKey: resourceKey, exact: true, type: "active" })
          }
          return
        }
        if (eventDraft) {
          setArchitectureQueryData<ArchitectureLiveDraftCache>(draftKey, (current) =>
            latestArchitectureLiveDraftCache(current, eventDraft),
          )
          return
        }
        void queryClient.refetchQueries({ queryKey: draftKey, exact: true, type: "active" })
        return
      }
      const eventInfo = architectureResourceEventInfo({
        type,
        properties: event.properties,
        data: "data" in event ? event.data : undefined,
      })
      if (!eventInfo) return
      if (type === "architecture.resource.removed") {
        setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
          removeResourceSummary(current, eventInfo.resourceID),
        )
        setPersistedState("drafts", eventInfo.resourceID, undefined)
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(current.url, current.directory, eventInfo.resourceID),
          null,
        )
        setPersistedState("viewports", eventInfo.resourceID, undefined)
        if (persistedState.selectedID === eventInfo.resourceID) setPersistedState("selectedID", undefined)
        return
      }

      if (eventInfo.resourceID === resourceID() && dirty()) return
      if (!architectureSummaryMatchesEvent(queryClient.getQueryData(resourcesKey), eventInfo))
        void queryClient.refetchQueries({
          queryKey: resourcesKey,
          exact: true,
          type: "active",
        })

      if (eventInfo.resourceID !== resourceID()) return
      const resourceKey = architectureResourceQueryKey(current.url, current.directory, eventInfo.resourceID)
      if (!architectureSnapshotMatchesEvent(queryClient.getQueryData(resourceKey), eventInfo))
        void queryClient.refetchQueries({
          queryKey: resourceKey,
          exact: true,
          type: "active",
        })
    })
    onCleanup(unsubscribe)
  })

  const command = (event: Event) => {
    const id = resourceID()
    if (!id) return
    const detail = architectureCommandRequest((event as CustomEvent<unknown>).detail)
    if (!detail) return
    const target = architectureCommandRequestTarget(detail)
    if (!target || !panel?.contains(target)) return
    setState("action", {
      id: (state.action?.id ?? 0) + 1,
      type: architectureCommandRequestType(detail),
      server: sdk().url,
      directory: sdk().directory,
      resourceID: id,
    })
  }
  document.addEventListener(ARCHITECTURE_COMMAND_EVENT, command)
  onCleanup(() => document.removeEventListener(ARCHITECTURE_COMMAND_EVENT, command))

  const journal = (change: ArchitectureDraftChange) => {
    const id = architectureDraftResourceID(change)
    const workspace = sdk()
    if (change.server !== workspace.url || change.directory !== workspace.directory) return
    setPersistedState("drafts", id, {
      base: change.base,
      origin: change.origin,
      operations: change.operations,
      conflicts: change.conflicts,
    })
    const scope = operationScope(id)
    const live = queryClient.getQueryData<ArchitectureLiveDraftCache>(
      architectureResourceDraftQueryKey(scope.server, scope.directory, id),
    )
    void draftSynchronizer(scope)
      .synchronize(live?.snapshot ?? change.origin, change.resource)
      .catch(() => undefined)
  }

  const save = async (change: ArchitectureDraftChange) => {
    const id = architectureDraftResourceID(change)
    if (state.busy) return false
    const live = draft()?.live
    if (architectureDraftCanSkipSave(change) && !live) return true
    const workspace = sdk()
    if (change.server !== workspace.url || change.directory !== workspace.directory) return false
    const scope = operationScope(id)
    setState("busy", true)
    const resourceKey = architectureResourceQueryKey(scope.server, scope.directory, id)
    const draftKey = architectureResourceDraftQueryKey(scope.server, scope.directory, id)
    const resourcesKey = architectureResourcesQueryKey(scope.server, scope.directory)
    const synchronizer = draftSynchronizer(scope)
    try {
      await synchronizer.invalidate()
      const synchronized = await synchronizer.synchronizeAuthoritative(
        () => loadArchitectureResourceDraftSnapshot(scope.api, scope.directory, id),
        change.resource,
      )
      const saved = await commitArchitectureResourceDraft(scope.api, scope.directory, synchronized)
      batch(() => {
        setArchitectureQueryData(resourceKey, saved)
        setArchitectureQueryData<ArchitectureLiveDraftCache>(draftKey, null)
        setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
          updateArchitectureResourceSummaries(current, architectureResourceSummary(saved)),
        )
        setPersistedState("drafts", id, undefined)
      })
      void synchronizer.adopt(null).catch(() => undefined)
      return true
    } catch {
      showToast({ variant: "error", title: labels().saveFailed })
      return false
    } finally {
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

  const reloadResource = async (scope: ReturnType<typeof operationScope>) => {
    const id = scope.resourceID
    if (state.busy) return
    setState("busy", true)
    const resourceKey = architectureResourceQueryKey(scope.server, scope.directory, id)
    const draftKey = architectureResourceDraftQueryKey(scope.server, scope.directory, id)
    const resourcesKey = architectureResourcesQueryKey(scope.server, scope.directory)
    const synchronizer = draftSynchronizer(scope)
    try {
      await synchronizer.invalidate()
      const reloaded = await reloadArchitectureResourceDraft(scope.api, scope.directory, id)
      batch(() => {
        setArchitectureQueryData(resourceKey, reloaded.snapshot)
        setArchitectureQueryData<ArchitectureLiveDraftCache>(draftKey, null)
        setArchitectureQueryData(
          resourcesKey,
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateArchitectureResourceSummaries(current, architectureResourceSummary(reloaded.snapshot)),
        )
        setPersistedState("drafts", id, undefined)
      })
      void synchronizer.adopt(null).catch(() => undefined)
    } catch {
      showToast({ variant: "error", title: language.t("architecture.panel.error") })
    } finally {
      setState("busy", false)
    }
  }

  const reload = () => {
    const id = resourceID()
    if (!id || state.busy) return
    const scope = operationScope(id)
    if (!dirty()) {
      void reloadResource(scope)
      return
    }
    confirm(labels().discardConfirm, labels().reload, () => void reloadResource(scope))
  }

  const createResource = async () => {
    if (state.busy || !persistedReady()) return
    const workspace = sdk()
    const api = serverSDK().currentApi
    setState("busy", true)
    try {
      const created = await createArchitectureResource(api, workspace.directory, {
        name: language.t("architecture.resource.defaultName", { number: (resources.data?.length ?? 0) + 1 }),
      })
      batch(() => {
        setArchitectureQueryData(architectureResourceQueryKey(workspace.url, workspace.directory, created.resource.id), created)
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(workspace.url, workspace.directory, created.resource.id),
          null,
        )
        setArchitectureQueryData(
          architectureResourcesQueryKey(workspace.url, workspace.directory),
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateArchitectureResourceSummaries(current, architectureResourceSummary(created)),
        )
        setPersistedState("selectedID", created.resource.id)
      })
    } catch {
      showToast({ variant: "error", title: language.t("architecture.toast.resourceCreateFailed") })
    } finally {
      setState("busy", false)
    }
  }

  const requestDuplicateResource = () => {
    const id = resourceID()
    if (!id || state.busy) return
    setState("action", {
      id: (state.action?.id ?? 0) + 1,
      type: "duplicateResource",
      server: sdk().url,
      directory: sdk().directory,
      resourceID: id,
    })
  }

  const duplicateResource = async (change: ArchitectureDraftChange) => {
    const id = architectureDraftResourceID(change)
    if (state.busy || !persistedReady()) return
    const workspace = sdk()
    if (change.server !== workspace.url || change.directory !== workspace.directory) return
    const scope = operationScope(id)
    setState("busy", true)
    const resourcesKey = architectureResourcesQueryKey(scope.server, scope.directory)
    try {
      const created = await createArchitectureResource(scope.api, scope.directory, {
        name: language.t("architecture.resource.duplicateName", { name: change.resource.name }),
      })
      const patched = await updateArchitectureResourceDraft(
        scope.api,
        scope.directory,
        created,
        reconcileArchitectureDraft(created.resource, change.resource),
      )
      if (!patched) throw new Error("Architecture draft patch did not return a live draft")
      const copy = await commitArchitectureResourceDraft(scope.api, scope.directory, patched.snapshot)
      batch(() => {
        setArchitectureQueryData(architectureResourceQueryKey(scope.server, scope.directory, copy.resource.id), copy)
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(scope.server, scope.directory, copy.resource.id),
          null,
        )
        setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
          updateArchitectureResourceSummaries(current, architectureResourceSummary(copy)),
        )
        setPersistedState("selectedID", copy.resource.id)
      })
    } catch {
      showToast({ variant: "error", title: language.t("architecture.toast.resourceDuplicateFailed") })
    } finally {
      setState("busy", false)
    }
  }

  const removeResource = () => {
    const current = activeSnapshot()
    if (!current || state.busy) return
    const workspace = sdk()
    const api = serverSDK().currentApi
    confirm(language.t("architecture.confirm.deleteResource"), labels().delete, () => {
      setState("busy", true)
      void removeArchitectureResource(api, workspace.directory, current)
        .then(async () => {
          setArchitectureQueryData(
            architectureResourcesQueryKey(workspace.url, workspace.directory),
            (list: ArchitectureListResourcesOutput["data"] | undefined) =>
              removeResourceSummary(list, current.resource.id),
          )
          setPersistedState("drafts", current.resource.id, undefined)
          setArchitectureQueryData<ArchitectureLiveDraftCache>(
            architectureResourceDraftQueryKey(workspace.url, workspace.directory, current.resource.id),
            null,
          )
          setPersistedState("viewports", current.resource.id, undefined)
          setPersistedState("selectedID", undefined)
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

  const exportResource = (resource: ArchitectureResource) => {
    try {
      const filename = downloadArchitectureResourceExport(resource)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("architecture.toast.exported"),
        description: language.t("architecture.toast.exported.description", { filename }),
      })
    } catch {
      showToast({ variant: "error", title: language.t("architecture.toast.exportFailed") })
    }
  }

  const askSelection = (input: ArchitectureSelectionPrompt) => {
    const sessionID = params.id
    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!sessionID || !currentModel || !currentAgent) {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    const text = input.message.trim()
    const prompt: Prompt = [{ type: "text", content: text, start: 0, end: text.length }]
    void sendFollowupDraft({
      api: sdk().api.session,
      sync: sync(),
      serverSync: serverSync(),
      optimisticBusy: true,
      draft: {
        sessionID,
        sessionDirectory: sdk().directory,
        prompt,
        context: [],
        agent: currentAgent.name,
        model: { providerID: currentModel.provider.id, modelID: currentModel.id },
        variant: local.model.variant.current(),
        modelContext: [
          {
            text: architectureSelectionText(input),
            description: labels().askSelectionContextAttached,
            metadata: {
              kind: "graph-selection",
              resourceID: input.resourceID,
              resourceName: input.resourceName,
            },
          },
        ],
      },
    }).catch(() => showToast({ variant: "error", title: labels().askSelectionFailed }))
  }

  return (
    <div
      ref={panel}
      data-architecture-panel
      class="h-full min-h-0 overflow-hidden bg-v2-background-bg-base text-v2-text-primary flex flex-col"
    >
      <Show
        when={architectureAvailable() !== false}
        fallback={<ArchitectureMessage value={language.t("architecture.panel.unsupported")} />}
      >
        <header class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-v2-border-subtle">
          <SelectV2
            class="architecture-panel__resource-select min-w-0 flex-1"
            aria-label={language.t("architecture.resource.select")}
            options={resourceOptions()}
            current={selectedResource()}
            value={(item) => item.id}
            label={(item) => item.name}
            placeholder={language.t("architecture.resource.none")}
            fitViewport
            onSelect={(item) => {
              const currentID = resourceID()
              const next = resolveArchitectureResourceSelection({
                currentID,
                selectedID: item?.id,
                committed: true,
              })
              if (currentID && currentID !== next) void draftSynchronizer(operationScope(currentID)).invalidate()
              if (next && persistedState.selectedID !== next) setPersistedState("selectedID", next)
            }}
            disabled={!persistedReady() || !resourceOptions().length || state.busy}
          />
          <div class="architecture-panel__actions">
            <ButtonV2
              size="small"
              variant={dirty() ? "contrast" : "neutral"}
              icon="check"
              disabled={state.busy || !activeSnapshot()}
              onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) =>
                dispatchArchitectureCommand("save", event.currentTarget)
              }
            >
              {labels().save}
            </ButtonV2>
            <ButtonV2
              size="small"
              variant="ghost"
              icon="reset"
              disabled={state.busy || !activeSnapshot()}
              onClick={() => reload()}
            >
              {labels().reload}
            </ButtonV2>
          </div>
          <MenuV2 gutter={4} modal={false} placement="bottom-end">
            <MenuV2.Trigger
              as={ButtonV2}
              class="shrink-0"
              variant="ghost"
              disabled={state.busy || !persistedReady()}
            >
              {language.t("command.category.file")}
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={() => void createResource()} disabled={state.busy || !persistedReady()}>
                  {language.t("architecture.resource.new")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={requestDuplicateResource} disabled={state.busy || !activeSnapshot()}>
                  {language.t("architecture.resource.duplicate")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={removeResource} disabled={state.busy || !activeSnapshot()}>
                  {language.t("architecture.resource.delete")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </header>
        <div class="min-h-0 flex-1">
          <Show
            when={persistedReady() && !resources.isPending}
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
                  when={!resource.error}
                  fallback={<ArchitectureMessage value={language.t("architecture.panel.error")} />}
                >
                  <Show
                    when={activeSnapshot()}
                    fallback={<ArchitectureMessage value={language.t("architecture.panel.loading")} />}
                  >
                    <ArchitectureIsland
                      server={sdk().url}
                      directory={sdk().directory}
                      direction={language.direction()}
                      mobile={mobile()}
                      snapshot={activeSnapshot()!}
                      draft={draft()}
                      viewport={viewport()}
                      busy={state.busy}
                      action={state.action}
                      labels={labels()}
                      onJournal={journal}
                      onViewport={(change) => {
                        const workspace = sdk()
                        if (change.server !== workspace.url || change.directory !== workspace.directory) return
                        setPersistedState("viewports", change.resourceID, change.viewport)
                      }}
                      onSave={(change) => void save(change)}
                      onDuplicate={(change) => void duplicateResource(change)}
                      onAskSelection={askSelection}
                      onReload={reload}
                      onExport={exportPatch}
                      onExportResource={exportResource}
                      onConfirm={confirm}
                    />
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

function removeResourceSummary(current: ArchitectureListResourcesOutput["data"] | undefined, resourceID: string) {
  return current?.filter((item) => item.id !== resourceID)
}
