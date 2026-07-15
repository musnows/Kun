import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import {
  Bot,
  ClipboardList,
  FileEdit,
  Files,
  Globe2,
  ListTodo,
  LockKeyhole,
  MessageCircleMore,
  PanelRightClose,
  Plus,
  Puzzle,
  Shapes,
  TerminalSquare,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  extensionHostIconUrl,
  type ExtensionRightRailViewEntry
} from '../../extensions/contribution-registry'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import { boundedPlainText } from '../../extensions/safe-text'
import type { CodeRightTabsState } from './code-right-tabs-state'

type Props = {
  state: CodeRightTabsState
  domIdPrefix: string
  titles?: Readonly<Record<string, string>>
  planEnabled: boolean
  filesEnabled: boolean
  sideConversationsEnabled: boolean
  sideConversationCount: number
  sideConversationRunningCount: number
  extensionItems: readonly ExtensionRightRailViewEntry[]
  onOpen: (id: RightPanelContributionId) => void
  onActivate: (id: RightPanelContributionId) => void
  onClose: (id: RightPanelContributionId) => void
  onCollapse: () => void
  onSelectExtension: (entry: ExtensionRightRailViewEntry) => void
}

type BuiltinTool = {
  id: RightPanelContributionId
  label: string
  icon: typeof TerminalSquare
  disabled?: boolean
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

export function CodeRightPanelTabs({
  state,
  domIdPrefix,
  titles = {},
  planEnabled,
  filesEnabled,
  sideConversationsEnabled,
  sideConversationCount,
  sideConversationRunningCount,
  extensionItems,
  onOpen,
  onActivate,
  onClose,
  onCollapse,
  onSelectExtension
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const idPrefix = safeDomId(domIdPrefix)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const tabRefs = useRef(new Map<RightPanelContributionId, HTMLButtonElement>())

  const builtinTools = useMemo<BuiltinTool[]>(() => [
    { id: BUILTIN_RIGHT_PANEL_IDS.terminal, label: t('rightPanelTerminal'), icon: TerminalSquare, disabled: !filesEnabled },
    { id: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowserTool'), icon: Globe2 },
    { id: BUILTIN_RIGHT_PANEL_IDS.files, label: t('rightPanelFiles'), icon: Files, disabled: !filesEnabled },
    {
      id: BUILTIN_RIGHT_PANEL_IDS.sideConversations,
      label: t('rightPanelSideConversations'),
      icon: MessageCircleMore,
      disabled: !sideConversationsEnabled
    },
    { id: BUILTIN_RIGHT_PANEL_IDS.todo, label: t('rightPanelTodoTool'), icon: ListTodo },
    ...(planEnabled
      ? [{ id: BUILTIN_RIGHT_PANEL_IDS.plan, label: t('rightPanelPlan'), icon: ClipboardList }]
      : []),
    { id: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChangesReview'), icon: FileEdit },
    { id: BUILTIN_RIGHT_PANEL_IDS.canvas, label: t('rightPanelWhiteboard'), icon: Shapes },
    { id: BUILTIN_RIGHT_PANEL_IDS.subagents, label: t('rightPanelSubagents'), icon: Bot }
  ], [filesEnabled, planEnabled, sideConversationsEnabled, t])

  const builtinById = useMemo(
    () => new Map(builtinTools.map((tool) => [tool.id, tool])),
    [builtinTools]
  )
  const extensionById = useMemo(
    () => new Map(extensionItems.map((entry) => [entry.id, entry])),
    [extensionItems]
  )

  useEffect(() => {
    if (!menuOpen || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target))) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    })
  }, [menuOpen])

  const tabMeta = (id: RightPanelContributionId): {
    label: string
    icon: typeof TerminalSquare | null
    iconUrl?: string
  } => {
    const dynamicTitle = titles[id]?.trim()
    if (id === BUILTIN_RIGHT_PANEL_IDS.file) {
      return { label: dynamicTitle || t('filePreviewTitle'), icon: FileEdit }
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.browser) {
      return { label: dynamicTitle || t('rightPanelNewBrowserTab'), icon: Globe2 }
    }
    const builtin = builtinById.get(id)
    if (builtin) return { label: dynamicTitle || builtin.label, icon: builtin.icon }
    const extension = extensionById.get(id)
    if (extension) {
      return {
        label: dynamicTitle || boundedPlainText(extension.payload.title, 128),
        icon: extension.payload.icon ? null : Puzzle,
        ...(extension.payload.icon && extension.owner.kind === 'extension'
          ? { iconUrl: extensionHostIconUrl(extension.owner.extensionId, extension.payload.icon) }
          : {})
      }
    }
    return { label: dynamicTitle || t('rightPanelUnavailable'), icon: Puzzle }
  }

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: RightPanelContributionId,
    index: number
  ): void => {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % state.tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + state.tabs.length) % state.tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = state.tabs.length - 1
    else if (event.key === 'Delete') {
      event.preventDefault()
      onClose(id)
      return
    } else return
    event.preventDefault()
    const nextId = state.tabs[nextIndex]
    onActivate(nextId)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => tabRefs.current.get(nextId)?.focus())
    }
  }

  const openBuiltin = (tool: BuiltinTool): void => {
    if (tool.disabled) return
    onOpen(tool.id)
    setMenuOpen(false)
  }

  return (
    <div className="ds-code-right-tabs ds-no-drag relative flex h-11 shrink-0 items-center gap-1 border-b border-ds-border-muted bg-ds-surface-subtle/90 px-2 backdrop-blur-xl dark:bg-ds-card/90">
      <div
        role="tablist"
        aria-label={t('rightPanelTabs')}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {state.tabs.map((id, index) => {
          const active = state.activeId === id
          const meta = tabMeta(id)
          const Icon = meta.icon
          const tabId = `${idPrefix}-tab-${safeDomId(id)}`
          const panelId = `${idPrefix}-panel-${safeDomId(id)}`
          return (
            <div
              key={id}
              className={`group flex h-8 min-w-[7rem] max-w-[15rem] shrink-0 items-center rounded-[9px] border transition ${
                active
                  ? 'border-ds-border-strong bg-ds-card text-ds-ink shadow-sm'
                  : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(id, node)
                  else tabRefs.current.delete(id)
                }}
                type="button"
                id={tabId}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                aria-controls={panelId}
                onClick={() => onActivate(id)}
                onKeyDown={(event) => handleTabKeyDown(event, id, index)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] font-semibold outline-none"
              >
                {meta.iconUrl ? (
                  <img src={meta.iconUrl} alt="" aria-hidden className="h-3.5 w-3.5 shrink-0 object-contain" />
                ) : Icon ? (
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                {id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationCount > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">
                    {Math.min(sideConversationCount, 99)}
                  </span>
                ) : null}
                {id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationRunningCount > 0 ? (
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label={t('sidePanelRunningDot')} />
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(id)
                }}
                aria-label={t('rightPanelCloseTab', { title: meta.label })}
                title={t('rightPanelCloseTab', { title: meta.label })}
                className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          )
        })}
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={t('rightPanelAddTool')}
        title={t('rightPanelAddTool')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <Plus className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={onCollapse}
        aria-label={t('rightPanelCollapse')}
        title={t('rightPanelCollapse')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('rightPanelToolMenu')}
          className="ds-card-strong absolute right-2 top-[calc(100%+0.4rem)] z-50 w-72 overflow-hidden rounded-[16px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(20,47,95,0.2)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.42)]"
        >
          {builtinTools.map((tool, index) => {
            const Icon = tool.icon
            const alreadyOpen = state.tabs.includes(tool.id)
            const showDivider = index === 4
            return (
              <div key={tool.id} className={showDivider ? 'mt-1 border-t border-ds-border-muted pt-1' : ''}>
                <button
                  type="button"
                  role="menuitem"
                  data-tool-id={tool.id}
                  disabled={tool.disabled}
                  onClick={() => openBuiltin(tool)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                  {tool.id === BUILTIN_RIGHT_PANEL_IDS.sideConversations && sideConversationCount > 0 ? (
                    <span className="text-[11px] text-ds-faint">{sideConversationCount}</span>
                  ) : null}
                  {alreadyOpen ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
                </button>
              </div>
            )
          })}

          {extensionItems.length > 0 ? <div className="my-1 border-t border-ds-border-muted" /> : null}
          {extensionItems.map((entry) => {
            if (entry.owner.kind !== 'extension' || !isExtensionContributionId(entry.id)) return null
            const title = boundedPlainText(entry.payload.title, 128)
            const locked = !entry.workspaceTrusted
            const alreadyOpen = state.tabs.includes(entry.id)
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelectExtension(entry)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                data-contribution-id={entry.id}
                data-extension-trusted={String(entry.workspaceTrusted)}
              >
                {entry.payload.icon ? (
                  <img
                    src={extensionHostIconUrl(entry.owner.extensionId, entry.payload.icon)}
                    alt=""
                    aria-hidden
                    className="h-4 w-4 shrink-0 object-contain"
                  />
                ) : (
                  <Puzzle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {locked ? t('extensionRailAuthorize', { title }) : title}
                </span>
                {locked ? <LockKeyhole className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} /> : null}
                {!locked && alreadyOpen ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function codeRightTabDomIds(prefix: string, id: RightPanelContributionId): { tabId: string; panelId: string } {
  const safePrefix = safeDomId(prefix)
  const safeId = safeDomId(id)
  return {
    tabId: `${safePrefix}-tab-${safeId}`,
    panelId: `${safePrefix}-panel-${safeId}`
  }
}

export function isCodeRightExtensionTab(id: RightPanelContributionId): boolean {
  return isExtensionContributionId(id)
}
