import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import {
  createDefaultShape,
  createEmptyDocument,
  type CanvasDocument
} from '../../../design/canvas/canvas-types'
import { addPropertyTracks } from '../../../design/motion/canvas-motion-mutations'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { CanvasMotionDock } from './CanvasMotionDock'

let reducedMotion = false

function installDocument(withTrack = true): CanvasDocument {
  const document = createEmptyDocument()
  const frame = {
    ...createDefaultShape('frame', 0, 0),
    id: 'motion-frame',
    name: 'Hero frame',
    parentId: document.rootId,
    children: ['motion-card']
  }
  const card = {
    ...createDefaultShape('rect', 40, 80),
    id: 'motion-card',
    name: 'Feature card',
    parentId: frame.id,
    frameId: frame.id
  }
  document.objects[document.rootId] = {
    ...document.objects[document.rootId],
    children: [frame.id]
  }
  document.objects[frame.id] = frame
  document.objects[card.id] = card
  if (withTrack) {
    document.motion = addPropertyTracks(document.motion, {
      document,
      frameId: frame.id,
      targetShapeIds: [card.id],
      properties: ['x'],
      durationMs: 600
    })
  }
  useCanvasShapeStore.getState().loadDocument(document, 'motion-dock-test')
  useCanvasSelectionStore.setState({ selectedIds: new Set([card.id]) })
  useCanvasMotionStore.setState({ open: true, activeFrameId: frame.id })
  return document
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  reducedMotion = false
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), 'motion-dock-empty')
  useCanvasSelectionStore.setState({ selectedIds: new Set() })
  useCanvasMotionStore.getState().reset()
})

afterEach(() => {
  useCanvasMotionStore.getState().reset()
  vi.unstubAllGlobals()
})

describe('CanvasMotionDock', () => {
  it('renders the transport, accessible controls, and no-selection empty state', async () => {
    useCanvasMotionStore.setState({ open: true, activeFrameId: '__root__' })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    expect(renderer.root.findByProps({ 'aria-label': 'Motion dock' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-motion-timeline': true })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Play' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Motion playhead' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Playback mode' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Playback rate' })).toBeDefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('Select a layer or frame, then add a Motion preset.')
    await act(async () => renderer.unmount())
  })

  it('renders editable property rows and keyframe diamonds for the active frame', async () => {
    installDocument()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('Hero frame')
    expect(json).toContain('Feature card · x')
    expect(renderer.root.findByProps({ 'aria-label': 'x keyframe at 0ms' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'x keyframe at 600ms' })).toBeDefined()
    expect(json).toContain('Auto-key')
    expect(json).toContain('Fade')
    expect(json).toContain('Move')
    expect(json).toContain('Scale')
    expect(json).toContain('Rotate')
    await act(async () => renderer.unmount())
  })

  it('isolates Delete, Space, and select-all shortcuts inside the timeline boundary', async () => {
    installDocument()
    const track = useCanvasShapeStore.getState().document.motion!.timelines['motion-frame'].tracks[0]
    useCanvasMotionStore.getState().selectKeyframe(track.id, track.keyframes[1].id)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    const deletePrevented = vi.fn()
    const deleteStopped = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
        key: 'Delete',
        metaKey: false,
        ctrlKey: false,
        target: { matches: () => false },
        currentTarget: {},
        preventDefault: deletePrevented,
        stopPropagation: deleteStopped
      })
    })
    expect(deletePrevented).toHaveBeenCalledOnce()
    expect(deleteStopped).toHaveBeenCalledOnce()
    expect(
      useCanvasShapeStore.getState().document.motion!.timelines['motion-frame'].tracks[0].keyframes
    ).toHaveLength(1)

    const boundary = { matches: () => false }
    const spacePrevented = vi.fn()
    const spaceStopped = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
        key: ' ',
        metaKey: false,
        ctrlKey: false,
        target: boundary,
        currentTarget: boundary,
        preventDefault: spacePrevented,
        stopPropagation: spaceStopped
      })
    })
    expect(spacePrevented).toHaveBeenCalledOnce()
    expect(spaceStopped).toHaveBeenCalledOnce()
    expect(useCanvasMotionStore.getState().playing).toBe(true)

    const selectAllPrevented = vi.fn()
    const selectAllStopped = vi.fn()
    renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
      key: 'a',
      metaKey: true,
      ctrlKey: false,
      target: { matches: () => false },
      currentTarget: {},
      preventDefault: selectAllPrevented,
      stopPropagation: selectAllStopped
    })
    expect(selectAllPrevented).toHaveBeenCalledOnce()
    expect(selectAllStopped).toHaveBeenCalledOnce()

    await act(async () => {
      useCanvasMotionStore.getState().setPlaying(false)
      renderer.unmount()
    })
  })

  it('disables automatic playback under reduced-motion while keeping scrub controls', async () => {
    installDocument()
    reducedMotion = true
    useCanvasMotionStore.getState().setPlaying(true)
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('Reduced motion is enabled')
    expect(renderer.root.findByProps({ 'aria-label': 'Play' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Motion playhead' }).props.disabled).not.toBe(true)
    expect(useCanvasMotionStore.getState().playing).toBe(false)

    await act(async () => renderer.unmount())
  })
})
