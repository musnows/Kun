import type { GeneratedArtifact, JobSnapshot } from '@kun/extension-api'
import type { ProjectProjection } from '../src/webview/model.js'
import { makeProject } from './fixtures.js'

export function makeViewProject(): ProjectProjection {
  const project = makeProject()
  return {
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    fps: project.fps,
    canvas: project.canvas,
    currentRevision: project.currentRevision,
    updatedAt: project.updatedAt,
    durationFrames: 180,
    assets: project.assets,
    tracks: project.tracks,
    items: project.items,
    captions: project.captions,
    transcripts: project.transcripts.map((transcript) => ({
      ...transcript,
      segmentCount: transcript.segments.length,
      truncated: false
    })),
    revisions: project.revisions.map(({ operations: _operations, inverseOperations: _inverse, ...revision }) => revision),
    canUndo: true,
    canRedo: true
  }
}

export function makeJob(state: JobSnapshot['state']): JobSnapshot {
  return {
    schemaVersion: 1,
    id: 'job_12345678',
    kind: 'media.ffmpeg',
    kindSchemaVersion: 1,
    ownerExtensionId: 'kun-examples.kun-video-editor',
    ownerExtensionVersion: '0.1.0',
    workspaceId: 'workspace-1',
    initiatingOperation: 'media.startFfmpegJob',
    state,
    executionAttempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    latestCursor: 'cursor_1',
    progress: { percentage: 42, phase: 'encode', message: 'Encoding', updatedAt: '2026-01-01T00:01:00.000Z' }
  }
}

export function makeArtifact(jobId: string): GeneratedArtifact {
  return {
    schemaVersion: 1,
    artifactId: 'artifact_1234567890abcdef',
    ownerExtensionId: 'kun-examples.kun-video-editor',
    ownerExtensionVersion: '0.1.0',
    workspaceId: 'workspace-1',
    mediaHandleId: 'media_output_1234567890',
    displayName: 'proof.png',
    mediaKind: 'image',
    mimeType: 'image/png',
    byteSize: 4_096,
    completionIdentity: 'identity-1',
    availability: 'available',
    provenance: { jobId, operation: 'media.ffmpeg' }
  }
}

export function makeSubtitleArtifact(jobId: string): GeneratedArtifact {
  return {
    ...makeArtifact(jobId),
    artifactId: 'artifact_subtitle_1234567890',
    mediaHandleId: 'media_subtitle_1234567890',
    displayName: 'captions.srt',
    mediaKind: 'subtitle',
    mimeType: 'application/x-subrip',
    byteSize: 512,
    completionIdentity: 'subtitle-identity-1'
  }
}
