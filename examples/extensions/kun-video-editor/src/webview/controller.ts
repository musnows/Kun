import {
  ExtensionApiError,
  type AgentRunEvent,
  type ExtensionHostClient,
  type GeneratedArtifact,
  type JobSnapshot,
  type JsonObject,
  type JsonValue,
  type MediaMetadata
} from '@kun/extension-api'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  INITIAL_EDITOR_STATE,
  VIEW_LIMITS,
  editorReducer,
  generatedArtifacts,
  toPersistedState,
  type CanvasFit,
  type CanvasPreset,
  type EditorNotice,
  type EditorState,
  type PersistedEditorState,
  type ProjectChange,
  type ProjectProjection,
  type ProjectSummary,
  type RenderTicket,
  type TimelineOperation
} from './model.js'

const TERMINAL_AGENT_STATES = new Set(['completed', 'failed', 'cancelled', 'budget-exhausted'])
const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const EDITOR_COMMAND = 'editor-request'

export type EditorController = {
  state: EditorState
  refreshAll(): Promise<void>
  createProject(name: string, preset: CanvasPreset): Promise<void>
  openProject(projectId: string): Promise<void>
  importMedia(): Promise<void>
  openAsset(assetId: string): Promise<void>
  refreshActiveLease(): Promise<void>
  recoverMedia(): Promise<void>
  applyOperations(operations: TimelineOperation[], summary: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  readScript(): Promise<void>
  editScript(markdown: string): void
  applyScript(ranges: Array<{ assetId: string; startUs: number; endUs: number; reason?: 'filler' | 'silence' | 'selection' }>): Promise<void>
  seek(frame: number): void
  togglePlaying(): void
  selectItem(itemId?: string): void
  selectCaption(captionId?: string): void
  setTranscriptWindow(start: number): void
  setTimelineWindow(start: number): void
  startAgent(prompt: string): Promise<void>
  steerAgent(prompt: string): Promise<void>
  cancelAgent(): Promise<void>
  startRender(
    kind: RenderTicket['renderKind'],
    captionMode: 'none' | 'burned' | 'sidecar' | 'both',
    subtitleFormat?: 'srt' | 'vtt'
  ): Promise<void>
  cancelJob(jobId: string): Promise<void>
  openArtifact(artifact: GeneratedArtifact): Promise<void>
  revealArtifact(artifact: GeneratedArtifact): Promise<void>
  dismissNotice(id: string): void
}

export function useEditorController(client: ExtensionHostClient): EditorController {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE)
  const stateRef = useRef(state)
  const ownedLeaseIds = useRef(new Set<string>())
  stateRef.current = state

  const pushNotice = useCallback((notice: Omit<EditorNotice, 'id'> & { id?: string }) => {
    dispatch({
      type: 'notice',
      value: { ...notice, id: notice.id ?? `notice-${Date.now().toString(36)}` }
    })
  }, [])

  const execute = useCallback(async (action: string, payload: JsonObject = {}): Promise<Record<string, unknown>> => {
    const result = await client.commands.executeCommand<JsonValue>(EDITOR_COMMAND, { action, payload })
    const outer = asRecord(result, `editor command ${action}`)
    return isRecord(outer.content) ? outer.content : outer
  }, [client])

  const loadProject = useCallback(async (projectId: string): Promise<ProjectProjection> => {
    const content = await execute('project.get', { projectId })
    const project = projectFrom(content)
    dispatch({ type: 'project', value: project })
    return project
  }, [execute])

  const loadProjects = useCallback(async (): Promise<ProjectSummary[]> => {
    const content = await execute('project.list')
    const projects = Array.isArray(content.projects)
      ? content.projects.filter(isProjectSummary).slice(0, VIEW_LIMITS.projects)
      : []
    dispatch({ type: 'projects', value: projects })
    return projects
  }, [execute])

  const refreshJobs = useCallback(async (): Promise<JobSnapshot[]> => {
    const page = await client.jobs.list({ limit: VIEW_LIMITS.jobs })
    dispatch({ type: 'jobs', value: page.items })
    return page.items
  }, [client])

  const restoreRun = useCallback(async (runId: string | undefined): Promise<void> => {
    if (!runId) return
    try {
      dispatch({ type: 'agent-run', value: await client.agent.getRun(runId) })
    } catch {
      pushNotice({
        id: 'run-unavailable',
        severity: 'warning',
        message: 'The previous Agent run is no longer available.'
      })
    }
  }, [client, pushNotice])

  const refreshAll = useCallback(async (): Promise<void> => {
    dispatch({ type: 'reconnect' })
    try {
      await Promise.all([
        loadProjects(),
        refreshJobs(),
        stateRef.current.project ? loadProject(stateRef.current.project.id) : Promise.resolve()
      ])
      if (stateRef.current.agentRun) await restoreRun(stateRef.current.agentRun.id)
      dispatch({ type: 'connection', value: 'online' })
    } catch (error) {
      dispatch({ type: 'connection', value: 'offline' })
      pushNotice(classifyError(error, 'Reconnect failed'))
    }
  }, [loadProject, loadProjects, pushNotice, refreshJobs, restoreRun])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const [theme, locale, restored, projects] = await Promise.all([
          client.ui.getTheme(),
          client.ui.getLocale(),
          client.ui.getViewState<JsonValue>(),
          loadProjects()
        ])
        if (disposed) return
        dispatch({ type: 'theme', value: theme })
        dispatch({ type: 'locale', value: locale })
        const persisted = persistedState(restored)
        dispatch({ type: 'initialized', ...(persisted ? { persisted } : {}) })
        await refreshJobs()
        if (persisted?.projectId && projects.some(({ id }) => id === persisted.projectId)) {
          await loadProject(persisted.projectId)
        } else {
          const active = await execute('project.active')
          if (isRecord(active.project)) dispatch({ type: 'project', value: projectFrom(active) })
        }
        await restoreRun(persisted?.activeRunId)
      } catch (error) {
        if (disposed) return
        dispatch({ type: 'initialized' })
        dispatch({ type: 'connection', value: 'offline' })
        pushNotice(classifyError(error, 'The editor could not initialize'))
      }
    })()
    return () => { disposed = true }
  }, [client, execute, loadProject, loadProjects, pushNotice, refreshJobs, restoreRun])

  useEffect(() => {
    const themeSubscription = client.ui.onDidChangeTheme((value) => dispatch({ type: 'theme', value }))
    const localeSubscription = client.ui.onDidChangeLocale((value) => dispatch({ type: 'locale', value }))
    const errorSubscription = client.onDidError((error) => pushNotice(classifyError(error, 'Host client error')))
    const messageSubscription = client.ui.onDidReceiveMessage((message) => {
      if (message.channel === 'kun.extension.view.overflow') {
        void refreshAll()
        return
      }
      if (message.channel === 'kun-video-editor.project-changed') {
        const change = projectChange(message.payload)
        if (change) dispatch({ type: 'project-change', value: change })
        if (change && change.projectId === stateRef.current.project?.id) void loadProject(change.projectId)
        return
      }
      if (message.channel === 'kun-video-editor.command-progress') {
        const progress = isRecord(message.payload) ? message.payload : {}
        if (typeof progress.message === 'string') {
          pushNotice({ id: 'command-progress', severity: 'info', message: progress.message })
        }
      }
    })
    return () => {
      void themeSubscription.dispose()
      void localeSubscription.dispose()
      void errorSubscription.dispose()
      void messageSubscription.dispose()
    }
  }, [client, loadProject, pushNotice, refreshAll])

  useEffect(() => {
    if (!state.initialized) return
    const timeout = setTimeout(() => {
      void client.ui.setViewState(toPersistedState(stateRef.current)).catch((error) => {
        pushNotice(classifyError(error, 'View state could not be saved'))
      })
    }, 180)
    return () => clearTimeout(timeout)
  }, [client, pushNotice, state.agentRun?.id, state.initialized, state.playheadFrame, state.project?.id, state.renderTickets, state.selectedItemId, state.transcriptWindowStart])

  useEffect(() => {
    const run = state.agentRun
    if (!run || TERMINAL_AGENT_STATES.has(run.state)) return
    let disposed = false
    let subscription: Awaited<ReturnType<typeof client.agent.subscribe>> | undefined
    let eventSubscription: { dispose(): void | Promise<void> } | undefined
    void client.agent.subscribe({
      runId: run.id,
      afterSequence: stateRef.current.agentEvents.at(-1)?.sequence ?? 0
    }).then((created) => {
      if (disposed) return void created.dispose()
      subscription = created
      eventSubscription = created.onEvent((event) => {
        dispatch({ type: 'agent-event', value: event })
        if (event.type === 'state' || event.type === 'terminal') {
          void client.agent.getRun(run.id).then((value) => dispatch({ type: 'agent-run', value }))
        }
        if (agentEventChangesProject(event) && stateRef.current.project) {
          void loadProject(stateRef.current.project.id)
        }
      })
    }).catch((error) => pushNotice(classifyError(error, 'Agent event stream disconnected')))
    return () => {
      disposed = true
      void eventSubscription?.dispose()
      void subscription?.dispose()
    }
  }, [client, loadProject, pushNotice, state.agentRun?.id, state.reconnectToken])

  const activeJobsKey = useMemo(() => state.jobs
    .filter(({ state: jobState }) => !TERMINAL_JOB_STATES.has(jobState))
    .map(({ id, state: jobState }) => `${id}:${jobState}`)
    .sort()
    .join('|'), [state.jobs])

  useEffect(() => {
    const active = state.jobs.filter(({ state: jobState }) => !TERMINAL_JOB_STATES.has(jobState))
    const disposables: Array<{ dispose(): void | Promise<void> }> = []
    let disposed = false
    for (const job of active) {
      void client.jobs.subscribe({ jobId: job.id, afterCursor: job.latestCursor }).then((subscription) => {
        if (disposed) return void subscription.dispose()
        disposables.push(subscription)
        dispatch({
          type: 'jobs',
          value: [
            ...stateRef.current.jobs.filter(({ id }) => id !== subscription.snapshot.id),
            subscription.snapshot
          ]
        })
        if (subscription.replayGap) {
          pushNotice({
            id: `job-gap-${job.id}`,
            severity: 'warning',
            message: 'Some retained job progress expired; the current durable snapshot was restored.'
          })
        }
        disposables.push(subscription.onEvent((event) => dispatch({ type: 'job-event', value: event })))
      }).catch((error) => pushNotice(classifyError(error, `Job ${job.id} disconnected`)))
    }
    return () => {
      disposed = true
      for (const disposable of disposables) void disposable.dispose()
    }
  }, [activeJobsKey, client, pushNotice, state.reconnectToken])

  useEffect(() => () => {
    for (const leaseId of ownedLeaseIds.current) {
      void client.media.release({ resource: 'lease', leaseId }).catch(() => undefined)
    }
  }, [client])

  const withBusy = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    dispatch({ type: 'busy', value: true })
    try {
      await operation()
    } catch (error) {
      const currentRevision = revisionFromError(error)
      if (isRevisionConflict(error) && stateRef.current.project) {
        dispatch({
          type: 'conflict',
          expectedRevision: stateRef.current.project.currentRevision,
          ...(currentRevision === undefined ? {} : { currentRevision })
        })
        await loadProject(stateRef.current.project.id).catch(() => undefined)
      }
      pushNotice(classifyError(error, 'Editor operation failed'))
    } finally {
      dispatch({ type: 'busy', value: false })
    }
  }, [loadProject, pushNotice])

  const createProject = useCallback(async (name: string, preset: CanvasPreset): Promise<void> => {
    await withBusy(async () => {
      const normalized = name.trim().slice(0, 160)
      if (!normalized) throw new Error('Project name is required.')
      const idBase = normalized.toLowerCase().replace(/[^a-z0-9._~-]+/gu, '-').replace(/^-|-$/gu, '') || 'video'
      const projectId = `${idBase.slice(0, 96)}-${Date.now().toString(36)}`
      const content = await execute('project.create', { projectId, name: normalized, canvasPreset: preset })
      dispatch({ type: 'project', value: projectFrom(content) })
      await loadProjects()
    })
  }, [execute, loadProjects, withBusy])

  const openProject = useCallback(async (projectId: string): Promise<void> => {
    await withBusy(async () => { await loadProject(projectId) })
  }, [loadProject, withBusy])

  const importMedia = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      const selection = await client.media.pickFiles({
        multiple: true,
        maxFiles: 8,
        filters: [{
          name: 'Video and audio',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4a', 'mp3', 'wav'],
          mimeTypes: ['video/*', 'audio/*']
        }]
      })
      if (selection.outcome === 'cancelled') return
      dispatch({ type: 'media', value: selection.files })
      let revision = project.currentRevision
      for (const file of selection.files) {
        const content = await execute('media.import', {
          projectId: project.id,
          expectedRevision: revision,
          mediaHandleId: file.handleId,
          addToTimeline: true
        })
        revision = safeInteger(content.currentRevision) ?? revision + 1
      }
      await loadProject(project.id)
      await loadProjects()
    })
  }, [client, execute, loadProject, loadProjects, withBusy])

  const openMediaHandle = useCallback(async (handleId: string): Promise<void> => {
    const existing = stateRef.current.leases[handleId]
    if (existing && Date.parse(existing.expiresAt) - Date.now() > 30_000) {
      dispatch({ type: 'active-media', handleId, url: existing.url })
      return
    }
    try {
      const previous = stateRef.current.activeMediaHandleId
      if (previous && previous !== handleId) {
        const lease = stateRef.current.leases[previous]
        if (lease) {
          ownedLeaseIds.current.delete(lease.leaseId)
          await client.media.release({ resource: 'lease', leaseId: lease.leaseId }).catch(() => undefined)
        }
      }
      const lease = await client.media.openViewResource({ handleId, contributionId: 'editor' })
      ownedLeaseIds.current.add(lease.leaseId)
      dispatch({ type: 'lease', value: lease })
      dispatch({ type: 'active-media', handleId, url: lease.url })
    } catch (error) {
      if (isRevokedMediaError(error)) dispatch({ type: 'media-revoked', handleId })
      throw error
    }
  }, [client])

  const openAsset = useCallback(async (assetId: string): Promise<void> => {
    const project = requiredProject(stateRef.current)
    const asset = project.assets.find(({ id }) => id === assetId)
    if (!asset?.mediaHandleId) {
      pushNotice({ id: 'asset-unavailable', severity: 'warning', message: 'This asset has no available media handle.' })
      return
    }
    dispatch({ type: 'selection', assetId })
    await withBusy(() => openMediaHandle(asset.mediaHandleId!))
  }, [openMediaHandle, pushNotice, withBusy])

  const refreshActiveLease = useCallback(async (): Promise<void> => {
    const handleId = stateRef.current.activeMediaHandleId
    if (!handleId) return
    const lease = stateRef.current.leases[handleId]
    if (lease) {
      ownedLeaseIds.current.delete(lease.leaseId)
      await client.media.release({ resource: 'lease', leaseId: lease.leaseId }).catch(() => undefined)
    }
    dispatch({ type: 'lease-release', handleId })
    await withBusy(() => openMediaHandle(handleId))
  }, [client, openMediaHandle, withBusy])

  const recoverMedia = useCallback(async (): Promise<void> => {
    await importMedia()
  }, [importMedia])

  const applyOperations = useCallback(async (operations: TimelineOperation[], summary: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      await execute('project.update', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        operations: operations as unknown as JsonValue,
        summary: summary.slice(0, 512)
      })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [execute, loadProject, loadProjects, withBusy])

  const history = useCallback(async (action: 'project.undo' | 'project.redo'): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      await execute(action, { projectId: project.id, expectedRevision: project.currentRevision })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [execute, loadProject, loadProjects, withBusy])

  const undo = useCallback(() => history('project.undo'), [history])
  const redo = useCallback(() => history('project.redo'), [history])

  const readScript = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      const content = await execute('script.read', { projectId: project.id, expectedRevision: project.currentRevision })
      const markdown = typeof content.timelineMarkdown === 'string' ? content.timelineMarkdown : ''
      const digest = typeof content.digest === 'string' ? content.digest : ''
      dispatch({ type: 'script', revision: safeInteger(content.currentRevision) ?? project.currentRevision, digest, markdown })
    })
  }, [execute, withBusy])

  const editScript = useCallback((markdown: string) => dispatch({ type: 'script-edit', markdown }), [])

  const applyScript = useCallback(async (
    ranges: Array<{ assetId: string; startUs: number; endUs: number; reason?: 'filler' | 'silence' | 'selection' }>
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      const script = stateRef.current.script
      if (!script) throw new Error('Read timeline.md before applying transcript ranges.')
      if (ranges.length === 0 || ranges.length > 2_000) throw new Error('Provide 1 to 2,000 explicit timed source ranges.')
      await execute('script.apply', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        timelineMarkdown: script.markdown,
        ranges: ranges as unknown as JsonValue,
        summary: 'Applied reviewed transcript ranges from the full-page editor'
      })
      await loadProject(project.id)
      await readScript()
    })
  }, [execute, loadProject, readScript, withBusy])

  const startAgent = useCallback(async (prompt: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      const input = prompt.trim()
      if (!input) throw new Error('Describe the editing goal before starting the Agent.')
      const created = await client.agent.createRun({
        input,
        profileId: 'video-editor',
        visibility: 'private',
        metadata: { projectId: project.id, expectedRevision: project.currentRevision },
        budget: { maxTokens: 32_768, maxElapsedMs: 1_800_000, maxModelRequests: 48, maxToolInvocations: 96, maxEvents: 4_000 }
      })
      dispatch({ type: 'agent-run', value: created.run })
    })
  }, [client, withBusy])

  const steerAgent = useCallback(async (prompt: string): Promise<void> => {
    await withBusy(async () => {
      const run = stateRef.current.agentRun
      if (!run) throw new Error('No Agent run is active.')
      const input = prompt.trim()
      if (!input) throw new Error('Guidance cannot be empty.')
      const result = await client.agent.steer({ runId: run.id, input })
      dispatch({ type: 'agent-run', value: result.run })
    })
  }, [client, withBusy])

  const cancelAgent = useCallback(async (): Promise<void> => {
    const run = stateRef.current.agentRun
    if (!run) return
    await withBusy(async () => {
      const result = await client.agent.cancel({ runId: run.id, reason: 'Cancelled from the video editor review checkpoint' })
      dispatch({ type: 'agent-run', value: result.run })
    })
  }, [client, withBusy])

  const startRender = useCallback(async (
    kind: RenderTicket['renderKind'],
    captionMode: 'none' | 'burned' | 'sidecar' | 'both',
    subtitleFormat: 'srt' | 'vtt' = 'srt'
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current)
      const extension = kind === 'proof-frame' ? 'png' : kind === 'audio-aac' ? 'm4a' : 'mp4'
      const mimeType = kind === 'proof-frame' ? 'image/png' : kind === 'audio-aac' ? 'audio/mp4' : 'video/mp4'
      const picked = await client.media.pickSaveTarget({
        suggestedName: `${project.id}-revision-${project.currentRevision}.${extension}`,
        filters: [{ name: 'Rendered media', extensions: [extension], mimeTypes: [mimeType] }]
      })
      if (picked.outcome === 'cancelled') return
      let subtitleTarget: typeof picked.target | undefined
      if (captionMode === 'sidecar' || captionMode === 'both') {
        const subtitle = await client.media.pickSaveTarget({
          suggestedName: `${project.id}-revision-${project.currentRevision}.${subtitleFormat}`,
          filters: [{
            name: subtitleFormat === 'srt' ? 'SubRip captions' : 'WebVTT captions',
            extensions: [subtitleFormat],
            mimeTypes: [subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt']
          }]
        })
        if (subtitle.outcome === 'cancelled') {
          await client.media.release({ resource: 'handle', handleId: picked.target.handleId }).catch(() => undefined)
          return
        }
        subtitleTarget = subtitle.target
      }
      dispatch({ type: 'media', value: [picked.target, ...(subtitleTarget ? [subtitleTarget] : [])] })
      const content = await execute('render.start', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        kind,
        outputHandleId: picked.target.handleId,
        ...(kind === 'proof-frame' ? { proofFrame: stateRef.current.playheadFrame } : {}),
        captionMode,
        ...(subtitleTarget ? {
          subtitleOutputHandleId: subtitleTarget.handleId,
          subtitleFormat
        } : {}),
        idempotencyKey: `${project.id}-${project.currentRevision}-${kind}-${Date.now().toString(36)}`
      })
      if (typeof content.jobId !== 'string') throw new Error('Render did not return a durable job ID.')
      const ticket: RenderTicket = {
        jobId: content.jobId,
        projectId: project.id,
        pinnedRevision: safeInteger(content.pinnedRevision) ?? project.currentRevision,
        renderKind: isRenderKind(content.renderKind) ? content.renderKind : kind,
        createdAt: new Date().toISOString()
      }
      dispatch({ type: 'render-ticket', value: ticket })
      const snapshot = await client.jobs.get(ticket.jobId)
      dispatch({ type: 'jobs', value: [...stateRef.current.jobs, snapshot] })
    })
  }, [client, execute, withBusy])

  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const result = await client.jobs.cancel({ jobId, reason: 'Cancelled from the video editor export panel' })
      dispatch({ type: 'jobs', value: stateRef.current.jobs.map((job) => job.id === jobId ? result.snapshot : job) })
    })
  }, [client, withBusy])

  const openArtifact = useCallback(async (artifact: GeneratedArtifact): Promise<void> => {
    if (artifact.availability !== 'available') {
      pushNotice({ id: `artifact-${artifact.artifactId}`, severity: 'warning', message: 'This generated artifact is unavailable.' })
      return
    }
    if (artifactUsesPlayer(artifact)) {
      await withBusy(() => openMediaHandle(artifact.mediaHandleId))
      return
    }
    await withBusy(async () => {
      await client.media.performArtifactAction({ artifactId: artifact.artifactId, action: 'open' })
    })
  }, [client, openMediaHandle, pushNotice, withBusy])

  const revealArtifact = useCallback(async (artifact: GeneratedArtifact): Promise<void> => {
    if (artifact.availability !== 'available') {
      pushNotice({
        id: `artifact-${artifact.artifactId}`,
        severity: 'warning',
        message: 'This generated artifact is unavailable.'
      })
      return
    }
    await withBusy(async () => {
      await client.media.performArtifactAction({ artifactId: artifact.artifactId, action: 'reveal' })
    })
  }, [client, pushNotice, withBusy])

  return {
    state,
    refreshAll,
    createProject,
    openProject,
    importMedia,
    openAsset,
    refreshActiveLease,
    recoverMedia,
    applyOperations,
    undo,
    redo,
    readScript,
    editScript,
    applyScript,
    seek: (frame) => dispatch({ type: 'seek', frame }),
    togglePlaying: () => dispatch({ type: 'playing', value: !stateRef.current.playing }),
    selectItem: (itemId) => dispatch({ type: 'selection', itemId, captionId: undefined }),
    selectCaption: (captionId) => dispatch({ type: 'selection', captionId, itemId: undefined }),
    setTranscriptWindow: (start) => dispatch({ type: 'transcript-window', start }),
    setTimelineWindow: (start) => dispatch({ type: 'timeline-window', start }),
    startAgent,
    steerAgent,
    cancelAgent,
    startRender,
    cancelJob,
    openArtifact,
    revealArtifact,
    dismissNotice: (id) => dispatch({ type: 'dismiss-notice', id })
  }
}

export function artifactUsesPlayer(artifact: GeneratedArtifact): boolean {
  if (artifact.mimeType === 'application/x-subrip' || artifact.mimeType === 'text/vtt') return false
  return artifact.mediaKind === 'video' || artifact.mediaKind === 'audio' || artifact.mediaKind === 'image'
}

export function classifyError(error: unknown, fallback: string): Omit<EditorNotice, 'id'> {
  const api = error instanceof ExtensionApiError ? error : undefined
  const code = api?.code ?? (isRecord(error) && typeof error.code === 'string' ? error.code : '')
  const message = error instanceof Error && error.message ? error.message.slice(0, 1_000) : fallback
  const interactionRequired = /INTERACTION_REQUIRED|interaction.required/iu.test(code) || /interaction required/iu.test(message)
  return {
    severity: interactionRequired ? 'warning' : 'error',
    message: interactionRequired ? `${message} Complete the protected desktop interaction and retry.` : message,
    interactionRequired,
    retryable: api?.retryable ?? true
  }
}

function projectFrom(content: Record<string, unknown>): ProjectProjection {
  const value = isRecord(content.project) ? content.project : content
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isRecord(value.fps) ||
    !isRecord(value.canvas) ||
    !Number.isSafeInteger(value.currentRevision)
  ) throw new Error('Host returned an invalid video project projection.')
  return value as unknown as ProjectProjection
}

function persistedState(value: JsonValue | undefined): PersistedEditorState | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined
  return {
    schemaVersion: 1,
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    ...(typeof value.selectedItemId === 'string' ? { selectedItemId: value.selectedItemId } : {}),
    playheadFrame: safeInteger(value.playheadFrame) ?? 0,
    ...(typeof value.activeRunId === 'string' ? { activeRunId: value.activeRunId } : {}),
    renderTickets: Array.isArray(value.renderTickets)
      ? value.renderTickets.filter(isRenderTicket).slice(-VIEW_LIMITS.jobs)
      : [],
    transcriptWindowStart: safeInteger(value.transcriptWindowStart) ?? 0
  }
}

function projectChange(value: JsonValue): ProjectChange | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.projectId !== 'string') return undefined
  return {
    schemaVersion: 1,
    projectId: value.projectId,
    revision: safeInteger(value.revision) ?? 0,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 256) : 'changed',
    changedIds: Array.isArray(value.changedIds)
      ? value.changedIds.filter((item): item is string => typeof item === 'string').slice(0, 2_000)
      : []
  }
}

function requiredProject(state: EditorState): ProjectProjection {
  if (!state.project) throw new Error('Open a project before performing this operation.')
  return state.project
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Host returned an invalid ${label} response.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    Number.isSafeInteger(value.currentRevision) && typeof value.updatedAt === 'string' &&
    Number.isSafeInteger(value.durationFrames)
}

function isRenderKind(value: unknown): value is RenderTicket['renderKind'] {
  return ['proof-frame', 'preview', 'h264-mp4', 'audio-aac'].includes(String(value))
}

function isRenderTicket(value: unknown): value is RenderTicket {
  return isRecord(value) && typeof value.jobId === 'string' && typeof value.projectId === 'string' &&
    Number.isSafeInteger(value.pinnedRevision) && isRenderKind(value.renderKind) && typeof value.createdAt === 'string'
}

function isRevisionConflict(error: unknown): boolean {
  const code = error instanceof ExtensionApiError ? error.code : isRecord(error) ? error.code : undefined
  const message = error instanceof Error ? error.message : ''
  const engineCode = error instanceof ExtensionApiError ? error.details?.engineCode : undefined
  return (
    code === 'CONFLICT' && (engineCode === 'revision_conflict' || engineCode === 'script_stale')
  ) || /REVISION_CONFLICT|revision.conflict/iu.test(String(code)) || /revision (?:conflict|has changed)/iu.test(message)
}

function revisionFromError(error: unknown): number | undefined {
  if (!(error instanceof ExtensionApiError) || !error.details) return undefined
  return safeInteger(error.details.currentRevision)
}

function isRevokedMediaError(error: unknown): boolean {
  const code = error instanceof ExtensionApiError ? error.code : isRecord(error) ? error.code : undefined
  const message = error instanceof Error ? error.message : ''
  return /MEDIA_(?:HANDLE_)?REVOKED|MEDIA_NOT_FOUND/iu.test(String(code)) || /media (?:handle )?(?:was )?(?:revoked|replaced|not found)/iu.test(message)
}

function agentEventChangesProject(event: AgentRunEvent): boolean {
  if (event.type !== 'message' && event.type !== 'progress') return false
  return JSON.stringify(event).includes('currentRevision') || JSON.stringify(event).includes('project-changed')
}

export function artifactsForJobs(jobs: readonly JobSnapshot[]): GeneratedArtifact[] {
  const byId = new Map<string, GeneratedArtifact>()
  for (const job of jobs) for (const artifact of generatedArtifacts(job)) byId.set(artifact.artifactId, artifact)
  return [...byId.values()].slice(-64)
}
