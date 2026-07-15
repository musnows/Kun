import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { CodeRightPanelTabs } from './CodeRightPanelTabs'
import { emptyCodeRightTabsState, openCodeRightTab } from './code-right-tabs-state'

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

describe('CodeRightPanelTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders dynamic titles and activates tabs with Arrow/Home/End navigation', () => {
    let state = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.browser)
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.file)
    const onActivate = vi.fn()
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state,
        domIdPrefix: 'test-tabs',
        titles: {
          [BUILTIN_RIGHT_PANEL_IDS.browser]: 'Kun docs',
          [BUILTIN_RIGHT_PANEL_IDS.file]: 'README.md'
        },
        planEnabled: false,
        filesEnabled: true,
        sideConversationsEnabled: true,
        sideConversationCount: 2,
        sideConversationRunningCount: 1,
        extensionItems: [],
        onOpen: vi.fn(),
        onActivate,
        onClose: vi.fn(),
        onCollapse: vi.fn(),
        onSelectExtension: vi.fn()
      }))
    })

    const tabs = renderer!.root.findAll((node) => node.props.role === 'tab')
    expect(tabs.map(textContent)).toEqual(['Kun docs', 'README.md'])

    act(() => tabs[0].props.onKeyDown({ key: 'End', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.file)
    act(() => tabs[1].props.onKeyDown({ key: 'Home', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.browser)
    act(() => tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.file)
  })

  it('shows the ordered direct tool menu and disables context-dependent entries', () => {
    const onOpen = vi.fn()
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state: openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.todo),
        domIdPrefix: 'test-menu',
        planEnabled: true,
        filesEnabled: false,
        sideConversationsEnabled: false,
        sideConversationCount: 0,
        sideConversationRunningCount: 0,
        extensionItems: [],
        onOpen,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCollapse: vi.fn(),
        onSelectExtension: vi.fn()
      }))
    })

    const addButton = renderer!.root.findByProps({ 'aria-label': 'Open right workspace tool' })
    act(() => addButton.props.onClick())
    const items = renderer!.root.findAll((node) => node.props['data-tool-id'])
    expect(items.map((item) => item.props['data-tool-id'])).toEqual([
      BUILTIN_RIGHT_PANEL_IDS.terminal,
      BUILTIN_RIGHT_PANEL_IDS.browser,
      BUILTIN_RIGHT_PANEL_IDS.files,
      BUILTIN_RIGHT_PANEL_IDS.sideConversations,
      BUILTIN_RIGHT_PANEL_IDS.todo,
      BUILTIN_RIGHT_PANEL_IDS.plan,
      BUILTIN_RIGHT_PANEL_IDS.changes,
      BUILTIN_RIGHT_PANEL_IDS.canvas,
      BUILTIN_RIGHT_PANEL_IDS.subagents
    ])
    expect(items[0].props.disabled).toBe(true)
    expect(items[2].props.disabled).toBe(true)
    expect(items[3].props.disabled).toBe(true)
    act(() => items[1].props.onClick())
    expect(onOpen).toHaveBeenCalledWith(BUILTIN_RIGHT_PANEL_IDS.browser)
  })

  it('keeps the plus launcher operable in an empty Electron no-drag workspace', () => {
    const onOpen = vi.fn()
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state: { ...emptyCodeRightTabsState(), expanded: true },
        domIdPrefix: 'empty-menu',
        planEnabled: false,
        filesEnabled: true,
        sideConversationsEnabled: true,
        sideConversationCount: 0,
        sideConversationRunningCount: 0,
        extensionItems: [],
        onOpen,
        onActivate: vi.fn(),
        onClose: vi.fn(),
        onCollapse: vi.fn(),
        onSelectExtension: vi.fn()
      }))
    })

    const chrome = renderer!.root.find((node) =>
      typeof node.props.className === 'string' && node.props.className.includes('ds-code-right-tabs'))
    expect(chrome.props.className).toContain('ds-no-drag')
    expect(renderer!.root.findAll((node) => node.props.role === 'tab')).toHaveLength(0)

    const addButton = renderer!.root.findByProps({ 'aria-label': 'Open right workspace tool' })
    act(() => addButton.props.onClick())
    const browser = renderer!.root.findByProps({ 'data-tool-id': BUILTIN_RIGHT_PANEL_IDS.browser })
    act(() => browser.props.onClick())
    expect(onOpen).toHaveBeenCalledWith(BUILTIN_RIGHT_PANEL_IDS.browser)
  })
})
