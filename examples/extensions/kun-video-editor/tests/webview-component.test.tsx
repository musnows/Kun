import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VideoEditorWorkbench } from '../src/webview/app.js'
import type { EditorController } from '../src/webview/controller.js'
import { INITIAL_EDITOR_STATE, editorReducer, type EditorState } from '../src/webview/model.js'
import { makeArtifact, makeJob, makeSubtitleArtifact, makeViewProject } from './webview-fixtures.js'

describe('video editor full-page workbench', () => {
  it('renders every editing region with accessible landmarks and supported boundaries', () => {
    const project = makeViewProject()
    const job = {
      ...makeJob('completed'),
      result: {
        schemaVersion: 1 as const,
        generatedArtifacts: [makeArtifact('job_12345678'), makeSubtitleArtifact('job_12345678')]
      }
    }
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController({ ...state, jobs: [job] })} />)
    for (const label of ['Media library', 'Player', 'Transcript', 'Timeline', 'Inspector', 'Captions', 'Revisions', 'Preview and proof', 'Video Agent', 'Export jobs']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('href="#video-editor-main"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="Ordered timeline tracks"')
    for (const manualControl of ['Split at playhead', 'Apply trim', 'Move track', 'Reorder', 'Add caption', 'Canvas and fit']) {
      expect(html).toContain(manualControl)
    }
    expect(html).toContain('does not perform arbitrary visual-scene understanding')
    expect(html).toContain('Technically validated by FFmpeg/ffprobe; not visually reviewed.')
    expect(html).toContain('Preview')
    expect(html).toContain('Open with system app')
    expect(html).toContain('Show in folder')
    expect(html).toContain('local path stays hidden from the extension View')
  })

  it('renders explicit empty, interaction-required, reconnect and approval states', () => {
    let state: EditorState = editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' })
    state = {
      ...state,
      connection: 'reconnecting',
      notices: [{ id: 'picker', severity: 'warning', message: 'Select a file', interactionRequired: true }]
    }
    const emptyHtml = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    expect(emptyHtml).toContain('Create or open a project')
    expect(emptyHtml).toContain('A protected Kun desktop interaction is required.')

    const project = makeViewProject()
    const waitingState: EditorState = {
      ...editorReducer(state, { type: 'project', value: project }),
      jobs: [makeJob('running')],
      agentRun: {
        id: 'run-1',
        threadId: 'thread-1',
        ownerExtensionId: 'kun-examples.kun-video-editor',
        ownerExtensionVersion: '0.1.0',
        extensionVisibility: 'private',
        extensionBudget: {},
        toolCatalogEpoch: 'epoch-1',
        state: 'waiting-approval',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z'
      }
    }
    const waitingHtml = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(waitingState)} />)
    expect(waitingHtml).toContain('waiting for approval')
    expect(waitingHtml).toContain('Editable guidance')
    expect(waitingHtml).toContain('Cancel job')
  })
})

function stubController(state: EditorState): EditorController {
  const asynchronous = vi.fn(async () => undefined)
  const synchronous = vi.fn()
  return {
    state,
    refreshAll: asynchronous,
    createProject: asynchronous,
    openProject: asynchronous,
    importMedia: asynchronous,
    openAsset: asynchronous,
    refreshActiveLease: asynchronous,
    recoverMedia: asynchronous,
    applyOperations: asynchronous,
    undo: asynchronous,
    redo: asynchronous,
    readScript: asynchronous,
    editScript: synchronous,
    applyScript: asynchronous,
    seek: synchronous,
    togglePlaying: synchronous,
    selectItem: synchronous,
    selectCaption: synchronous,
    setTranscriptWindow: synchronous,
    setTimelineWindow: synchronous,
    startAgent: asynchronous,
    steerAgent: asynchronous,
    cancelAgent: asynchronous,
    startRender: asynchronous,
    cancelJob: asynchronous,
    openArtifact: asynchronous,
    revealArtifact: asynchronous,
    dismissNotice: synchronous
  }
}
