import { describe, expect, it } from 'vitest'
import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import {
  buildProviderModelImportEntries,
  defaultSelectedProviderModelImportKeys,
  enrichProviderModelProfiles,
  mergeProviderModelIdsCaseInsensitive,
  providerModelImportEntryKey,
  providerModelImportResult
} from './provider-model-import'

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'acme',
    name: 'Acme',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function catalog(
  models: Extract<ModelsDevCatalogResult, { status: 'ok' }>['models'],
  matchMode: 'catalog' | 'enrichment-only' = 'catalog'
): ModelsDevCatalogResult {
  return {
    status: 'ok',
    providerKey: 'acme',
    providerName: 'Acme',
    matchMode,
    stale: false,
    models
  }
}

describe('provider model import merging', () => {
  it('deduplicates ids case-insensitively, preserves API casing, and leaves catalog-only rows unchecked', () => {
    const entries = buildProviderModelImportEntries(
      provider(),
      ['Model-A', 'model-a', 'api-only'],
      catalog([
        {
          id: 'model-a',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          toolCalling: true
        },
        {
          id: 'catalog-only',
          inputModalities: ['text'],
          outputModalities: ['text']
        }
      ])
    )

    expect(entries.map((entry) => entry.modelId)).toEqual(['Model-A', 'api-only', 'catalog-only'])
    expect(entries[0]?.sources).toEqual(['provider-api', 'models-dev'])
    expect(entries[2]?.sources).toEqual(['models-dev'])
    const selected = defaultSelectedProviderModelImportKeys(entries)
    expect(selected).toEqual(new Set([
      providerModelImportEntryKey('chat', 'Model-A'),
      providerModelImportEntryKey('chat', 'api-only')
    ]))
  })

  it('uses catalog modalities for media classification before id fallback', () => {
    const entries = buildProviderModelImportEntries(provider(), [], catalog([
      { id: 'visual-maker', inputModalities: ['text'], outputModalities: ['image'] },
      { id: 'sound-reader', inputModalities: ['audio'], outputModalities: ['text'] },
      { id: 'voice-maker', inputModalities: ['text'], outputModalities: ['audio'] },
      { id: 'movie-maker', inputModalities: ['text'], outputModalities: ['video'] },
      { id: 'music-2.6', inputModalities: ['text'], outputModalities: ['audio'] }
    ]))
    expect(entries.map(({ modelId, kind }) => [modelId, kind])).toEqual([
      ['visual-maker', 'image'],
      ['sound-reader', 'speech'],
      ['voice-maker', 'tts'],
      ['movie-maker', 'video'],
      ['music-2.6', 'music']
    ])
  })

  it('keeps enrichment-only catalog rows limited to provider-confirmed ids', () => {
    const entries = buildProviderModelImportEntries(provider(), ['model-a'], catalog([
      { id: 'model-a', inputModalities: ['text'], outputModalities: ['text'] },
      { id: 'catalog-only', inputModalities: ['text'], outputModalities: ['text'] }
    ], 'enrichment-only'))
    expect(entries.map((entry) => entry.modelId)).toEqual(['model-a'])
    expect(entries[0]?.sources).toEqual(['provider-api', 'models-dev'])
  })

  it('returns metadata only for selected rows', () => {
    const entries = buildProviderModelImportEntries(provider(), ['model-a'], catalog([
      { id: 'model-a', inputModalities: ['text'], outputModalities: ['text'] },
      { id: 'catalog-only', inputModalities: ['text'], outputModalities: ['text'] }
    ]))
    const selected = new Set([providerModelImportEntryKey('chat', 'catalog-only')])
    expect(providerModelImportResult(entries, selected)).toEqual({
      chat: ['catalog-only'],
      image: [],
      speech: [],
      tts: [],
      music: [],
      video: [],
      catalogModels: [{
        id: 'catalog-only',
        inputModalities: ['text'],
        outputModalities: ['text']
      }]
    })
  })

  it('merges stored ids without case-only duplicates', () => {
    expect(mergeProviderModelIdsCaseInsensitive(
      ['Existing-Model'],
      ['existing-model', 'New-Model']
    )).toEqual(['Existing-Model', 'New-Model'])
  })
})

describe('models.dev profile enrichment', () => {
  it('creates a runtime-safe profile for a new imported chat model', () => {
    const target = provider()
    const next = enrichProviderModelProfiles(target, ['vision-model'], [{
      id: 'vision-model',
      inputModalities: ['text', 'image', 'pdf'],
      outputModalities: ['text'],
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_000,
      toolCalling: false,
      reasoning: true,
      description: 'Display-only field'
    }])
    expect(next['vision-model']).toEqual({
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text', 'image_url']
    })
    expect(next['vision-model']).not.toHaveProperty('description')
    expect(next['vision-model']).not.toHaveProperty('reasoning')
  })

  it('fills only missing limits on an existing profile and preserves behavior fields', () => {
    const explicitProfile: ModelProviderModelProfileV1 = {
      aliases: ['writer'],
      maxOutputTokens: 4_096,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false,
      messageParts: ['text'],
      endpointFormat: 'messages',
      responsesMode: 'lite',
      reasoning: {
        supportedEfforts: ['off', 'high'],
        defaultEffort: 'high',
        requestProtocol: 'anthropic-thinking'
      }
    }
    const target = provider({ modelProfiles: { 'Model-A': explicitProfile } })
    const next = enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'MODEL-A',
      inputModalities: ['text', 'image'],
      outputModalities: ['text', 'image'],
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      toolCalling: true
    }])
    expect(next['Model-A']).toEqual({
      ...explicitProfile,
      contextWindowTokens: 1_000_000
    })
  })

  it('returns the original profile map when there is nothing safe to add', () => {
    const profile: ModelProviderModelProfileV1 = {
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_000,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    }
    const target = provider({ modelProfiles: { 'model-a': profile } })
    expect(enrichProviderModelProfiles(target, ['model-a'], [{
      id: 'model-a',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindowTokens: 256_000,
      maxOutputTokens: 16_000,
      toolCalling: false
    }])).toBe(target.modelProfiles)
  })
})
