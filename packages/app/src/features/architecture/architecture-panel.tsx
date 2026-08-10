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
  architectureResourceQueryKey,
  architectureResourceDraftQueryKey,
  commitArchitectureResourceDraft,
  architectureResourcesQueryKey,
  createArchitectureResource,
  duplicateArchitectureResource,
  listArchitectureResources,
  loadArchitectureResource,
  loadArchitectureResourceDraft,
  loadArchitectureResourceDraftSnapshot,
  reloadArchitectureResourceDraft,
  removeArchitectureResource,
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
  architectureResourceEventInfo,
  architectureResourceDraftEventCache,
  architectureDraftEventIsStale,
  architectureResourceDraftEventInfo,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
  beginArchitectureLocalDraftOperation,
  beginArchitectureLocalSave,
  captureArchitectureLocalDraftOperationEvent,
  getArchitectureLocalDraftOperationEvent,
  isArchitectureLocalSaveEvent,
  rememberArchitectureLocalDraftOperationEvent,
} from "./event"
import { createArchitectureCacheOrder, guardedArchitectureCacheResponse } from "./cache-order"
import { downloadArchitectureResourceExport } from "./export"
import { applyOperations, rebaseOperations } from "./journal"
import {
  ArchitectureDraftSynchronizationCancelled,
  architectureLiveDraftCache,
  createArchitectureDraftSynchronizer,
  latestArchitectureLiveDraftCache,
  rebaseArchitectureDraft,
} from "./live-draft"
import {
  architectureDraftIsDirty,
  architectureDraftCanSkipSave,
  architectureDraftHasVisibleChanges,
  architectureDraftResourceID,
  architectureReloadSuccessState,
  architectureResourceSelectionOptions,
  architectureResourceSummary,
  architectureSaveSuccessState,
  latestArchitectureSnapshot,
  reconcileArchitectureSavedEvent,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
  selectedArchitectureSnapshot,
  selectedArchitectureResourceSummary,
  updateArchitectureResourceSummaries,
  visibleArchitectureDraft,
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
    reloadGenerations: {} as Record<string, number | undefined>,
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
      refetchInterval: state.busy ? false : 2_000,
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
  const resourceOptions = createMemo(() => architectureResourceSelectionOptions(resources.data, activeSnapshot()))
  const selectedResource = createMemo(() => selectedArchitectureResourceSummary(resourceID(), resourceOptions()))
  const activeLiveDraft = createMemo(() => {
    const id = resourceID()
    const current = liveDraft.data
    if (!id || current === undefined || current === null) return current
    if (current.snapshot.resource.id !== id) return undefined
    return current
  })
  const draftSynchronizer = (scope: ReturnType<typeof operationScope>) => {
    const key = draftSynchronizerKey(scope.server, scope.directory, scope.resourceID)
    const current = draftSynchronizers.get(key)
    if (current) return current
    const created = createArchitectureDraftSynchronizer({
      patch: (base, operations) => {
        const finishLocalDraftOperation = beginArchitectureLocalDraftOperation({
          server: scope.server,
          directory: scope.directory,
          resourceID: scope.resourceID,
          operation: "patch",
        })
        return updateArchitectureResourceDraft(scope.api, scope.directory, base, operations)
          .then((updated) => {
            if (updated)
              rememberArchitectureLocalDraftOperationEvent({
                server: scope.server,
                directory: scope.directory,
                event: {
                  resourceID: scope.resourceID,
                  action: "updated",
                  revision: updated.snapshot.resource.revision,
                  digest: updated.snapshot.digest,
                },
              })
            return updated
          })
          .finally(finishLocalDraftOperation)
      },
      update: (updated) =>
        setArchitectureQueryData<ArchitectureLiveDraftCache>(
          architectureResourceDraftQueryKey(scope.server, scope.directory, scope.resourceID),
          (current) => (updated ? latestArchitectureLiveDraftCache(current, updated) : updated),
        ),
      adopt: (draft) =>
        setArchitectureQueryData(architectureResourceDraftQueryKey(scope.server, scope.directory, scope.resourceID), draft),
    })
    draftSynchronizers.set(key, created)
    return created
  }
  const draft = createMemo(() => {
    const id = resourceID()
    const current = id ? persistedState.drafts[id] : undefined
    const snapshot = activeSnapshot()
    const live = activeLiveDraft()
    if (live && snapshot) {
      if (!current)
        return {
          base: snapshot,
          origin: live.snapshot,
          journalBase: live.snapshot.resource,
          operations: [],
          conflicts: [],
          live,
        }
      const rebased = rebaseArchitectureDraft(
        current.origin?.resource ?? current.base.resource,
        current.operations,
        live.snapshot.resource,
      )
      const conflicts = [
        ...current.conflicts,
        ...rebased.conflicts.filter(
          (candidate) =>
            !current.conflicts.some(
              (existing) => existing.operation.id === candidate.operation.id && existing.reason === candidate.reason,
            ),
        ),
      ]
      return {
        base: snapshot,
        origin: current.origin ?? live.snapshot,
        journalBase: rebased.base,
        operations: rebased.operations,
        conflicts,
        live,
      }
    }
    if (!current || !snapshot || current.base.digest === snapshot.digest) return current
    const rebased = rebaseOperations(current.base.resource, snapshot.resource, current.operations)
    return {
      base: snapshot,
      operations: rebased.operations,
      conflicts: [...current.conflicts, ...rebased.conflicts],
    }
  })
  const visibleDraft = createMemo(() => visibleArchitectureDraft(draft()))
  const viewport = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.viewports[id] : undefined
  })
  const reloadGeneration = createMemo(() => {
    const id = resourceID()
    return id ? (state.reloadGenerations[id] ?? 0) : 0
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
    const api = serverSDK().currentApi
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      const type = String(event.type)
      const resourcesKey = architectureResourcesQueryKey(current.url, current.directory)
      const draftEventInfo = architectureResourceDraftEventInfo({
        type,
        properties: event.properties,
        data: "data" in event ? event.data : undefined,
      })
      if (draftEventInfo) {
        const scope = {
          api,
          server: current.url,
          directory: current.directory,
          resourceID: draftEventInfo.resourceID,
        }
        if (
          captureArchitectureLocalDraftOperationEvent({
            server: current.url,
            directory: current.directory,
            event: draftEventInfo,
          })
        )
          return
        const draftKey = architectureResourceDraftQueryKey(current.url, current.directory, draftEventInfo.resourceID)
        const resourceKey = architectureResourceQueryKey(current.url, current.directory, draftEventInfo.resourceID)
        if (
          architectureDraftEventIsStale(
            queryClient.getQueryData<ArchitectureSnapshot>(resourceKey),
            draftEventInfo,
          )
        )
          return
        if (draftEventInfo.action === "discarded") {
          void draftSynchronizer(scope)
            .invalidate()
            .then(() =>
              draftSynchronizer(scope)
                .adoptSnapshot(() => loadArchitectureResourceDraftSnapshot(api, current.directory, draftEventInfo.resourceID))
                .catch((error) => {
                  if (error instanceof ArchitectureDraftSynchronizationCancelled) return
                  void queryClient.refetchQueries({
                    queryKey: draftKey,
                    exact: true,
                    type: "active",
                  })
                }),
            )
          return
        }
        const eventDraft = architectureResourceDraftEventCache(draftEventInfo)
        if (eventDraft) {
          void draftSynchronizer(scope).adopt(eventDraft).catch(() => undefined)
          return
        }
        void draftSynchronizer(scope)
          .adoptSnapshot(() => loadArchitectureResourceDraftSnapshot(api, current.directory, draftEventInfo.resourceID))
          .catch((error) => {
            if (error instanceof ArchitectureDraftSynchronizationCancelled) return
            void queryClient.refetchQueries({
              queryKey: draftKey,
              exact: true,
              type: "active",
            })
          })
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
        setPersistedState("viewports", eventInfo.resourceID, undefined)
        setState("reloadGenerations", eventInfo.resourceID, undefined)
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

  const dirty = () => architectureDraftIsDirty({ draft: visibleDraft() })

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
    const scope = operationScope(id)
    const live = queryClient.getQueryData<ArchitectureLiveDraftCache>(
      architectureResourceDraftQueryKey(scope.server, scope.directory, id),
    )
    setPersistedState("drafts", id, {
      base: change.base,
      origin: change.origin,
      operations: change.operations,
      conflicts: change.conflicts,
    })
    void draftSynchronizer(scope)
      .synchronize(live?.snapshot ?? change.origin, change.resource)
      .catch(() => undefined)
  }

  const save = async (change: ArchitectureDraftChange) => {
    const id = architectureDraftResourceID(change)
    if (state.busy) return false
    if (architectureDraftCanSkipSave(change)) return true
    const workspace = sdk()
    if (change.server !== workspace.url || change.directory !== workspace.directory) return false
    const scope = operationScope(id)
    setState("busy", true)
    const resourceKey = architectureResourceQueryKey(scope.server, scope.directory, id)
    const draftKey = architectureResourceDraftQueryKey(scope.server, scope.directory, id)
    const resourcesKey = architectureResourcesQueryKey(scope.server, scope.directory)
    const synchronizer = draftSynchronizer(scope)
    const finishLocalSave = beginArchitectureLocalSave({
      server: scope.server,
      directory: scope.directory,
      resourceID: id,
    })
    const finishLocalDraftOperation = beginArchitectureLocalDraftOperation({
      server: scope.server,
      directory: scope.directory,
      resourceID: id,
      operation: "save",
    })
    try {
      await synchronizer.invalidate()
      const synchronized = await synchronizer.synchronizeAuthoritative(
        () => loadArchitectureResourceDraftSnapshot(scope.api, scope.directory, id),
        (observed) => {
          const rebased = rebaseArchitectureDraft(change.origin.resource, change.operations, observed.snapshot.resource)
          return applyOperations(rebased.base, rebased.operations)
        },
      )
      const saved = await commitArchitectureResourceDraft(scope.api, scope.directory, synchronized)
      const settled = architectureSaveSuccessState({
        current: queryClient.getQueryData(resourceKey),
        saved,
        draft: queryClient.getQueryData(draftKey),
        draftEvent: getArchitectureLocalDraftOperationEvent({
          server: scope.server,
          directory: scope.directory,
          resourceID: id,
        }),
        reloadGeneration: state.reloadGenerations[id],
      })
      batch(() => {
        setArchitectureQueryData(resourceKey, settled.snapshot)
        setArchitectureQueryData(draftKey, settled.draft)
        setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
          updateArchitectureResourceSummaries(current, architectureResourceSummary(settled.snapshot)),
        )
        setPersistedState("drafts", id, undefined)
        setState("reloadGenerations", id, settled.reloadGeneration)
      })
      void synchronizer.adopt(settled.draft).catch((error) => {
        if (error instanceof ArchitectureDraftSynchronizationCancelled) return
      })
      return true
    } catch (error) {
      if (isConflict(error)) {
        await synchronizer.invalidate()
        const [latest, observedDraft] = await Promise.all([
          loadArchitectureResource(scope.api, scope.directory, id).catch(() => undefined),
          loadArchitectureResourceDraftSnapshot(scope.api, scope.directory, id).catch(() => undefined),
        ])
        if (latest) {
          const settled = latestArchitectureSnapshot(queryClient.getQueryData(resourceKey), latest)
          const eventDraft = observedDraft ? architectureLiveDraftCache(observedDraft) : undefined
          const rebased = eventDraft
            ? rebaseArchitectureDraft(change.origin.resource, change.operations, eventDraft.snapshot.resource)
            : isDraftCommitConflict(error)
              ? undefined
              : rebaseOperations(change.base.resource, settled.resource, change.operations)
          batch(() => {
            setArchitectureQueryData(resourceKey, settled)
            if (eventDraft !== undefined) setArchitectureQueryData(draftKey, eventDraft)
            setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
              updateArchitectureResourceSummaries(current, architectureResourceSummary(settled)),
            )
            setPersistedState("drafts", id, {
              base: settled,
              origin: eventDraft?.snapshot ?? (rebased ? settled : change.origin),
              operations: rebased?.operations ?? change.operations,
              conflicts: rebased ? mergeArchitectureConflicts(change.conflicts, rebased.conflicts) : change.conflicts,
            })
          })
        }
      } else {
        showToast({ variant: "error", title: labels().saveFailed })
      }
      return false
    } finally {
      const reconciliation = await reconcileArchitectureSavedEvent({
        current: queryClient.getQueryData(resourceKey),
        event: finishLocalSave(),
        observe: () => loadArchitectureResource(scope.api, scope.directory, id),
      })
      const observed = reconciliation.snapshot
      if (observed) {
        batch(() => {
          setArchitectureQueryData(resourceKey, (current: ArchitectureSnapshot | undefined) =>
            current ? latestArchitectureSnapshot(current, observed) : observed,
          )
          setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateArchitectureResourceSummaries(current, architectureResourceSummary(observed)),
          )
        })
      }
      if (reconciliation.invalidate) {
        void queryClient.invalidateQueries({ queryKey: resourceKey, exact: true })
        void queryClient.invalidateQueries({ queryKey: resourcesKey, exact: true })
      }
      finishLocalDraftOperation()
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
    const finishLocalDraftOperation = beginArchitectureLocalDraftOperation({
      server: scope.server,
      directory: scope.directory,
      resourceID: id,
      operation: "reload",
    })
    try {
      await synchronizer.invalidate()
      const reloaded = await reloadArchitectureResourceDraft(scope.api, scope.directory, id)
      const settled = architectureReloadSuccessState({
        reloaded,
        reloadGeneration: state.reloadGenerations[id],
      })
      batch(() => {
        setArchitectureQueryData(resourceKey, settled.snapshot)
        setArchitectureQueryData(draftKey, settled.draft)
        setArchitectureQueryData(
          resourcesKey,
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateArchitectureResourceSummaries(current, architectureResourceSummary(settled.snapshot)),
        )
        setPersistedState("drafts", id, undefined)
        setState("reloadGenerations", id, settled.reloadGeneration)
      })
      void synchronizer.adopt(settled.draft).catch((error) => {
        if (error instanceof ArchitectureDraftSynchronizationCancelled) return
      })
    } catch {
      showToast({ variant: "error", title: language.t("architecture.panel.error") })
    } finally {
      finishLocalDraftOperation()
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
        setArchitectureQueryData(
          architectureResourcesQueryKey(workspace.url, workspace.directory),
          (current: ArchitectureListResourcesOutput["data"] | undefined) =>
            updateArchitectureResourceSummaries(current, architectureResourceSummary(created)),
        )
        setPersistedState("selectedID", created.resource.id)
      })
      void resources.refetch()
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
    const sourceDraftKey = architectureResourceDraftQueryKey(scope.server, scope.directory, id)
    const resourcesKey = architectureResourcesQueryKey(scope.server, scope.directory)
    const synchronizer = draftSynchronizer(scope)
    try {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: sourceDraftKey, exact: true }),
        queryClient.cancelQueries({ queryKey: resourcesKey, exact: true }),
      ])
      // Duplicate the graph people are currently seeing. Unsaved local edits are first
      // admitted to the live draft layer; the saved source resource remains unchanged.
      if (architectureDraftHasVisibleChanges(change))
        await synchronizer.synchronizeAuthoritative(
          () => loadArchitectureResourceDraftSnapshot(scope.api, scope.directory, id),
          change.resource,
        )
      const created = await duplicateArchitectureResource(scope.api, scope.directory, id, {
        name: language.t("architecture.resource.duplicateName", { name: change.resource.name }),
      })
      batch(() => {
        setArchitectureQueryData(architectureResourceQueryKey(scope.server, scope.directory, created.resource.id), created)
        setArchitectureQueryData(architectureResourceDraftQueryKey(scope.server, scope.directory, created.resource.id), null)
        setArchitectureQueryData(resourcesKey, (current: ArchitectureListResourcesOutput["data"] | undefined) =>
          updateArchitectureResourceSummaries(current, architectureResourceSummary(created)),
        )
        setPersistedState("selectedID", created.resource.id)
      })
      void resources.refetch()
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
                      draft={visibleDraft()}
                      reloadGeneration={reloadGeneration()}
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

function isConflict(
  value: unknown,
): value is { readonly _tag: "ArchitectureConflictError"; readonly operation?: unknown } {
  return !!value && typeof value === "object" && "_tag" in value && value._tag === "ArchitectureConflictError"
}

function isDraftCommitConflict(value: unknown) {
  return isConflict(value) && "operation" in value && value.operation === "graph_draft_commit"
}

function mergeArchitectureConflicts(
  current: ArchitectureDraft["conflicts"],
  next: ArchitectureDraft["conflicts"],
) {
  return [
    ...current,
    ...next.filter(
      (candidate) =>
        !current.some(
          (existing) => existing.operation.id === candidate.operation.id && existing.reason === candidate.reason,
        ),
    ),
  ]
}

function draftSynchronizerKey(server: string, directory: string, resourceID: string) {
  return `${server}\0${directory}\0${resourceID}`
}
