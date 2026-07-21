import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultModelProviderSettings, type ModelProviderSettingsV1 } from '@shared/app-settings'
import { ModelRoutesSettings } from './settings-section-model-routes'

function settings(): ModelProviderSettingsV1 {
  const defaults = defaultModelProviderSettings()
  return {
    ...defaults,
    localGateway: { enabled: true, name: 'Kun API' },
    routePools: [
      {
        id: 'kimi-pool', name: 'Kimi 容量池', modelId: 'kimi-auto', enabled: true, strategy: 'adaptive',
        targets: [{ id: 'target', providerId: defaults.providers[0].id, modelId: defaults.providers[0].models[0], enabled: true, weight: 2 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      },
      {
        id: 'code-pool', name: 'Coding 容量池', modelId: 'code-auto', enabled: true, strategy: 'priority',
        targets: [{ id: 'code-target', providerId: defaults.providers[0].id, modelId: defaults.providers[0].models[0], enabled: true, weight: 1 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }
    ]
  }
}

describe('ModelRoutesSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one local provider with multiple routed models and safety policy', () => {
    const html = renderToStaticMarkup(createElement(ModelRoutesSettings, { settings: settings(), onChange: () => undefined }))
    expect(html).toContain('本地中转供应商')
    expect(html).toContain('Kun API')
    expect(html).toContain('2 / 2 个模型已启用')
    expect(html).toContain('路由模型')
    expect(html).toContain('Kimi 容量池')
    expect(html).toContain('kimi-auto')
    expect(html).toContain('Coding 容量池')
    expect(html).toContain('code-auto')
    expect(html).toContain('添加模型')
    expect(html).toContain('稳定性优先自适应')
    expect(html).toContain('流式输出开始后固定停止')
    expect(html).toContain('127.0.0.1 · 无鉴权')
  })

  it('dispatches local API and route pool enable switches', async () => {
    const draft = settings()
    draft.localGateway.enabled = false
    draft.routePools[0].enabled = false
    const onChange = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{"pools":[],"metrics":{},"events":[]}' }))
      }
    })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: draft, onChange }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '开放本地 API' }).props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      localGateway: expect.objectContaining({ enabled: true })
    }))

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '启用路由池' }).props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      routePools: expect.arrayContaining([expect.objectContaining({ id: 'kimi-pool', enabled: true })])
    }))
  })

  it('calls the full-chain route endpoint and renders its result', async () => {
    const runtimeRequest = vi.fn(async (_path: string, method?: string) => method === 'POST'
      ? { ok: true, status: 200, body: '{"ok":true,"text":"OK","metrics":{},"events":[]}' }
      : { ok: true, status: 200, body: '{"pools":[],"metrics":{},"events":[]}' })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ModelRoutesSettings, { settings: settings(), onChange: () => undefined }))
    })
    const testButton = renderer!.root.findAllByType('button').find((button) => textContent(button).includes('测试完整链路'))
    expect(testButton).toBeDefined()

    await act(async () => {
      testButton!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/model-routes/kimi-pool/test', 'POST')
    expect(textContent(renderer!.root)).toContain('链路测试成功：OK')
  })
})

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}
