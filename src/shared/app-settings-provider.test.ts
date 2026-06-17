import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  normalizeModelProviderSettings,
  resolveModelProviderProxyUrl,
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: {
      ...defaultModelProviderSettings(),
      providers: [
        ...defaultModelProviderSettings().providers,
        {
          id: 'custom',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          models: ['custom-model']
        }
      ]
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        providerId: 'custom',
        model: 'custom-model'
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' }
  }
}

describe('model provider settings', () => {
  it('resolves Kun runtime credentials from the selected provider', () => {
    const runtime = resolveKunRuntimeSettings(settings())

    expect(runtime.apiKey).toBe('sk-custom')
    expect(runtime.baseUrl).toBe('https://custom.example/v1')
  })

  it('normalizes common proxy protocols for model requests', () => {
    const provider = normalizeModelProviderSettings({
      proxy: {
        enabled: true,
        url: ' socks5://127.0.0.1:1080 '
      }
    })

    expect(provider.proxy).toEqual({
      enabled: true,
      url: 'socks5://127.0.0.1:1080'
    })
  })

  it('disables invalid proxy URLs', () => {
    const provider = normalizeModelProviderSettings({
      proxy: {
        enabled: true,
        url: 'ftp://127.0.0.1:2121'
      }
    })

    expect(provider.proxy).toEqual({
      enabled: false,
      url: ''
    })
  })

  it('resolves the configured model proxy URL only when enabled', () => {
    const configured = settings()
    configured.provider.proxy = {
      enabled: true,
      url: 'http://127.0.0.1:7890/'
    }

    expect(resolveModelProviderProxyUrl(configured)).toBe('http://127.0.0.1:7890/')

    configured.provider.proxy.enabled = false
    expect(resolveModelProviderProxyUrl(configured)).toBe('')
  })
})
