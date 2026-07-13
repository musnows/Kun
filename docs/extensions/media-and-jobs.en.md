# Extension media and background jobs

Extension API v1.1 adds Host-brokered local media and durable background jobs.
The APIs are intended for video, audio, image-sequence, and render extensions
that cannot safely move large files through JSON IPC.

## Authority model

Declare only the permissions the extension actually uses:

| Permission | Authority |
| --- | --- |
| `media.read` | Read Host-granted opaque media handles |
| `media.process` | Use the bounded Host `ffprobe`/`ffmpeg` brokers |
| `media.export` | Write to a Host-granted export target |
| `jobs.manage` | Observe and cancel jobs owned by the extension |
| `workspace.read` / `workspace.write` | Required in addition to the matching media grant |

Every call rechecks the active extension, version where required, workspace,
trust, permissions, and file identity. A handle is not ambient filesystem
authority. A trusted Node extension remains trusted native code; these brokers
do not turn arbitrary extension code into an operating-system sandbox.

## Protected selection

`context.media.pickFiles()` and `pickSaveTarget()` open Main-owned dialogs. The
extension supplies bounded display filters and a suggested name, not a path or
authorization. Cancellation creates no handle or partial destination. A
successful response contains `MediaMetadata` with an opaque `handleId`; it does
not contain an absolute path.

Picker APIs need an interactive desktop View. Headless tools should return an
interaction-required checkpoint and ask the user to open the editor. They must
not launch a dialog, choose a default path, or invent a grant.

## Metadata and playback

`media.stat()` returns bounded metadata. `media.probe()` uses a fixed ffprobe
JSON profile and returns normalized container and stream fields. It does not
return the executable path, source path, environment, or raw diagnostic log.

In a sandboxed View, exchange a readable handle with
`media.openViewResource()`. The returned `kun-media://` URL is short-lived and
bound to the extension, exact View Session, contribution, sender main frame,
workspace, and file identity. Do not persist the URL; persist the handle or
artifact reference and request a fresh lease after reopening.

Chromium playback supports `HEAD`, full `GET`, and one bounded byte Range. The
Host streams with backpressure. Copied URLs, multiple ranges, stale sessions,
expired leases, replaced files, and foreign senders are rejected. The View CSP
allows `kun-media:` only for media while preserving `connect-src 'none'`,
context isolation, sandboxing, navigation restrictions, and Node integration
off.

Call `media.release()` when a handle or lease is no longer needed. Disable,
update, rollback, uninstall, permission changes, workspace changes, View
closure/crash, expiry, and file replacement also revoke affected resources.

## Brokered FFmpeg

`media.startFfmpegJob()` accepts an argument array and named handle bindings.
Resource placeholders occupy a complete argument:

```ts
const { job } = await context.media.startFfmpegJob({
  arguments: [
    '-i', '{{input:source}}',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '{{output:video}}'
  ],
  inputs: { source: inputHandleId },
  outputs: { video: exportTargetHandleId },
  textOutputs: {
    captions: {
      handleId: subtitleTargetHandleId,
      mimeType: 'application/x-subrip',
      content: generatedSrt
    }
  },
  idempotencyKey: `project-${projectId}-revision-${revision}`
})
```

The Host substitutes canonical paths only at the final spawn boundary. Shell
syntax, raw paths, URLs, protocols, devices, response files, executable
overrides, path-loading filters, and Host-reserved options are rejected. Kun
uses only a configured or sanitized-PATH executable, `shell: false`, a scrubbed
environment, bounded logs/progress, a sibling staging output, byte/time quotas,
process-tree cancellation, post-output ffprobe, and atomic promotion.

`textOutputs` is an optional bounded map for UTF-8 sidecars that belong to the
same export transaction. It accepts only a Host-granted export handle,
`application/x-subrip` or `text/vtt`, and inline content within
the documented limits. The content never enters FFmpeg arguments. Kun stages,
validates, promotes, consumes, or rolls back these files together with the
declared FFmpeg outputs, so a video-plus-caption export cannot publish only one
half after a failure.

Kun does not bundle FFmpeg in each `.kunx`. Install a compatible host FFmpeg or
configure the application-managed override. Editing remains available when the
native tools are absent; probe/export returns `MEDIA_EXECUTABLE_UNAVAILABLE`.

## Durable jobs

Core capabilities create jobs; extensions cannot register arbitrary workers in
v1.1. Use `jobs.get()`, `jobs.list()`, `jobs.subscribe()`, and `jobs.cancel()`.
Snapshots and monotonic events persist across renderer and runtime restarts.
Subscriptions first replay after the supplied cursor and then deliver live
events. When `replayGap` is true, replace local state with the returned snapshot
before continuing.

Cancellation is idempotent. A completed job keeps its original terminal
outcome. If Kun restarts while FFmpeg has an unknown outcome, the job becomes
`interrupted`; restart it explicitly rather than assuming a partial export is
safe to resume.

## Generated artifacts

Successful media jobs publish top-level `generatedArtifacts`. An artifact has a
durable opaque identity, owner/workspace attribution, media handle, completion
identity, MIME/size metadata, availability, and job or invocation provenance.
It has no local path or lease URL. Tool results may reference only an existing,
completed artifact owned by the caller. Kun validates it again before history
commit and projects missing, replaced, or revoked files as `unavailable`.

Result-preview Views receive the artifact and media-handle references. They
request a fresh View lease for video, audio, or image playback instead of
reading a path or data URL. For non-player artifacts such as SRT/VTT sidecars,
an interactive View can call
`media.performArtifactAction({ artifactId, action: 'open' | 'reveal' })`.
The request contains no path, owner, version, or workspace claim. Main derives
those fields from the authenticated View Session, revalidates artifact
ownership, exact extension version, workspace, availability, and completion
identity, then performs the desktop action without returning the path to the
View. Headless and stale/foreign View calls fail closed.

## Troubleshooting

- `MEDIA_INTERACTION_REQUIRED`: open the desktop View and complete the protected picker.
- `MEDIA_PERMISSION_DENIED`: check both the media permission and matching workspace grant.
- `MEDIA_HANDLE_REVOKED` / `MEDIA_NOT_FOUND`: select the source again or recover the missing export.
- `MEDIA_EXECUTABLE_UNAVAILABLE`: verify the Host FFmpeg/ffprobe installation or configured override. H.264 and burned-caption workflows also require `libx264` and `drawtext`; on macOS the reviewed discovery prefixes include the keg-only Homebrew `ffmpeg-full` installation.
- `MEDIA_INVALID_ARGUMENT`: replace paths/URLs with exact named handle placeholders.
- `MEDIA_LIMIT_EXCEEDED`: reduce output size/concurrency or change the user-controlled policy.
- Job `interrupted`: inspect the project and destination, then explicitly start a new render.
- Video does not seek: request a fresh lease and check that the file was not replaced; never reuse an expired URL.

Logs and diagnostics intentionally redact absolute paths, reusable lease
credentials, environments, and complete native command lines.

## Distribution, privacy, and cleanup review

- The first-party example source carries its checked-in MIT license. It does
  not copy or redistribute FFmpeg, codecs, model weights, stock media, or
  third-party footage. Packaging FFmpeg later requires a separate target and
  codec license review.
- Probe, transcription import, timeline editing, and rendering are local by
  default. No cloud ASR or generative service is enabled implicitly, and the
  extension does not duplicate provider secrets in project state.
- Input handles are read-only. Output/input alias checks and sibling staging
  prevent source footage from being rewritten. Project operations preserve
  source ranges rather than editing source bytes.
- Failed, cancelled, over-quota, and interrupted renders remove staging files
  and release reservations. Completed exports and project files are user data
  and are not deleted on extension uninstall; derived cache cleanup is explicit.
- Audit records contain opaque handle/job/artifact identities and bounded
  outcomes, never protected paths, operation tokens, lease credentials,
  environments, or unbounded native output.
- A Node extension can still import `fs` or `child_process` under the existing
  high-risk trust disclosure. Prefer the media broker for least authority, but
  do not describe it as an OS sandbox for arbitrary extension code.
