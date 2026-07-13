import type { AgentRunEvent, JobEvent, MediaResourceLease } from '@kun/extension-api'
import { describe, expect, it } from 'vitest'
import { classifyError } from '../src/webview/controller.js'
import {
  INITIAL_EDITOR_STATE,
  VIEW_LIMITS,
  activeTranscriptSegment,
  editorReducer,
  proofIsStale,
  transcriptFrame,
  type RenderTicket
} from '../src/webview/model.js'
import { makeArtifact, makeJob, makeViewProject } from './webview-fixtures.js'

describe('video editor bounded View state', () => {
  it('bounds projections and retains revision-aware manual selection', () => {
    const project = makeViewProject()
    project.items = Array.from({ length: 620 }, (_, index) => ({
      ...project.items[0]!,
      id: `item-${index}`,
      timelineStartFrame: index * 100
    }))
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: project })
    expect(state.project?.items).toHaveLength(VIEW_LIMITS.items)
    state = editorReducer(state, { type: 'selection', itemId: 'item-42' })
    expect(state.selectedItemId).toBe('item-42')
    state = editorReducer(state, { type: 'seek', frame: -10 })
    expect(state.playheadFrame).toBe(0)
  })

  it('keeps an ordered bounded Agent window and refreshes authoritative revisions', () => {
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: makeViewProject() })
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      const event: AgentRunEvent = {
        runId: 'run-1',
        threadId: 'thread-1',
        sequence,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'progress',
        message: `event ${sequence}`
      }
      state = editorReducer(state, { type: 'agent-event', value: event })
    }
    expect(state.agentEvents).toHaveLength(VIEW_LIMITS.agentEvents)
    expect(state.agentEvents[0]?.sequence).toBe(45)
    expect(state.agentEvents.at(-1)?.sequence).toBe(300)

    state = editorReducer(state, { type: 'conflict', expectedRevision: 0, currentRevision: 1 })
    expect(state.conflict).toEqual({ expectedRevision: 0, currentRevision: 1 })
    state = editorReducer(state, { type: 'project', value: { ...makeViewProject(), currentRevision: 1 } })
    expect(state.conflict).toBeUndefined()
    expect(state.project?.currentRevision).toBe(1)
  })

  it('revokes stale media leases without retaining reusable URLs', () => {
    const lease: MediaResourceLease = {
      leaseId: 'lease_1234567890abcdef',
      handleId: 'media_1234567890abcdef',
      url: 'kun-media://session/token1234567890',
      mimeType: 'video/mp4',
      expiresAt: '2026-01-01T00:10:00.000Z'
    }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'lease', value: lease })
    state = editorReducer(state, { type: 'active-media', handleId: lease.handleId, url: lease.url })
    state = editorReducer(state, { type: 'media-revoked', handleId: lease.handleId })
    expect(state.activeMediaUrl).toBeUndefined()
    expect(state.leases[lease.handleId]).toBeUndefined()
    expect(state.revokedHandles).toContain(lease.handleId)
  })

  it('reconciles durable job events and fences proof staleness by revision', () => {
    const snapshot = makeJob('running')
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'jobs', value: [snapshot] })
    const event: JobEvent = {
      schemaVersion: 1,
      jobId: snapshot.id,
      kind: snapshot.kind,
      type: 'completed',
      state: 'completed',
      timestamp: '2026-01-01T00:02:00.000Z',
      executionAttempt: 1,
      sequence: 2,
      cursor: 'cursor_2',
      result: { schemaVersion: 1, generatedArtifacts: [makeArtifact(snapshot.id)] }
    }
    state = editorReducer(state, { type: 'job-event', value: event })
    expect(state.jobs[0]?.state).toBe('completed')
    expect(state.jobs[0]?.result?.generatedArtifacts).toHaveLength(1)

    const ticket: RenderTicket = {
      jobId: snapshot.id,
      projectId: 'demo-project',
      pinnedRevision: 0,
      renderKind: 'proof-frame',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    expect(proofIsStale(ticket, { ...makeViewProject(), currentRevision: 1 })).toBe(true)
    expect(proofIsStale(ticket, makeViewProject())).toBe(false)
  })

  it('classifies protected interaction and keeps transcript seek frame-native', () => {
    const notice = classifyError(
      { code: 'INTERACTION_REQUIRED', message: 'Desktop interaction required', retryable: true },
      'failed'
    )
    expect(notice.interactionRequired).toBe(true)
    expect(notice.severity).toBe('warning')
    expect(transcriptFrame(makeViewProject(), { startUs: 1_000_000 })).toBe(30)
    const shifted = makeViewProject()
    shifted.items[0] = {
      ...shifted.items[0]!,
      timelineStartFrame: 30,
      sourceStartUs: 1_000_000,
      sourceEndUs: 3_000_000,
      durationFrames: 60
    }
    expect(activeTranscriptSegment(shifted, 'asset-1', 30)?.id).toBe('segment-2')
  })
})
