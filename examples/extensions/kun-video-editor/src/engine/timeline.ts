import { engineError } from './errors.js'
import {
  MAX_PROJECT_HISTORY,
  TimelineOperationSchema,
  VideoProjectSchema,
  type CanvasFit,
  type CanvasPreset,
  type MediaAsset,
  type Rational,
  type TimelineItem,
  type TimelineOperation,
  type Track,
  type VideoProject
} from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, normalizeRational } from './time.js'

export type TimelineValidationIssue = {
  path: string
  code: string
  message: string
}

export type ApplyOperationsResult = {
  project: VideoProject
  inverseOperations: TimelineOperation[]
  changedIds: string[]
}

export type AssetTimeRange = {
  assetId: string
  startUs: number
  endUs: number
  reason?: 'filler' | 'silence' | 'selection'
}

export const CANVAS_PRESETS: Readonly<Record<CanvasPreset, { width: number; height: number }>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
}

export function projectDurationFrames(project: VideoProject): number {
  const itemEnd = project.items.reduce(
    (maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames),
    0
  )
  const captionEnd = project.captions.reduce(
    (maximum, caption) => Math.max(maximum, caption.endFrame),
    0
  )
  return Math.max(itemEnd, captionEnd)
}

export function validateTimeline(project: VideoProject): TimelineValidationIssue[] {
  const issues: TimelineValidationIssue[] = []
  try {
    VideoProjectSchema.parse(project)
  } catch (error) {
    issues.push({
      path: 'project',
      code: 'schema',
      message: error instanceof Error ? error.message : String(error)
    })
    return issues
  }

  unique(project.assets, 'assets', issues)
  unique(project.tracks, 'tracks', issues)
  unique(project.items, 'items', issues)
  unique(project.captions, 'captions', issues)
  unique(project.transcripts, 'transcripts', issues)

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const transcriptIds = new Set(project.transcripts.map(({ id }) => id))

  project.assets.forEach((asset, index) => {
    for (const transcriptId of asset.transcriptIds) {
      if (!transcriptIds.has(transcriptId)) {
        issues.push(refIssue(`assets[${index}].transcriptIds`, `Missing transcript ${transcriptId}`))
      }
    }
    if (asset.kind === 'video' && asset.video === undefined) {
      issues.push(refIssue(`assets[${index}].video`, 'Video assets require probed video metadata'))
    }
  })

  project.transcripts.forEach((transcript, index) => {
    const asset = assets.get(transcript.assetId)
    if (!asset) {
      issues.push(refIssue(`transcripts[${index}].assetId`, `Missing asset ${transcript.assetId}`))
      return
    }
    let previousEnd = -1
    transcript.segments.forEach((segment, segmentIndex) => {
      if (segment.endUs > asset.durationUs) {
        issues.push(rangeIssue(
          `transcripts[${index}].segments[${segmentIndex}]`,
          'Transcript segment exceeds the source asset duration'
        ))
      }
      if (segment.startUs < previousEnd) {
        issues.push(rangeIssue(
          `transcripts[${index}].segments[${segmentIndex}]`,
          'Transcript segments must be ordered and non-overlapping'
        ))
      }
      previousEnd = segment.endUs
      for (const word of segment.words ?? []) {
        if (word.startUs < segment.startUs || word.endUs > segment.endUs || word.endUs <= word.startUs) {
          issues.push(rangeIssue(
            `transcripts[${index}].segments[${segmentIndex}].words`,
            'Transcript word timing must remain within its segment'
          ))
        }
      }
    })
  })

  project.items.forEach((item, index) => validateItemReferences(
    project,
    item,
    index,
    assets,
    tracks,
    issues
  ))

  project.captions.forEach((caption, index) => {
    const track = tracks.get(caption.trackId)
    if (!track || track.kind !== 'caption') {
      issues.push(refIssue(`captions[${index}].trackId`, 'Caption must reference a caption track'))
    }
    if (caption.endFrame > projectDurationFramesWithoutCaptions(project)) {
      issues.push(rangeIssue(`captions[${index}]`, 'Caption exceeds the composed media duration'))
    }
  })

  for (const track of project.tracks) validateTrackOverlap(project, track, issues)

  const revisions = new Set(project.revisions.map(({ revision }) => revision))
  if (!revisions.has(project.currentRevision)) {
    issues.push(refIssue('currentRevision', 'The current revision has no metadata record'))
  }
  if (project.revisions.at(-1)?.revision !== project.currentRevision) {
    issues.push(rangeIssue('revisions', 'Revision metadata must end at the current revision'))
  }
  if (project.revisions.length > MAX_PROJECT_HISTORY + 1) {
    issues.push(rangeIssue('revisions', 'Revision metadata exceeds the bounded history window'))
  }
  return issues
}

export function assertValidTimeline(project: VideoProject): void {
  const issues = validateTimeline(project)
  if (issues.length > 0) {
    throw engineError('invalid_project', issues[0]!.message, { issues })
  }
}

export function applyTimelineOperations(
  source: VideoProject,
  operations: readonly TimelineOperation[]
): ApplyOperationsResult {
  assertValidTimeline(source)
  const project = structuredClone(source)
  const inverseOperations: TimelineOperation[] = []
  const changedIds = new Set<string>()

  for (const unchecked of operations) {
    const operation = TimelineOperationSchema.parse(unchecked)
    const inverses = applyOne(project, operation, changedIds)
    inverseOperations.unshift(...inverses)
  }
  sortProjectCollections(project)
  assertValidTimeline(project)
  return { project, inverseOperations, changedIds: [...changedIds].sort() }
}

export function removeAssetTimeRanges(
  source: VideoProject,
  ranges: readonly AssetTimeRange[]
): { project: VideoProject; removed: AssetTimeRange[]; changedIds: string[] } {
  assertValidTimeline(source)
  const normalized = normalizeAssetRanges(source, ranges)
  const project = structuredClone(source)
  const changedIds = new Set<string>()

  for (const track of project.tracks) {
    const original = project.items
      .filter((item) => item.trackId === track.id)
      .sort(compareItems)
    if (original.length === 0) continue
    let removedBefore = 0
    const replacement: TimelineItem[] = []
    for (const item of original) {
      const cuts = normalized.filter((range) =>
        range.assetId === item.assetId &&
        range.startUs < item.sourceEndUs &&
        range.endUs > item.sourceStartUs
      )
      if (cuts.length === 0) {
        replacement.push({ ...item, timelineStartFrame: item.timelineStartFrame - removedBefore })
        continue
      }
      changedIds.add(item.id)
      const kept = subtractSourceRanges(item, cuts, project.fps)
      const originalEnd = item.timelineStartFrame + item.durationFrames
      let cursor = item.timelineStartFrame - removedBefore
      kept.forEach((part, index) => {
        const next = {
          ...part,
          id: kept.length === 1 ? item.id : `${item.id}-part-${index + 1}`,
          timelineStartFrame: cursor
        }
        replacement.push(next)
        changedIds.add(next.id)
        cursor += next.durationFrames
      })
      const removedFromItem = item.durationFrames - kept.reduce((sum, part) => sum + part.durationFrames, 0)
      removedBefore += removedFromItem
      // Preserve pre-existing gaps while rippling only the frames deleted by this edit.
      const expectedCursor = originalEnd - removedBefore
      if (cursor > expectedCursor) {
        throw engineError('invalid_operation', 'Transcript range conversion expanded a timeline item')
      }
    }
    project.items = [
      ...project.items.filter((item) => item.trackId !== track.id),
      ...replacement
    ]
  }

  sortProjectCollections(project)
  assertValidTimeline(project)
  return { project, removed: normalized, changedIds: [...changedIds].sort() }
}

function applyOne(
  project: VideoProject,
  operation: TimelineOperation,
  changedIds: Set<string>
): TimelineOperation[] {
  switch (operation.type) {
    case 'add-item': {
      if (project.items.some(({ id }) => id === operation.item.id)) duplicate(operation.item.id)
      project.items.push(structuredClone(operation.item))
      changedIds.add(operation.item.id)
      return [{ type: 'delete-item', itemId: operation.item.id }]
    }
    case 'delete-item': {
      const index = itemIndex(project, operation.itemId)
      const [removed] = project.items.splice(index, 1)
      changedIds.add(operation.itemId)
      return [{ type: 'add-item', item: removed! }]
    }
    case 'split-item': {
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const relativeFrame = operation.atFrame - original.timelineStartFrame
      if (relativeFrame <= 0 || relativeFrame >= original.durationFrames) {
        throw engineError('invalid_operation', 'Split frame must be strictly inside the item')
      }
      const sourceSplit = original.sourceStartUs + sourceDeltaUs(relativeFrame, original.speed, project.fps)
      if (sourceSplit <= original.sourceStartUs || sourceSplit >= original.sourceEndUs) {
        throw engineError('invalid_operation', 'Split frame cannot be represented in the source range')
      }
      const left: TimelineItem = {
        ...original,
        id: `${original.id}-part-1`,
        durationFrames: relativeFrame,
        sourceEndUs: sourceSplit,
        fadeOutFrames: 0
      }
      const right: TimelineItem = {
        ...original,
        id: `${original.id}-part-2`,
        timelineStartFrame: operation.atFrame,
        durationFrames: original.durationFrames - relativeFrame,
        sourceStartUs: sourceSplit,
        fadeInFrames: 0
      }
      project.items.splice(index, 1, left, right)
      changedIds.add(original.id)
      changedIds.add(left.id)
      changedIds.add(right.id)
      return [
        { type: 'delete-item', itemId: right.id },
        { type: 'delete-item', itemId: left.id },
        { type: 'add-item', item: original }
      ]
    }
    case 'trim-item': {
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      const originalEnd = original.timelineStartFrame + original.durationFrames
      if (
        operation.startFrame < original.timelineStartFrame ||
        operation.endFrame > originalEnd ||
        operation.endFrame <= operation.startFrame
      ) {
        throw engineError('invalid_operation', 'Trim range must be a positive range within the item')
      }
      const startDelta = operation.startFrame - original.timelineStartFrame
      const endDelta = originalEnd - operation.endFrame
      project.items[index] = {
        ...original,
        timelineStartFrame: operation.startFrame,
        durationFrames: operation.endFrame - operation.startFrame,
        sourceStartUs: original.sourceStartUs + sourceDeltaUs(startDelta, original.speed, project.fps),
        sourceEndUs: original.sourceEndUs - sourceDeltaUs(endDelta, original.speed, project.fps),
        fadeInFrames: Math.min(original.fadeInFrames, operation.endFrame - operation.startFrame),
        fadeOutFrames: Math.min(original.fadeOutFrames, operation.endFrame - operation.startFrame)
      }
      changedIds.add(original.id)
      return [
        { type: 'delete-item', itemId: original.id },
        { type: 'add-item', item: original }
      ]
    }
    case 'move-item': {
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      project.items[index] = {
        ...original,
        trackId: operation.trackId,
        timelineStartFrame: operation.timelineStartFrame
      }
      changedIds.add(original.id)
      return [{
        type: 'move-item',
        itemId: original.id,
        trackId: original.trackId,
        timelineStartFrame: original.timelineStartFrame
      }]
    }
    case 'reorder-item': {
      const target = project.items[itemIndex(project, operation.itemId)]!
      const track = project.tracks.find(({ id }) => id === target.trackId)
      if (!track || track.overlap === 'mix') {
        throw engineError('invalid_operation', 'Reordering requires a non-overlapping track')
      }
      const ordered = project.items.filter(({ trackId }) => trackId === target.trackId).sort(compareItems)
      const previousMoves = ordered.map((item): TimelineOperation => ({
        type: 'move-item',
        itemId: item.id,
        trackId: item.trackId,
        timelineStartFrame: item.timelineStartFrame
      }))
      const withoutTarget = ordered.filter(({ id }) => id !== target.id)
      const insertion = operation.beforeItemId === undefined
        ? withoutTarget.length
        : withoutTarget.findIndex(({ id }) => id === operation.beforeItemId)
      if (insertion < 0) throw engineError('invalid_operation', 'Reorder target does not exist on the same track')
      withoutTarget.splice(insertion, 0, target)
      let cursor = Math.min(...ordered.map(({ timelineStartFrame }) => timelineStartFrame))
      for (const item of withoutTarget) {
        item.timelineStartFrame = cursor
        cursor += item.durationFrames
        changedIds.add(item.id)
      }
      return previousMoves
    }
    case 'update-transform': {
      const index = itemIndex(project, operation.itemId)
      const original = project.items[index]!
      project.items[index] = {
        ...original,
        transform: { ...original.transform, ...operation.transform },
        opacity: operation.opacity ?? original.opacity
      }
      changedIds.add(original.id)
      return [{
        type: 'update-transform',
        itemId: original.id,
        transform: original.transform,
        opacity: original.opacity
      }]
    }
    case 'add-caption': {
      if (project.captions.some(({ id }) => id === operation.caption.id)) duplicate(operation.caption.id)
      project.captions.push(structuredClone(operation.caption))
      changedIds.add(operation.caption.id)
      return [{ type: 'delete-caption', captionId: operation.caption.id }]
    }
    case 'update-caption': {
      const index = project.captions.findIndex(({ id }) => id === operation.captionId)
      if (index < 0) missing(operation.captionId)
      const original = project.captions[index]!
      project.captions[index] = { ...original, ...structuredClone(operation.patch), id: original.id }
      changedIds.add(original.id)
      return [{ type: 'update-caption', captionId: original.id, patch: original }]
    }
    case 'delete-caption': {
      const index = project.captions.findIndex(({ id }) => id === operation.captionId)
      if (index < 0) missing(operation.captionId)
      const [removed] = project.captions.splice(index, 1)
      changedIds.add(operation.captionId)
      return [{ type: 'add-caption', caption: removed! }]
    }
    case 'set-canvas': {
      const previousPreset = project.canvas.preset
      const previousFit = project.canvas.fit
      const dimensions = CANVAS_PRESETS[operation.preset]
      project.canvas = { ...project.canvas, ...dimensions, preset: operation.preset, fit: operation.fit }
      changedIds.add('canvas')
      return [{ type: 'set-canvas', preset: previousPreset, fit: previousFit }]
    }
  }
}

function validateItemReferences(
  project: VideoProject,
  item: TimelineItem,
  index: number,
  assets: ReadonlyMap<string, MediaAsset>,
  tracks: ReadonlyMap<string, Track>,
  issues: TimelineValidationIssue[]
): void {
  const asset = assets.get(item.assetId)
  const track = tracks.get(item.trackId)
  if (!asset) issues.push(refIssue(`items[${index}].assetId`, `Missing asset ${item.assetId}`))
  if (!track) issues.push(refIssue(`items[${index}].trackId`, `Missing track ${item.trackId}`))
  if (track?.kind === 'caption') {
    issues.push(refIssue(`items[${index}].trackId`, 'Media items cannot be placed on caption tracks'))
  }
  if (track?.kind === 'video' && asset?.kind !== 'video') {
    issues.push(refIssue(`items[${index}]`, 'Only a video asset can be placed on a video track'))
  }
  if (item.sourceEndUs > (asset?.durationUs ?? 0)) {
    issues.push(rangeIssue(`items[${index}]`, 'Item source range exceeds the asset duration'))
  }
  if (item.fadeInFrames + item.fadeOutFrames > item.durationFrames) {
    issues.push(rangeIssue(`items[${index}]`, 'Item fades exceed its duration'))
  }
  const expected = sourceDeltaUs(item.durationFrames, item.speed, project.fps)
  const actual = item.sourceEndUs - item.sourceStartUs
  const tolerance = Math.max(1, framesToMicroseconds(1, project.fps))
  if (Math.abs(expected - actual) > tolerance) {
    issues.push(rangeIssue(`items[${index}]`, 'Item source and timeline durations do not agree'))
  }
}

function validateTrackOverlap(
  project: VideoProject,
  track: Track,
  issues: TimelineValidationIssue[]
): void {
  if (track.overlap === 'mix') return
  const ordered = project.items.filter(({ trackId }) => trackId === track.id).sort(compareItems)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (previous.timelineStartFrame + previous.durationFrames > current.timelineStartFrame) {
      issues.push({
        path: `tracks.${track.id}`,
        code: 'overlap',
        message: `Items ${previous.id} and ${current.id} overlap on track ${track.id}`
      })
    }
  }
}

function normalizeAssetRanges(project: VideoProject, ranges: readonly AssetTimeRange[]): AssetTimeRange[] {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const sorted = ranges.map((range) => {
    const asset = assets.get(range.assetId)
    if (
      !asset ||
      !Number.isSafeInteger(range.startUs) ||
      !Number.isSafeInteger(range.endUs) ||
      range.startUs < 0 ||
      range.endUs <= range.startUs ||
      range.endUs > asset.durationUs
    ) {
      throw engineError('invalid_operation', 'Transcript edit contains an invalid timed asset range')
    }
    return { ...range }
  }).sort((left, right) =>
    left.assetId.localeCompare(right.assetId) || left.startUs - right.startUs || left.endUs - right.endUs
  )
  const merged: AssetTimeRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && previous.assetId === range.assetId && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs)
      previous.reason = previous.reason === range.reason ? previous.reason : 'selection'
    } else {
      merged.push(range)
    }
  }
  return merged
}

function subtractSourceRanges(
  item: TimelineItem,
  ranges: readonly AssetTimeRange[],
  fps: Rational
): TimelineItem[] {
  let sourceCursor = item.sourceStartUs
  const keptSource: Array<{ startUs: number; endUs: number }> = []
  for (const range of ranges) {
    const startUs = Math.max(item.sourceStartUs, range.startUs)
    const endUs = Math.min(item.sourceEndUs, range.endUs)
    if (startUs > sourceCursor) keptSource.push({ startUs: sourceCursor, endUs: startUs })
    sourceCursor = Math.max(sourceCursor, endUs)
  }
  if (sourceCursor < item.sourceEndUs) keptSource.push({ startUs: sourceCursor, endUs: item.sourceEndUs })
  return keptSource.flatMap(({ startUs, endUs }) => {
    const durationFrames = sourceUsToTimelineFrames(endUs - startUs, item.speed, fps)
    return durationFrames <= 0 ? [] : [{
      ...item,
      sourceStartUs: startUs,
      sourceEndUs: endUs,
      durationFrames,
      fadeInFrames: 0,
      fadeOutFrames: 0
    }]
  })
}

function sourceDeltaUs(frames: number, speed: Rational, fps: Rational): number {
  const normalized = normalizeRational(speed)
  const timelineUs = BigInt(framesToMicroseconds(frames, fps))
  return Number(
    (timelineUs * BigInt(normalized.numerator) + BigInt(normalized.denominator) / 2n) /
    BigInt(normalized.denominator)
  )
}

function sourceUsToTimelineFrames(sourceUs: number, speed: Rational, fps: Rational): number {
  const normalized = normalizeRational(speed)
  const timelineUs = Number(
    (BigInt(sourceUs) * BigInt(normalized.denominator) + BigInt(normalized.numerator) / 2n) /
    BigInt(normalized.numerator)
  )
  return microsecondsToFrames(timelineUs, fps)
}

function unique(
  values: ReadonlyArray<{ id: string }>,
  collection: string,
  issues: TimelineValidationIssue[]
): void {
  const seen = new Set<string>()
  values.forEach(({ id }, index) => {
    if (seen.has(id)) issues.push(refIssue(`${collection}[${index}].id`, `Duplicate identity ${id}`))
    seen.add(id)
  })
}

function sortProjectCollections(project: VideoProject): void {
  project.tracks.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  project.items.sort(compareItems)
  project.captions.sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
  project.transcripts.forEach((transcript) => {
    transcript.segments.sort((left, right) => left.startUs - right.startUs || left.id.localeCompare(right.id))
  })
}

function compareItems(left: TimelineItem, right: TimelineItem): number {
  return left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id)
}

function projectDurationFramesWithoutCaptions(project: VideoProject): number {
  return project.items.reduce(
    (maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames),
    0
  )
}

function itemIndex(project: VideoProject, id: string): number {
  const index = project.items.findIndex((item) => item.id === id)
  if (index < 0) missing(id)
  return index
}

function duplicate(id: string): never {
  throw engineError('invalid_operation', `Identity already exists: ${id}`)
}

function missing(id: string): never {
  throw engineError('invalid_operation', `Identity does not exist: ${id}`)
}

function refIssue(path: string, message: string): TimelineValidationIssue {
  return { path, code: 'invalid_reference', message }
}

function rangeIssue(path: string, message: string): TimelineValidationIssue {
  return { path, code: 'invalid_range', message }
}

export function canvasForPreset(preset: CanvasPreset, fit: CanvasFit = 'fit'): VideoProject['canvas'] {
  return { preset, fit, ...CANVAS_PRESETS[preset], background: '#000000' }
}
