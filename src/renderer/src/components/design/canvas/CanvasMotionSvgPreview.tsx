import { FileCode2, Pause, Play, Repeat2, RotateCcw } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  controlSvgAnimationPreview,
  type SvgAnimationPreviewState
} from '../../../design/svg/svg-animation-preview-store'

function formatTime(timeMs: number): string {
  if (timeMs >= 1_000) return `${(timeMs / 1_000).toFixed(1)}s`
  return `${Math.round(timeMs)}ms`
}

export function CanvasMotionSvgPreview({
  preview,
  reducedMotion
}: {
  preview: SvgAnimationPreviewState
  reducedMotion: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const hasAnimations = preview.status === 'ready' && preview.animationCount > 0
  const displayedTime = preview.loopsIndefinitely
    ? preview.currentTimeMs % preview.durationMs
    : Math.min(preview.currentTimeMs, preview.durationMs)
  const status = preview.status === 'loading'
    ? t('canvasMotionSvgInspecting', 'Inspecting SVG animation…')
    : preview.status === 'missing'
      ? t('canvasMotionSvgMissing', 'The SVG source is missing.')
      : preview.status === 'invalid'
        ? t('canvasMotionSvgInvalid', 'The SVG animation could not be inspected.')
        : preview.animationCount === 0
          ? t('canvasMotionSvgNone', 'No internal SVG animation was detected.')
          : ''

  return (
    <section
      aria-label={t('canvasMotionSvgLane', 'SVG internal animation')}
      className="border-b border-ds-border-muted bg-[linear-gradient(90deg,rgba(91,77,255,.07),rgba(56,189,248,.05))] px-3 py-2.5"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-accent-soft text-accent">
          <FileCode2 className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold text-ds-ink">
              {t('canvasMotionSvgLane', 'SVG internal animation')}
            </span>
            {hasAnimations ? (
              <>
                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[9.5px] font-medium text-ds-muted dark:bg-white/8">
                  {t('canvasMotionSvgCount', '{{count}} animations', { count: preview.animationCount })}
                </span>
                {preview.loopsIndefinitely ? (
                  <span className="inline-flex items-center gap-1 text-[9.5px] text-ds-faint">
                    <Repeat2 className="h-2.5 w-2.5" />
                    {t('canvasMotionSvgLooping', 'Looping')}
                  </span>
                ) : null}
                <span className="text-[9.5px] tabular-nums text-ds-faint">
                  {t('canvasMotionSvgCycle', '{{duration}} representative cycle', {
                    duration: formatTime(preview.durationMs)
                  })}
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-1 text-[10.5px] leading-4 text-ds-muted">
            {hasAnimations
              ? t(
                  'canvasMotionSvgGuidance',
                  'Preview-only content animation. Container Motion presets move, scale, rotate, or fade the whole SVG.'
                )
              : status}
          </p>
          {hasAnimations ? (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-white/75 text-ds-muted shadow-sm hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/8"
                onClick={() => controlSvgAnimationPreview(preview.shapeId, {
                  type: preview.playing ? 'pause' : 'play'
                })}
                disabled={reducedMotion}
                title={reducedMotion
                  ? t('canvasMotionReducedShort', 'Automatic playback is disabled by reduced motion.')
                  : preview.playing
                    ? t('canvasMotionSvgPause', 'Pause SVG internal animation')
                    : t('canvasMotionSvgPlay', 'Play SVG internal animation')}
                aria-label={preview.playing
                  ? t('canvasMotionSvgPause', 'Pause SVG internal animation')
                  : t('canvasMotionSvgPlay', 'Play SVG internal animation')}
              >
                {preview.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-white/75 text-ds-muted shadow-sm hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/8"
                onClick={() => controlSvgAnimationPreview(preview.shapeId, { type: 'restart' })}
                disabled={reducedMotion}
                title={t('canvasMotionSvgRestart', 'Restart SVG internal animation')}
                aria-label={t('canvasMotionSvgRestart', 'Restart SVG internal animation')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <span className="w-[76px] shrink-0 text-center text-[9.5px] tabular-nums text-ds-faint">
                {formatTime(displayedTime)} / {formatTime(preview.durationMs)}
              </span>
              <input
                type="range"
                min={0}
                max={preview.durationMs}
                step={10}
                value={displayedTime}
                onChange={(event) => controlSvgAnimationPreview(preview.shapeId, {
                  type: 'seek',
                  timeMs: Number(event.target.value)
                })}
                className="canvas-inspector-range min-w-[120px] flex-1"
                aria-label={t('canvasMotionSvgPlayhead', 'SVG internal animation playhead')}
              />
              <select
                value={preview.rate}
                onChange={(event) => controlSvgAnimationPreview(preview.shapeId, {
                  type: 'set-rate',
                  rate: Number(event.target.value)
                })}
                className="h-7 rounded-[7px] bg-white/75 px-2 text-[10px] text-ds-muted outline-none dark:bg-white/8"
                aria-label={t('canvasMotionSvgRate', 'SVG internal animation rate')}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
