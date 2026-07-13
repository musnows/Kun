import { engineError } from './errors.js'

export const PROJECT_SCHEMA_VERSION = 1 as const
export const MAX_PROJECT_HISTORY = 50

export type Rational = {
  numerator: number
  denominator: number
}

export type CanvasPreset = '16:9' | '9:16' | '1:1'
export type CanvasFit = 'fit' | 'crop' | 'pad'
export type CanvasSettings = {
  preset: CanvasPreset
  width: number
  height: number
  fit: CanvasFit
  background: string
}

export type VideoStreamMetadata = {
  codec: string
  width: number
  height: number
  frameRate: Rational
  rotation?: 0 | 90 | 180 | 270
}

export type AudioStreamMetadata = {
  codec: string
  sampleRate: number
  channels: number
}

export type MediaAsset = {
  id: string
  name: string
  kind: 'video' | 'audio'
  mediaHandleId?: string
  workspaceRelativePath?: string
  durationUs: number
  container: string
  video?: VideoStreamMetadata
  audio?: AudioStreamMetadata
  transcriptIds: string[]
}

export type Track = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'caption'
  order: number
  overlap: 'reject' | 'mix'
  muted?: boolean
  locked?: boolean
}

export type Transform = {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export type TimelineItem = {
  id: string
  assetId: string
  trackId: string
  timelineStartFrame: number
  durationFrames: number
  sourceStartUs: number
  sourceEndUs: number
  speed: Rational
  transform: Transform
  opacity: number
  fadeInFrames: number
  fadeOutFrames: number
}

export type Caption = {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  text: string
  placement: 'top' | 'center' | 'bottom'
  style?: {
    fontSize?: number
    color?: string
    background?: string
  }
}

export type TranscriptWord = {
  id: string
  startUs: number
  endUs: number
  text: string
  confidence?: number
}

export type TranscriptSegment = {
  id: string
  startUs: number
  endUs: number
  text: string
  words?: TranscriptWord[]
  tags?: Array<'filler' | 'silence'>
}

export type Transcript = {
  id: string
  assetId: string
  language: string
  provenance: 'srt' | 'vtt' | 'json' | 'local-asr'
  segments: TranscriptSegment[]
}

export type RevisionAuthor = 'manual' | 'agent' | 'system'

export type AddItemOperation = { type: 'add-item'; item: TimelineItem }
export type SplitItemOperation = { type: 'split-item'; itemId: string; atFrame: number }
export type TrimItemOperation = {
  type: 'trim-item'
  itemId: string
  startFrame: number
  endFrame: number
}
export type DeleteItemOperation = { type: 'delete-item'; itemId: string }
export type MoveItemOperation = {
  type: 'move-item'
  itemId: string
  trackId: string
  timelineStartFrame: number
}
export type ReorderItemOperation = {
  type: 'reorder-item'
  itemId: string
  beforeItemId?: string
}
export type UpdateTransformOperation = {
  type: 'update-transform'
  itemId: string
  transform: Partial<Transform>
  opacity?: number
}
export type AddCaptionOperation = { type: 'add-caption'; caption: Caption }
export type UpdateCaptionOperation = {
  type: 'update-caption'
  captionId: string
  patch: Partial<Omit<Caption, 'id'>>
}
export type DeleteCaptionOperation = { type: 'delete-caption'; captionId: string }
export type SetCanvasOperation = {
  type: 'set-canvas'
  preset: CanvasPreset
  fit: CanvasFit
}

export type TimelineOperation =
  | AddItemOperation
  | SplitItemOperation
  | TrimItemOperation
  | DeleteItemOperation
  | MoveItemOperation
  | ReorderItemOperation
  | UpdateTransformOperation
  | AddCaptionOperation
  | UpdateCaptionOperation
  | DeleteCaptionOperation
  | SetCanvasOperation

export type Revision = {
  revision: number
  parentRevision: number | null
  author: RevisionAuthor
  sourceOperation: string
  timestamp: string
  summary: string
  operations: TimelineOperation[]
  inverseOperations: TimelineOperation[]
  restoredFromRevision?: number
}

export type VideoProject = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fps: Rational
  canvas: CanvasSettings
  assets: MediaAsset[]
  tracks: Track[]
  items: TimelineItem[]
  captions: Caption[]
  transcripts: Transcript[]
  currentRevision: number
  revisions: Revision[]
  undoStack: number[]
  redoStack: number[]
}

export type RenderPreset = {
  id: 'proof-frame' | 'preview' | 'h264-mp4' | 'audio-aac' | 'subtitles-srt' | 'subtitles-vtt'
  width?: number
  height?: number
  videoBitrate?: string
  audioBitrate?: string
}

export type RuntimeSchema<T> = {
  parse(value: unknown): T
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: Error }
}

export const RationalSchema = runtimeSchema<Rational>((value) => {
  const rational = object(value, 'rational')
  positiveInteger(rational.numerator, 'rational.numerator')
  positiveInteger(rational.denominator, 'rational.denominator')
})

export const CanvasSettingsSchema = runtimeSchema<CanvasSettings>(validateCanvas)
export const MediaAssetSchema = runtimeSchema<MediaAsset>((value) => validateAsset(value, 0))
export const TrackSchema = runtimeSchema<Track>((value) => validateTrack(value, 0))
export const TimelineItemSchema = runtimeSchema<TimelineItem>((value) => validateItem(value, 0))
export const CaptionSchema = runtimeSchema<Caption>((value) => validateCaption(value, 0))
export const TranscriptSegmentSchema = runtimeSchema<TranscriptSegment>((value) =>
  validateTranscriptSegment(value, 'segment')
)
export const TranscriptSchema = runtimeSchema<Transcript>((value) => validateTranscript(value, 0))
export const RevisionSchema = runtimeSchema<Revision>((value) => validateRevision(value, 0))
export const TimelineOperationSchema = runtimeSchema<TimelineOperation>(validateOperation)
export const RenderPresetSchema = runtimeSchema<RenderPreset>(validateRenderPreset)
export const VideoProjectSchema = runtimeSchema<VideoProject>(validateProjectShape)

export type ProjectMigration = (value: Record<string, unknown>) => unknown
export const PROJECT_MIGRATIONS: Readonly<Record<number, ProjectMigration>> = Object.freeze({})

export function migrateProject(
  value: unknown,
  migrations: Readonly<Record<number, ProjectMigration>> = PROJECT_MIGRATIONS
): VideoProject {
  let candidate = object(value, 'project')
  let version = candidate.schemaVersion
  if (!Number.isSafeInteger(version) || Number(version) < 0) {
    throw engineError('invalid_project', 'project.schemaVersion must be a non-negative integer')
  }
  while (version !== PROJECT_SCHEMA_VERSION) {
    if (Number(version) > PROJECT_SCHEMA_VERSION || migrations[Number(version)] === undefined) {
      throw engineError(
        'unsupported_schema_version',
        `Project schema ${String(version)} is not supported`,
        { schemaVersion: version, supportedSchemaVersion: PROJECT_SCHEMA_VERSION }
      )
    }
    candidate = object(migrations[Number(version)]!(candidate), 'migrated project')
    version = candidate.schemaVersion
  }
  return VideoProjectSchema.parse(candidate)
}

function runtimeSchema<T>(validate: (value: unknown) => void): RuntimeSchema<T> {
  return {
    parse(value: unknown): T {
      validate(value)
      return structuredClone(value as T)
    },
    safeParse(value: unknown) {
      try {
        return { success: true as const, data: this.parse(value) }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error : new Error(String(error))
        }
      }
    }
  }
}

function validateProjectShape(value: unknown): void {
  const project = object(value, 'project')
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw engineError('unsupported_schema_version', 'Unsupported project schema version', {
      schemaVersion: project.schemaVersion,
      supportedSchemaVersion: PROJECT_SCHEMA_VERSION
    })
  }
  identifier(project.id, 'project.id')
  boundedString(project.name, 'project.name', 1, 160)
  isoTimestamp(project.createdAt, 'project.createdAt')
  isoTimestamp(project.updatedAt, 'project.updatedAt')
  RationalSchema.parse(project.fps)
  validateCanvas(project.canvas)
  array(project.assets, 'project.assets').forEach(validateAsset)
  array(project.tracks, 'project.tracks').forEach(validateTrack)
  array(project.items, 'project.items').forEach(validateItem)
  array(project.captions, 'project.captions').forEach(validateCaption)
  array(project.transcripts, 'project.transcripts').forEach(validateTranscript)
  nonNegativeInteger(project.currentRevision, 'project.currentRevision')
  array(project.revisions, 'project.revisions').forEach(validateRevision)
  array(project.undoStack, 'project.undoStack').forEach((entry, index) =>
    nonNegativeInteger(entry, `project.undoStack[${index}]`)
  )
  array(project.redoStack, 'project.redoStack').forEach((entry, index) =>
    nonNegativeInteger(entry, `project.redoStack[${index}]`)
  )
}

function validateCanvas(value: unknown): void {
  const canvas = object(value, 'canvas')
  oneOf(canvas.preset, ['16:9', '9:16', '1:1'], 'canvas.preset')
  positiveInteger(canvas.width, 'canvas.width')
  positiveInteger(canvas.height, 'canvas.height')
  oneOf(canvas.fit, ['fit', 'crop', 'pad'], 'canvas.fit')
  boundedString(canvas.background, 'canvas.background', 1, 32)
}

function validateAsset(value: unknown, index: number): void {
  const asset = object(value, `assets[${index}]`)
  identifier(asset.id, `assets[${index}].id`)
  boundedString(asset.name, `assets[${index}].name`, 1, 255)
  oneOf(asset.kind, ['video', 'audio'], `assets[${index}].kind`)
  optionalIdentifier(asset.mediaHandleId, `assets[${index}].mediaHandleId`)
  optionalRelativePath(asset.workspaceRelativePath, `assets[${index}].workspaceRelativePath`)
  if (asset.mediaHandleId === undefined && asset.workspaceRelativePath === undefined) {
    fail(`assets[${index}] must contain a media handle or workspace-relative path`)
  }
  positiveInteger(asset.durationUs, `assets[${index}].durationUs`)
  boundedString(asset.container, `assets[${index}].container`, 1, 64)
  if (asset.video !== undefined) validateVideoStream(asset.video, index)
  if (asset.audio !== undefined) validateAudioStream(asset.audio, index)
  array(asset.transcriptIds, `assets[${index}].transcriptIds`).forEach((entry, child) =>
    identifier(entry, `assets[${index}].transcriptIds[${child}]`)
  )
}

function validateVideoStream(value: unknown, index: number): void {
  const stream = object(value, `assets[${index}].video`)
  boundedString(stream.codec, `assets[${index}].video.codec`, 1, 64)
  positiveInteger(stream.width, `assets[${index}].video.width`)
  positiveInteger(stream.height, `assets[${index}].video.height`)
  RationalSchema.parse(stream.frameRate)
  if (stream.rotation !== undefined) oneOf(stream.rotation, [0, 90, 180, 270], 'video.rotation')
}

function validateAudioStream(value: unknown, index: number): void {
  const stream = object(value, `assets[${index}].audio`)
  boundedString(stream.codec, `assets[${index}].audio.codec`, 1, 64)
  positiveInteger(stream.sampleRate, `assets[${index}].audio.sampleRate`)
  positiveInteger(stream.channels, `assets[${index}].audio.channels`)
}

function validateTrack(value: unknown, index: number): void {
  const track = object(value, `tracks[${index}]`)
  identifier(track.id, `tracks[${index}].id`)
  boundedString(track.name, `tracks[${index}].name`, 1, 128)
  oneOf(track.kind, ['video', 'audio', 'caption'], `tracks[${index}].kind`)
  nonNegativeInteger(track.order, `tracks[${index}].order`)
  oneOf(track.overlap, ['reject', 'mix'], `tracks[${index}].overlap`)
  optionalBoolean(track.muted, `tracks[${index}].muted`)
  optionalBoolean(track.locked, `tracks[${index}].locked`)
}

function validateItem(value: unknown, index: number): void {
  const item = object(value, `items[${index}]`)
  identifier(item.id, `items[${index}].id`)
  identifier(item.assetId, `items[${index}].assetId`)
  identifier(item.trackId, `items[${index}].trackId`)
  nonNegativeInteger(item.timelineStartFrame, `items[${index}].timelineStartFrame`)
  positiveInteger(item.durationFrames, `items[${index}].durationFrames`)
  nonNegativeInteger(item.sourceStartUs, `items[${index}].sourceStartUs`)
  positiveInteger(item.sourceEndUs, `items[${index}].sourceEndUs`)
  if (Number(item.sourceEndUs) <= Number(item.sourceStartUs)) fail(`items[${index}] source range is empty`)
  RationalSchema.parse(item.speed)
  validateTransform(item.transform, `items[${index}].transform`)
  finiteRange(item.opacity, `items[${index}].opacity`, 0, 1)
  nonNegativeInteger(item.fadeInFrames, `items[${index}].fadeInFrames`)
  nonNegativeInteger(item.fadeOutFrames, `items[${index}].fadeOutFrames`)
}

function validateTransform(value: unknown, path: string): void {
  const transform = object(value, path)
  finite(transform.x, `${path}.x`)
  finite(transform.y, `${path}.y`)
  finiteRange(transform.scaleX, `${path}.scaleX`, 0.01, 100)
  finiteRange(transform.scaleY, `${path}.scaleY`, 0.01, 100)
  finite(transform.rotation, `${path}.rotation`)
}

function validateCaption(value: unknown, index: number): void {
  const caption = object(value, `captions[${index}]`)
  identifier(caption.id, `captions[${index}].id`)
  identifier(caption.trackId, `captions[${index}].trackId`)
  nonNegativeInteger(caption.startFrame, `captions[${index}].startFrame`)
  positiveInteger(caption.endFrame, `captions[${index}].endFrame`)
  if (Number(caption.endFrame) <= Number(caption.startFrame)) fail(`captions[${index}] range is empty`)
  boundedString(caption.text, `captions[${index}].text`, 1, 4096)
  oneOf(caption.placement, ['top', 'center', 'bottom'], `captions[${index}].placement`)
  if (caption.style !== undefined) {
    const style = object(caption.style, `captions[${index}].style`)
    if (style.fontSize !== undefined) {
      finiteRange(style.fontSize, `captions[${index}].style.fontSize`, 8, 256)
    }
    for (const key of ['color', 'background'] as const) {
      if (style[key] === undefined) continue
      boundedString(style[key], `captions[${index}].style.${key}`, 7, 7)
      if (!/^#[0-9A-Fa-f]{6}$/u.test(String(style[key]))) {
        fail(`captions[${index}].style.${key} must be a six-digit hexadecimal color`)
      }
    }
  }
}

function validateTranscript(value: unknown, index: number): void {
  const transcript = object(value, `transcripts[${index}]`)
  identifier(transcript.id, `transcripts[${index}].id`)
  identifier(transcript.assetId, `transcripts[${index}].assetId`)
  boundedString(transcript.language, `transcripts[${index}].language`, 1, 32)
  oneOf(transcript.provenance, ['srt', 'vtt', 'json', 'local-asr'], `transcripts[${index}].provenance`)
  array(transcript.segments, `transcripts[${index}].segments`).forEach((segment, child) =>
    validateTranscriptSegment(segment, `transcripts[${index}].segments[${child}]`)
  )
}

function validateTranscriptSegment(value: unknown, path: string): void {
  const segment = object(value, path)
  identifier(segment.id, `${path}.id`)
  nonNegativeInteger(segment.startUs, `${path}.startUs`)
  positiveInteger(segment.endUs, `${path}.endUs`)
  if (Number(segment.endUs) <= Number(segment.startUs)) fail(`${path} range is empty`)
  boundedString(segment.text, `${path}.text`, 1, 16_384)
  if (segment.words !== undefined) {
    array(segment.words, `${path}.words`).forEach((word, index) => {
      const parsed = object(word, `${path}.words[${index}]`)
      identifier(parsed.id, `${path}.words[${index}].id`)
      nonNegativeInteger(parsed.startUs, `${path}.words[${index}].startUs`)
      positiveInteger(parsed.endUs, `${path}.words[${index}].endUs`)
      boundedString(parsed.text, `${path}.words[${index}].text`, 1, 1024)
      if (parsed.confidence !== undefined) finiteRange(parsed.confidence, 'word.confidence', 0, 1)
    })
  }
  if (segment.tags !== undefined) {
    array(segment.tags, `${path}.tags`).forEach((tag) => oneOf(tag, ['filler', 'silence'], `${path}.tags`))
  }
}

function validateRevision(value: unknown, index: number): void {
  const revision = object(value, `revisions[${index}]`)
  nonNegativeInteger(revision.revision, `revisions[${index}].revision`)
  if (revision.parentRevision !== null) nonNegativeInteger(revision.parentRevision, 'revision.parentRevision')
  oneOf(revision.author, ['manual', 'agent', 'system'], 'revision.author')
  boundedString(revision.sourceOperation, 'revision.sourceOperation', 1, 128)
  isoTimestamp(revision.timestamp, 'revision.timestamp')
  boundedString(revision.summary, 'revision.summary', 1, 1024)
  array(revision.operations, 'revision.operations').forEach(validateOperation)
  array(revision.inverseOperations, 'revision.inverseOperations').forEach(validateOperation)
  if (revision.restoredFromRevision !== undefined) {
    nonNegativeInteger(revision.restoredFromRevision, 'revision.restoredFromRevision')
  }
}

function validateRenderPreset(value: unknown): void {
  const preset = object(value, 'renderPreset')
  oneOf(
    preset.id,
    ['proof-frame', 'preview', 'h264-mp4', 'audio-aac', 'subtitles-srt', 'subtitles-vtt'],
    'renderPreset.id'
  )
  if (preset.width !== undefined) positiveInteger(preset.width, 'renderPreset.width')
  if (preset.height !== undefined) positiveInteger(preset.height, 'renderPreset.height')
  if (preset.videoBitrate !== undefined) boundedString(preset.videoBitrate, 'renderPreset.videoBitrate', 1, 32)
  if (preset.audioBitrate !== undefined) boundedString(preset.audioBitrate, 'renderPreset.audioBitrate', 1, 32)
}

function validateOperation(value: unknown): void {
  const operation = object(value, 'operation')
  boundedString(operation.type, 'operation.type', 1, 64)
  switch (operation.type) {
    case 'add-item':
      validateItem(operation.item, 0)
      break
    case 'split-item':
      identifier(operation.itemId, 'operation.itemId')
      nonNegativeInteger(operation.atFrame, 'operation.atFrame')
      break
    case 'trim-item':
      identifier(operation.itemId, 'operation.itemId')
      nonNegativeInteger(operation.startFrame, 'operation.startFrame')
      positiveInteger(operation.endFrame, 'operation.endFrame')
      break
    case 'delete-item':
      identifier(operation.itemId, 'operation.itemId')
      break
    case 'move-item':
      identifier(operation.itemId, 'operation.itemId')
      identifier(operation.trackId, 'operation.trackId')
      nonNegativeInteger(operation.timelineStartFrame, 'operation.timelineStartFrame')
      break
    case 'reorder-item':
      identifier(operation.itemId, 'operation.itemId')
      optionalIdentifier(operation.beforeItemId, 'operation.beforeItemId')
      break
    case 'update-transform':
      identifier(operation.itemId, 'operation.itemId')
      object(operation.transform, 'operation.transform')
      if (operation.opacity !== undefined) finiteRange(operation.opacity, 'operation.opacity', 0, 1)
      break
    case 'add-caption':
      validateCaption(operation.caption, 0)
      break
    case 'update-caption':
      identifier(operation.captionId, 'operation.captionId')
      object(operation.patch, 'operation.patch')
      break
    case 'delete-caption':
      identifier(operation.captionId, 'operation.captionId')
      break
    case 'set-canvas':
      oneOf(operation.preset, ['16:9', '9:16', '1:1'], 'operation.preset')
      oneOf(operation.fit, ['fit', 'crop', 'pad'], 'operation.fit')
      break
    default:
      throw engineError('invalid_operation', `Unsupported timeline operation: ${String(operation.type)}`)
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`)
  return value
}

function identifier(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)) {
    fail(`${path} must be a bounded stable identifier`)
  }
}

function optionalIdentifier(value: unknown, path: string): void {
  if (value !== undefined) identifier(value, path)
}

function optionalRelativePath(value: unknown, path: string): void {
  if (value === undefined) return
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).some((part) => part === '..' || part === '')
  ) {
    fail(`${path} must be a confined workspace-relative path`)
  }
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): void {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    fail(`${path} must contain between ${minimum} and ${maximum} characters`)
  }
}

function isoTimestamp(value: unknown, path: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO timestamp`)
}

function finite(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be finite`)
}

function finiteRange(value: unknown, path: string, minimum: number, maximum: number): void {
  finite(value, path)
  if (Number(value) < minimum || Number(value) > maximum) fail(`${path} is outside the supported range`)
}

function nonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${path} must be a non-negative safe integer`)
}

function positiveInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${path} must be a positive safe integer`)
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') fail(`${path} must be a boolean`)
}

function oneOf(value: unknown, options: readonly unknown[], path: string): void {
  if (!options.includes(value)) fail(`${path} contains an unsupported value`)
}

function fail(message: string): never {
  throw engineError('invalid_project', message)
}
