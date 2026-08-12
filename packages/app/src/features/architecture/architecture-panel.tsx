import { batch, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { useQueryClient } from "@tanstack/solid-query"
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
import { loadArchitectureResourceInstance, updateArchitectureResourceInstance } from "./api"
import { ArchitectureIsland } from "./architecture-island"
import {
  createArchitectureResourceAction,
  duplicateArchitectureResourceAction,
  reloadArchitectureResourceAction,
  removeArchitectureResourceAction,
  saveArchitectureResourceAction,
  type ArchitectureResourceActionError,
} from "./architecture-resource-actions"
import {
  ARCHITECTURE_COMMAND_EVENT,
  architectureCommandRequest,
  architectureCommandRequestTarget,
  architectureCommandRequestType,
  dispatchArchitectureCommand,
  type ArchitectureCommandAction,
} from "./commands"
import type {
  ArchitectureInstanceChange,
  ArchitectureConflictExplanation,
  ArchitectureLabels,
  ArchitectureOperation,
  ArchitecturePendingOverlay,
  ArchitectureResource,
  ArchitectureRuntimeDebugEvent,
  ArchitectureSelectionPrompt,
  ArchitectureViewport,
} from "./contract"
import {
  createArchitectureResourceListQuery,
  createArchitectureResourceQueryCache,
  createArchitectureSelectedResourceQueries,
} from "./architecture-resource-queries"
import { downloadArchitectureResourceExport } from "./export"
import {
  createArchitectureInstanceSynchronizer,
  discardSavedArchitectureLiveInstanceCache,
} from "./live-instance"
import {
  architectureInstanceCanSkipSave,
  architectureInstanceIsDirty,
  architectureInstanceResourceID,
  missingSelectedArchitectureResourceID,
  resolveArchitectureResourceSelection,
  resolveArchitectureResourceID,
} from "./resource-state"
import {
  architectureJournalDebugEvent,
  architectureSnapshotDebugEvent,
  prependArchitectureRuntimeDebugEvent,
} from "./runtime-debug"
import { architectureRuntimeController } from "./runtime-controller"
import { architectureSelectionText } from "./selection-prompt"
import { syncArchitectureServerEvent } from "./server-event-sync"
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
      pendingOverlays: {} as Record<string, ArchitecturePendingOverlay | undefined>,
      viewports: {} as Record<string, ArchitectureViewport | undefined>,
    }),
  )
  const [state, setState] = createStore({
    busy: false,
    action: undefined as ArchitectureCommandAction | undefined,
    liveInstanceVersions: {} as Record<string, number | undefined>,
    debugEvents: {} as Record<string, ReadonlyArray<ArchitectureRuntimeDebugEvent> | undefined>,
    removedResourceIDs: {} as Record<string, true | undefined>,
  })
  const instanceSynchronizers = new Map<string, ReturnType<typeof createArchitectureInstanceSynchronizer>>()
  const architectureQueries = createArchitectureResourceQueryCache({
    queryClient,
    server: () => sdk().url,
    directory: () => sdk().directory,
  })
  const operationScope = (resourceID: string) => {
    const workspace = sdk()
    return {
      api: serverSDK().currentApi,
      server: workspace.url,
      directory: workspace.directory,
      resourceID,
    }
  }
  const resourceListQuery = createArchitectureResourceListQuery({
    api: () => serverSDK().currentApi,
    directory: () => sdk().directory,
    available: architectureAvailable,
    busy: () => state.busy,
    removedResourceIDs: () => state.removedResourceIDs,
    cache: architectureQueries,
  })
  const resources = resourceListQuery.resources
  const selectableResources = resourceListQuery.selectableResources
  const selectedID = createMemo(() => {
    const id = persistedState.selectedID
    return id && state.removedResourceIDs[id] ? undefined : id
  })
  const resourceID = createMemo(() =>
    persistedReady() ? resolveArchitectureResourceID(selectedID(), selectableResources()) : undefined,
  )
  const localPendingOverlay = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.pendingOverlays[id] : undefined
  })
  const localDirty = () => architectureInstanceIsDirty({ pending: localPendingOverlay() })
  const appendDebugEvent = (event: ArchitectureRuntimeDebugEvent) => {
    setState("debugEvents", event.resourceID, (current) => prependArchitectureRuntimeDebugEvent(current, event))
  }
  const selectedResourceQueries = createArchitectureSelectedResourceQueries({
    api: () => serverSDK().currentApi,
    directory: () => sdk().directory,
    available: architectureAvailable,
    busy: () => state.busy,
    localDirty,
    selectedResourceID: resourceID,
    cache: architectureQueries,
  })
  const resource = selectedResourceQueries.resource
  const liveInstance = selectedResourceQueries.liveInstance
  const runtimeController = createMemo(() =>
    architectureRuntimeController({
      selectedResourceID: resourceID(),
      resources: selectableResources(),
      saved: resource.data,
      live: liveInstance.data,
      pending: localPendingOverlay(),
      debugEvents: resourceID() ? state.debugEvents[resourceID()!] : undefined,
    }),
  )
  const runtimeView = () => runtimeController().runtimeView
  const instanceSynchronizer = (scope: ReturnType<typeof operationScope>) => {
    const key = `${scope.server}\0${scope.directory}\0${scope.resourceID}`
    const current = instanceSynchronizers.get(key)
    if (current) return current
    const scopeQueries = architectureQueries.scope({ server: scope.server, directory: scope.directory })
    const created = createArchitectureInstanceSynchronizer({
      patch: (base, operations) => updateArchitectureResourceInstance(scope.api, scope.directory, base, operations),
      update: (updated) => {
        if (updated)
          appendDebugEvent(
            architectureSnapshotDebugEvent({
              resourceID: scope.resourceID,
              type: "sync",
              status: "succeeded",
              snapshot: updated.snapshot,
            }),
          )
        scopeQueries.adoptLiveInstance(scope.resourceID, updated)
      },
      adopt: (instance) => {
        if (instance)
          appendDebugEvent(
            architectureSnapshotDebugEvent({
              resourceID: scope.resourceID,
              type: "sync",
              status: "received",
              snapshot: instance.snapshot,
            }),
          )
        scopeQueries.setLiveInstance(scope.resourceID, instance)
      },
    })
    instanceSynchronizers.set(key, created)
    return created
  }
  const pending = createMemo(() => runtimeController().pending)
  const dirty = () => runtimeController().dirty
  const resourceOptions = createMemo(() => runtimeController().resourceOptions)
  const selectedResource = createMemo(() => runtimeController().selectedResource)
  const viewport = createMemo(() => {
    const id = resourceID()
    return id ? persistedState.viewports[id] : undefined
  })
  const liveInstanceVersion = createMemo(() => {
    const id = resourceID()
    return id ? (state.liveInstanceVersions[id] ?? 0) : 0
  })

  createEffect(() => {
    const id = resourceID()
    const snapshot = runtimeView().snapshot
    if (!id || !snapshot) return
    architectureQueries.setLiveInstance(id, (current) => discardSavedArchitectureLiveInstanceCache(current, snapshot))
  })

  createEffect(() => {
    const missing = missingSelectedArchitectureResourceID({
      selectedID: persistedState.selectedID,
      resources: selectableResources(),
      snapshot: resource.data,
      resourceError: resource.error,
    })
    if (!persistedReady() || !missing) return
    batch(() => {
      if (persistedState.selectedID === missing) setPersistedState("selectedID", undefined)
      setPersistedState("pendingOverlays", missing, undefined)
    })
  })

  createEffect(() => {
    const id = resourceID()
    if (!id || runtimeController().pendingCoveredResourceID !== id) return
    setPersistedState("pendingOverlays", id, undefined)
  })

  const conflictReasonLabel = (reason: ArchitectureConflictExplanation["reason"]) => {
    if (reason === "changed") return language.t("architecture.conflict.changed")
    if (reason === "missing") return language.t("architecture.conflict.missing")
    return language.t("architecture.conflict.exists")
  }
  const operationTypeLabel = (type: ArchitectureOperation["type"]) => {
    if (type === "resource.update") return language.t("architecture.operation.resourceUpdate")
    if (type === "tag.color") return language.t("architecture.operation.tagColor")
    if (type === "node.create") return language.t("architecture.operation.nodeCreate")
    if (type === "node.update") return language.t("architecture.operation.nodeUpdate")
    if (type === "node.position") return language.t("architecture.operation.nodePosition")
    if (type === "node.remove") return language.t("architecture.operation.nodeRemove")
    if (type === "edge.create") return language.t("architecture.operation.edgeCreate")
    if (type === "edge.update") return language.t("architecture.operation.edgeUpdate")
    return language.t("architecture.operation.edgeRemove")
  }
  const conflictTargetLabel = (target: ArchitectureConflictExplanation["target"]) => {
    if (target.kind === "tag") return language.t("architecture.conflict.target.tag", { id: target.id ?? "" })
    if (target.kind === "node") return language.t("architecture.conflict.target.node", { id: target.id ?? "" })
    if (target.kind === "edge") return language.t("architecture.conflict.target.edge", { id: target.id ?? "" })
    return target.id
      ? language.t("architecture.conflict.target.resource", { id: target.id })
      : language.t("architecture.conflict.target.graph")
  }

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
    defaultNodeText: language.t("architecture.node.defaultText"),
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
    conflictExplanation: (explanation) =>
      language.t("architecture.conflict.explanation", {
        reason: conflictReasonLabel(explanation.reason),
        operation: operationTypeLabel(explanation.operationType),
        target: conflictTargetLabel(explanation.target),
      }),
    debug: {
      title: language.t("architecture.debug.title"),
      resourceID: language.t("architecture.debug.resourceID"),
      dirty: language.t("architecture.debug.dirty"),
      dirtyReasons: language.t("architecture.debug.dirtyReasons"),
      syncStatus: language.t("architecture.debug.syncStatus"),
      pendingOperations: language.t("architecture.debug.pendingOperations"),
      conflicts: language.t("architecture.debug.conflicts"),
      liveInstance: language.t("architecture.debug.liveInstance"),
      savedRevision: language.t("architecture.debug.savedRevision"),
      savedDigest: language.t("architecture.debug.savedDigest"),
      visibleRevision: language.t("architecture.debug.visibleRevision"),
      visibleDigest: language.t("architecture.debug.visibleDigest"),
      yes: language.t("architecture.debug.yes"),
      no: language.t("architecture.debug.no"),
      none: language.t("architecture.debug.none"),
      statuses: {
        unselected: language.t("architecture.debug.status.unselected"),
        loading: language.t("architecture.debug.status.loading"),
        clean: language.t("architecture.debug.status.clean"),
        "live-instance": language.t("architecture.debug.status.liveInstance"),
        "local-pending": language.t("architecture.debug.status.localPending"),
        conflicted: language.t("architecture.debug.status.conflicted"),
        "pending-covered": language.t("architecture.debug.status.pendingCovered"),
      },
      reasons: {
        "pending-operations": language.t("architecture.debug.reason.pendingOperations"),
        "pending-conflicts": language.t("architecture.debug.reason.pendingConflicts"),
        "live-instance": language.t("architecture.debug.reason.liveInstance"),
      },
      activity: language.t("architecture.debug.activity"),
      noActivity: language.t("architecture.debug.noActivity"),
      eventTypes: {
        journal: language.t("architecture.debug.event.journal"),
        sync: language.t("architecture.debug.event.sync"),
        "server-event": language.t("architecture.debug.event.serverEvent"),
        save: language.t("architecture.debug.event.save"),
        reload: language.t("architecture.debug.event.reload"),
        "canvas-source": language.t("architecture.debug.event.canvasSource"),
      },
      eventStatuses: {
        recorded: language.t("architecture.debug.eventStatus.recorded"),
        received: language.t("architecture.debug.eventStatus.received"),
        started: language.t("architecture.debug.eventStatus.started"),
        succeeded: language.t("architecture.debug.eventStatus.succeeded"),
        failed: language.t("architecture.debug.eventStatus.failed"),
      },
      operationTypes: {
        "resource.update": operationTypeLabel("resource.update"),
        "tag.color": operationTypeLabel("tag.color"),
        "node.create": operationTypeLabel("node.create"),
        "node.update": operationTypeLabel("node.update"),
        "node.position": operationTypeLabel("node.position"),
        "node.remove": operationTypeLabel("node.remove"),
        "edge.create": operationTypeLabel("edge.create"),
        "edge.update": operationTypeLabel("edge.update"),
        "edge.remove": operationTypeLabel("edge.remove"),
      },
      eventOperations: (operations) => language.t("architecture.debug.eventOperations", { operations }),
    },
  }))

  createEffect(() => {
    const id = resourceID()
    if (persistedReady() && id && persistedState.selectedID !== id) setPersistedState("selectedID", id)
  })

  createEffect(() => {
    const current = sdk()
    const unsubscribe = serverSDK().event.on(current.directory, (event) => {
      const eventQueries = architectureQueries.scope({ server: current.url, directory: current.directory })
      syncArchitectureServerEvent({
        selectedResourceID: resourceID(),
        localDirty: localDirty(),
        resources: eventQueries.getResources(),
        event: { type: String(event.type), properties: event.properties, data: "data" in event ? event.data : undefined },
        snapshot: eventQueries.getSnapshot,
        currentInstance: eventQueries.getLiveInstance,
        loadInstance: (resourceID) =>
          eventQueries.observeLiveInstance(resourceID, () =>
            loadArchitectureResourceInstance(serverSDK().currentApi, current.directory, resourceID),
          ),
        setInstance: eventQueries.setLiveInstance,
        refetchResources: eventQueries.refetchResources,
        refetchResource: eventQueries.refetchResource,
        removeResource: (resourceID) => {
          batch(() => {
            setState("removedResourceIDs", resourceID, true)
            eventQueries.removeResource(resourceID)
            setPersistedState("pendingOverlays", resourceID, undefined)
            setPersistedState("viewports", resourceID, undefined)
            if (persistedState.selectedID === resourceID) setPersistedState("selectedID", undefined)
          })
        },
        debug: appendDebugEvent,
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

  const journal = (change: ArchitectureInstanceChange) => {
    const id = architectureInstanceResourceID(change)
    const workspace = sdk()
    if (change.server !== workspace.url || change.directory !== workspace.directory) return
    appendDebugEvent(architectureJournalDebugEvent(change))
    setPersistedState(
      "pendingOverlays",
      id,
      architectureInstanceCanSkipSave(change)
        ? undefined
        : {
            base: change.base,
            origin: change.origin,
            journalBase: change.base.resource,
            operations: change.operations,
            conflicts: change.conflicts,
          },
    )
    const scope = operationScope(id)
    const live = architectureQueries.scope({ server: scope.server, directory: scope.directory }).getLiveInstance(id)
    void instanceSynchronizer(scope)
      .synchronize(live?.snapshot ?? change.origin, change.resource)
      .catch(() => undefined)
  }

  const reportResourceActionError = (error: ArchitectureResourceActionError) => {
    if (error.action === "save") {
      showToast({ variant: "error", title: labels().saveFailed })
      return
    }
    if (error.action === "reload") {
      showToast({ variant: "error", title: language.t("architecture.panel.error") })
      return
    }
    if (error.action === "create") {
      showToast({ variant: "error", title: language.t("architecture.toast.resourceCreateFailed") })
      return
    }
    if (error.action === "duplicate") {
      showToast({ variant: "error", title: language.t("architecture.toast.resourceDuplicateFailed") })
      return
    }
    showToast({ variant: "error", title: language.t("architecture.toast.resourceDeleteFailed") })
  }

  const save = async (change: ArchitectureInstanceChange) => {
    const id = architectureInstanceResourceID(change)
    const workspace = sdk()
    const scope = operationScope(id)
    return saveArchitectureResourceAction({
      change,
      busy: state.busy,
      currentServer: workspace.url,
      currentDirectory: workspace.directory,
      currentLivePending: pending()?.instance,
      scope,
      cache: architectureQueries,
      synchronizer: instanceSynchronizer(scope),
      setBusy: (busy) => setState("busy", busy),
      clearPendingOverlay: (resourceID) => setPersistedState("pendingOverlays", resourceID, undefined),
      bumpLiveInstanceVersion: (resourceID) => setState("liveInstanceVersions", resourceID, (current) => (current ?? 0) + 1),
      debug: appendDebugEvent,
      onError: reportResourceActionError,
    }).then((result) => result.ok)
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

  const executeReloadResource = async (scope: ReturnType<typeof operationScope>) => {
    await reloadArchitectureResourceAction({
      busy: state.busy,
      scope,
      cache: architectureQueries,
      synchronizer: instanceSynchronizer(scope),
      setBusy: (busy) => setState("busy", busy),
      clearPendingOverlay: (resourceID) => setPersistedState("pendingOverlays", resourceID, undefined),
      bumpLiveInstanceVersion: (resourceID) => setState("liveInstanceVersions", resourceID, (current) => (current ?? 0) + 1),
      debug: appendDebugEvent,
      onError: reportResourceActionError,
    })
  }

  const reload = () => {
    const id = resourceID()
    if (!id || state.busy) return
    const scope = operationScope(id)
    if (!dirty()) {
      void executeReloadResource(scope)
      return
    }
    confirm(labels().discardConfirm, labels().reload, () => void executeReloadResource(scope))
  }

  const createResource = async () => {
    const workspace = sdk()
    await createArchitectureResourceAction({
      busy: state.busy,
      persistedReady: persistedReady(),
      scope: { api: serverSDK().currentApi, server: workspace.url, directory: workspace.directory },
      cache: architectureQueries,
      name: language.t("architecture.resource.defaultName", { number: (selectableResources()?.length ?? 0) + 1 }),
      setBusy: (busy) => setState("busy", busy),
      setSelectedID: (resourceID) => setPersistedState("selectedID", resourceID),
      onError: reportResourceActionError,
    })
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

  const duplicateResource = async (change: ArchitectureInstanceChange) => {
    const id = architectureInstanceResourceID(change)
    const workspace = sdk()
    const scope = operationScope(id)
    await duplicateArchitectureResourceAction({
      change,
      busy: state.busy,
      persistedReady: persistedReady(),
      currentServer: workspace.url,
      currentDirectory: workspace.directory,
      scope,
      cache: architectureQueries,
      name: language.t("architecture.resource.duplicateName", { name: change.resource.name }),
      setBusy: (busy) => setState("busy", busy),
      setSelectedID: (resourceID) => setPersistedState("selectedID", resourceID),
      onError: reportResourceActionError,
    })
  }

  const removeResource = () => {
    const current = runtimeView().snapshot
    if (!current || state.busy) return
    const workspace = sdk()
    const id = current.resource.id
    const scope = { api: serverSDK().currentApi, server: workspace.url, directory: workspace.directory, resourceID: id }
    confirm(language.t("architecture.confirm.deleteResource"), labels().delete, () => {
      void removeArchitectureResourceAction({
        snapshot: current,
        busy: state.busy,
        scope,
        cache: architectureQueries,
        getSelectedID: () => persistedState.selectedID,
        setSelectedID: (resourceID) => setPersistedState("selectedID", resourceID),
        getPendingOverlay: (resourceID) => persistedState.pendingOverlays[resourceID],
        setPendingOverlay: (resourceID, pending) => setPersistedState("pendingOverlays", resourceID, pending),
        getViewport: (resourceID) => persistedState.viewports[resourceID],
        setViewport: (resourceID, viewport) => setPersistedState("viewports", resourceID, viewport),
        setBusy: (busy) => setState("busy", busy),
        setRemovedResourceID: (resourceID, removed) => setState("removedResourceIDs", resourceID, removed),
        onError: reportResourceActionError,
      })
    })
  }

  const exportPatch = (operations: ReadonlyArray<ArchitectureOperation>) => {
    const current = pending()
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
              if (currentID && currentID !== next) void instanceSynchronizer(operationScope(currentID)).invalidate()
              if (next && persistedState.selectedID !== next) setPersistedState("selectedID", next)
            }}
            disabled={!persistedReady() || !resourceOptions().length || state.busy}
          />
          <div class="architecture-panel__actions">
            <ButtonV2
              size="small"
              variant={dirty() ? "contrast" : "neutral"}
              icon="check"
              disabled={state.busy || !runtimeView().snapshot}
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
              disabled={state.busy || !runtimeView().snapshot}
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
                <MenuV2.Item onSelect={requestDuplicateResource} disabled={state.busy || !runtimeView().snapshot}>
                  {language.t("architecture.resource.duplicate")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={removeResource} disabled={state.busy || !runtimeView().snapshot}>
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
                    when={runtimeView().visibleSnapshot}
                    fallback={<ArchitectureMessage value={language.t("architecture.panel.loading")} />}
                  >
                    <ArchitectureIsland
                      server={sdk().url}
                      directory={sdk().directory}
                      direction={language.direction()}
                      mobile={mobile()}
                      snapshot={runtimeView().visibleSnapshot!}
                      runtimeView={runtimeView()}
                      liveInstanceVersion={liveInstanceVersion()}
                      pending={pending()}
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
                      onCanvasSourceDebug={appendDebugEvent}
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
