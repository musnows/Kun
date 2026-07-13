import type { ExtensionHostClient, JsonValue } from '@kun/extension-api'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactUsesPlayer, useEditorController, type EditorController } from '../src/webview/controller.js'
import { makeArtifact, makeSubtitleArtifact } from './webview-fixtures.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

let renderer: ReactTestRenderer | undefined

afterEach(async () => {
  if (!renderer) return
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('video editor artifact controller integration', () => {
  it('keeps player media on leases and routes subtitle open/reveal through the trusted Host action', async () => {
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: `lease_${handleId}`,
      handleId,
      url: `kun-media://lease/${handleId}`,
      mimeType: 'image/png',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const performArtifactAction = vi.fn(async () => ({ performed: true as const }))
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [] } }
      return { content: {} }
    })
    const client = fakeClient({ openViewResource, performArtifactAction, executeCommand })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const proof = makeArtifact('job_12345678')
    const subtitle = makeSubtitleArtifact('job_12345678')
    expect(artifactUsesPlayer(proof)).toBe(true)
    expect(artifactUsesPlayer(subtitle)).toBe(false)

    await act(async () => controller!.openArtifact(proof))
    expect(openViewResource).toHaveBeenCalledWith({
      handleId: proof.mediaHandleId,
      contributionId: 'editor'
    })
    expect(performArtifactAction).not.toHaveBeenCalled()

    await act(async () => controller!.openArtifact(subtitle))
    await act(async () => controller!.revealArtifact(subtitle))
    expect(performArtifactAction).toHaveBeenNthCalledWith(1, {
      artifactId: subtitle.artifactId,
      action: 'open'
    })
    expect(performArtifactAction).toHaveBeenNthCalledWith(2, {
      artifactId: subtitle.artifactId,
      action: 'reveal'
    })
    expect(openViewResource).toHaveBeenCalledTimes(1)
    expect(executeCommand).not.toHaveBeenCalledWith('reveal-artifact', expect.anything())
  })
})

function CaptureController(props: {
  client: ExtensionHostClient
  capture(controller: EditorController): void
}): null {
  props.capture(useEditorController(props.client))
  return null
}

function fakeClient(input: {
  openViewResource: ReturnType<typeof vi.fn>
  performArtifactAction: ReturnType<typeof vi.fn>
  executeCommand: ReturnType<typeof vi.fn>
}): ExtensionHostClient {
  const event = () => ({ dispose: () => undefined })
  return {
    commands: { executeCommand: input.executeCommand },
    media: {
      openViewResource: input.openViewResource,
      performArtifactAction: input.performArtifactAction,
      release: vi.fn(async () => ({ released: true }))
    },
    jobs: {
      list: vi.fn(async () => ({ items: [] }))
    },
    agent: {},
    ui: {
      getTheme: vi.fn(async () => ({ kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false })),
      getLocale: vi.fn(async () => ({ language: 'en', direction: 'ltr', messages: {} })),
      getViewState: vi.fn(async () => undefined),
      setViewState: vi.fn(async () => undefined),
      onDidChangeTheme: event,
      onDidChangeLocale: event,
      onDidReceiveMessage: event
    },
    onDidError: event
  } as unknown as ExtensionHostClient
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
