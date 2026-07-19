import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { CornerDownRight, ListPlus, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const QUEUED_MENU_WIDTH = 176
const QUEUED_MENU_HEIGHT = 48
const QUEUED_MENU_MARGIN = 8
const QUEUED_MENU_GAP = 6

export type QueuedMessageMenuPlacement = {
  left: number
  top: number
  width: number
}

export function calculateQueuedMessageMenuPlacement({
  anchorRect,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: Pick<DOMRect, 'bottom' | 'right' | 'top'>
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): QueuedMessageMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const normalizedRight = anchorRect.right / scale
  const normalizedTop = anchorRect.top / scale
  const normalizedBottom = anchorRect.bottom / scale
  const width = Math.min(
    QUEUED_MENU_WIDTH,
    Math.max(1, normalizedViewportWidth - QUEUED_MENU_MARGIN * 2)
  )
  const left = Math.min(
    Math.max(QUEUED_MENU_MARGIN, normalizedRight - width),
    Math.max(QUEUED_MENU_MARGIN, normalizedViewportWidth - QUEUED_MENU_MARGIN - width)
  )
  const belowTop = normalizedBottom + QUEUED_MENU_GAP
  const top = belowTop + QUEUED_MENU_HEIGHT <= normalizedViewportHeight - QUEUED_MENU_MARGIN
    ? belowTop
    : Math.max(QUEUED_MENU_MARGIN, normalizedTop - QUEUED_MENU_GAP - QUEUED_MENU_HEIGHT)
  return { left, top, width }
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export type QueuedComposerMessage = {
  id: string
  text: string
  displayText?: string
  guidanceEligible?: boolean
  mode?: string
  attachmentIds?: readonly string[]
  attachments?: readonly unknown[]
  fileReferences?: readonly unknown[]
  composerContexts?: readonly unknown[]
  guiPlan?: unknown
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: unknown
  writeContext?: unknown
}

/** Editing dequeues the item, so only payloads that can be fully restored as text are eligible. */
export function canEditQueuedComposerMessage(message: QueuedComposerMessage): boolean {
  return Boolean(
    message.text.trim() &&
    message.guidanceEligible !== false &&
    message.mode !== 'plan' &&
    !message.attachmentIds?.length &&
    !message.attachments?.length &&
    !message.fileReferences?.length &&
    !message.composerContexts?.length &&
    !message.guiPlan &&
    message.guiDesignCanvas !== true &&
    message.guiDesignMode !== true &&
    !message.guiDesignArtifact &&
    !message.writeContext
  )
}

type Props = {
  messages: QueuedComposerMessage[]
  onRemove: (id: string) => void
  onGuide?: (id: string) => void | Promise<unknown>
  onEdit?: (message: QueuedComposerMessage) => void
}

export function FloatingComposerQueuedMessages({
  messages,
  onRemove,
  onGuide,
  onEdit
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const guidingIdsRef = useRef(new Set<string>())
  const [guidingIds, setGuidingIds] = useState<Set<string>>(() => new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<QueuedMessageMenuPlacement | null>(null)

  useEffect(() => {
    if (!openMenuId || typeof window === 'undefined') return
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (
        rootRef.current?.contains(target) || menuRef.current?.contains(target)
      )) return
      setOpenMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenuId(null)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuId])

  useEffect(() => {
    if (!openMenuId || typeof window === 'undefined') {
      setMenuPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = menuButtonRefs.current.get(openMenuId)
      if (!button) return
      setMenuPlacement(calculateQueuedMessageMenuPlacement({
        anchorRect: button.getBoundingClientRect(),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentBodyZoom()
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [openMenuId])

  if (messages.length === 0) return null

  const guide = async (id: string): Promise<void> => {
    if (!onGuide || guidingIdsRef.current.has(id)) return
    guidingIdsRef.current.add(id)
    setGuidingIds(new Set(guidingIdsRef.current))
    try {
      await onGuide(id)
    } finally {
      guidingIdsRef.current.delete(id)
      setGuidingIds(new Set(guidingIdsRef.current))
    }
  }

  const openMenuMessage = openMenuId
    ? messages.find((message) => message.id === openMenuId) ?? null
    : null
  const menuStyle: CSSProperties = menuPlacement
    ? {
        left: `${menuPlacement.left}px`,
        top: `${menuPlacement.top}px`,
        width: `${menuPlacement.width}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${QUEUED_MENU_WIDTH}px`,
        visibility: 'hidden'
      }
  const editMenu = openMenuMessage && onEdit && canEditQueuedComposerMessage(openMenuMessage) ? (
    <div
      ref={menuRef}
      role="menu"
      data-queued-message-menu
      style={menuStyle}
      className="ds-no-drag fixed z-[1000] overflow-hidden rounded-[16px] border border-ds-border bg-white p-1.5 text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpenMenuId(null)
          onEdit(openMenuMessage)
        }}
        className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left font-medium transition hover:bg-ds-hover"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span>{t('queuedMessageEdit')}</span>
      </button>
    </div>
  ) : null

  return (
    <>
      <div
        ref={rootRef}
        data-composer-queue
        className="mb-2 space-y-2"
        aria-label={t('queuedMessagesTitle', { count: messages.length })}
      >
        {messages.map((message) => {
          const guiding = guidingIds.has(message.id)
          const guidanceEligible = message.guidanceEligible !== false
          const guideTitle = guidanceEligible
            ? t('guideQueuedMessageHint')
            : t('guideQueuedMessageTextOnly')
          const editMessage = onEdit && canEditQueuedComposerMessage(message) ? onEdit : null
          return (
            <div
              key={message.id}
              className="group relative flex min-h-12 min-w-0 items-center gap-2 rounded-[20px] border border-ds-border bg-white/92 px-3 py-2 shadow-[0_8px_26px_rgba(20,47,95,0.07)] backdrop-blur-xl dark:bg-ds-card/94"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint"
                aria-hidden="true"
              >
                <ListPlus className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ds-ink">
                {message.displayText ?? message.text}
              </span>
              {onGuide ? (
                <button
                  type="button"
                  onClick={() => void guide(message.id)}
                  disabled={!guidanceEligible || guiding}
                  className="ds-no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                  aria-label={guiding ? t('guideQueuedMessagePending') : t('guideQueuedMessage')}
                  title={guiding ? t('guideQueuedMessagePending') : guideTitle}
                >
                  {guiding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                  ) : (
                    <CornerDownRight className="h-3.5 w-3.5" strokeWidth={1.9} />
                  )}
                  <span>{guiding ? t('guideQueuedMessagePending') : t('guideQueuedMessage')}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(message.id)}
                disabled={guiding}
                className="ds-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                aria-label={t('queuedMessageRemove')}
                title={t('queuedMessageRemove')}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
              {editMessage ? (
                <div className="shrink-0">
                  <button
                    ref={(node) => {
                      if (node) menuButtonRefs.current.set(message.id, node)
                      else menuButtonRefs.current.delete(message.id)
                    }}
                    type="button"
                    onClick={() => setOpenMenuId((current) => current === message.id ? null : message.id)}
                    disabled={guiding}
                    className="ds-no-drag flex h-8 w-8 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                    aria-label={t('queuedMessageMoreActions')}
                    title={t('queuedMessageMoreActions')}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === message.id}
                  >
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {editMenu && typeof document !== 'undefined'
        ? createPortal(editMenu, document.body)
        : editMenu}
    </>
  )
}
