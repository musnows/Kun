import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, Pencil, Plus, Power, Sparkles, Trash2 } from 'lucide-react'
import type { KunSubagentProfileV1, KunSubagentsSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { confirmDialog } from '../../lib/confirm-dialog'
import { useChatStore } from '../../store/chat-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { AgentKun } from './AgentKun'

type Props = { leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void }

const EMPTY_SUBAGENTS: KunSubagentsSettingsV1 = { enabled: true, profiles: [] }
const PRESET_COLORS = ['#3b82d8', '#1d9e75', '#e8943a', '#7f77dd', '#d4537e', '#d85a30']

/** Built-in ids that cannot be deleted (only disabled). Mirrors kun presets. */
const BUILTIN_IDS = new Set(['general', 'explore'])

function newProfile(): KunSubagentProfileV1 {
  return { id: crypto.randomUUID(), enabled: true, name: '', mode: 'subagent', toolPolicy: 'readOnly' }
}

type GeneratedProfile = {
  name?: string; description?: string; color?: string
  mode?: 'subagent' | 'primary' | 'all'; model?: string; providerId?: string
  systemPrompt?: string; promptPreamble?: string
  toolPolicy?: 'readOnly' | 'inherit'; allowedTools?: string[]
}

async function aiDraftProfile(intent: string): Promise<GeneratedProfile | { error: string }> {
  try {
    const res = await rendererRuntimeClient.runtimeRequest('/v1/agents/generate', 'POST', JSON.stringify({ intent }))
    if (!res.ok) return { error: res.body || 'generation failed' }
    const parsed = JSON.parse(res.body) as { profile?: GeneratedProfile; error?: string }
    return parsed.error ? { error: parsed.error } : (parsed.profile ?? { error: 'empty response' })
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function AgentsView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const composerModelGroups = useChatStore((s) => s.composerModelGroups)
  const loadComposerModels = useChatStore((s) => s.loadComposerModels)
  const [subagents, setSubagents] = useState<KunSubagentsSettingsV1>(EMPTY_SUBAGENTS)
  const [summaryModel, setSummaryModel] = useState('')
  const [summaryProviderId, setSummaryProviderId] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ profile: KunSubagentProfileV1; isNew: boolean } | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      setSubagents(settings.agents?.kun?.subagents ?? EMPTY_SUBAGENTS)
      setSummaryModel(settings.agents?.kun?.contextCompaction?.summaryModel ?? '')
      setSummaryProviderId(settings.agents?.kun?.contextCompaction?.summaryProviderId ?? '')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadComposerModels() }, [loadComposerModels])

  const persistProfiles = useCallback(async (profiles: KunSubagentProfileV1[]): Promise<void> => {
    const next = { ...subagents, profiles }
    setSubagents(next)
    const saved = await rendererRuntimeClient.setSettings({ agents: { kun: { subagents: next } } })
    if (saved.agents?.kun?.subagents) setSubagents(saved.agents.kun.subagents)
  }, [subagents])

  const persistSummaryModel = useCallback(async (model: string, providerId: string): Promise<void> => {
    setSummaryModel(model)
    setSummaryProviderId(providerId)
    await rendererRuntimeClient.setSettings({
      agents: { kun: { contextCompaction: { summaryModel: model, summaryProviderId: providerId } } }
    })
  }, [])

  const setProfileModel = useCallback((id: string, model: string, providerId: string): void => {
    void persistProfiles(subagents.profiles.map((p) =>
      p.id === id ? { ...p, ...(model ? { model } : { model: undefined }), ...(providerId ? { providerId } : { providerId: undefined }) } : p
    ))
  }, [subagents.profiles, persistProfiles])

  const toggleEnabled = useCallback((id: string): void => {
    void persistProfiles(subagents.profiles.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p))
  }, [subagents.profiles, persistProfiles])

  const removeProfile = useCallback(async (id: string): Promise<void> => {
    const p = subagents.profiles.find((x) => x.id === id)
    if (!(await confirmDialog(t('agentsView.deleteConfirm', 'Delete this agent?'), p?.name ?? id))) return
    void persistProfiles(subagents.profiles.filter((x) => x.id !== id))
  }, [subagents.profiles, persistProfiles, t])

  const saveDialog = useCallback((profile: KunSubagentProfileV1): void => {
    const exists = subagents.profiles.some((p) => p.id === profile.id)
    void persistProfiles(exists
      ? subagents.profiles.map((p) => p.id === profile.id ? profile : p)
      : [...subagents.profiles, profile])
    setDialog(null)
  }, [subagents.profiles, persistProfiles])

  const isBuiltin = (p: KunSubagentProfileV1): boolean => p.builtin === true || BUILTIN_IDS.has(p.id)
  const delegatable = useMemo(() => subagents.profiles, [subagents.profiles])

  if (loading) {
    return (
      <div className="flex h-full flex-col bg-ds-main">
        <div className="h-10 shrink-0" />
        <div className="flex flex-1 items-center justify-center text-sm text-ds-muted">{t('loading', 'Loading')}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-ds-main">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ds-border px-3">
        {leftSidebarCollapsed ? <SidebarTitlebarToggleButton onClick={onToggleLeftSidebar} /> : null}
        <Bot className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <span className="text-sm font-medium text-ds-heading">{t('subagents', 'Agents')}</span>
        <span className="text-xs text-ds-faint">· {t('agentsView.configureModel', 'configure model')}</span>
        <div className="flex-1" />
        <button onClick={() => setGenerateOpen(true)} className="flex items-center gap-1.5 rounded-md border border-ds-border bg-ds-surface px-2.5 py-1 text-xs text-ds-muted hover:bg-ds-hover hover:text-ds-heading">
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />{t('aiGenerateAgent', 'AI draft')}
        </button>
        <button onClick={() => setDialog({ profile: newProfile(), isNew: true })} className="flex items-center gap-1.5 rounded-md bg-ds-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-ds-accent/90">
          <Plus className="h-3.5 w-3.5" />{t('newAgent', 'New agent')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-2 px-1 text-xs text-ds-faint">{t('agentsView.delegatable', 'Delegatable · usable in chat')}</div>
        <div className="space-y-2">
          {delegatable.map((p) => (
            <AgentRow
              key={p.id} profile={p} builtin={isBuiltin(p)} groups={composerModelGroups}
              onModel={(m, pid) => setProfileModel(p.id, m, pid)}
              onToggle={() => toggleEnabled(p.id)}
              onEdit={() => setDialog({ profile: { ...p }, isNew: false })}
              onDelete={() => void removeProfile(p.id)}
            />
          ))}
        </div>

        <div className="mb-2 mt-6 px-1 text-xs text-ds-faint">{t('agentsView.system', 'System · runs automatically')}</div>
        <div className="space-y-2">
          <SystemRow
            id="compaction" name={t('agentsView.compaction', 'Compaction')}
            desc={t('agentsView.compactionDesc', 'Compress long context')}
            model={summaryModel} providerId={summaryProviderId} groups={composerModelGroups}
            onModel={(m, pid) => void persistSummaryModel(m, pid)}
          />
          <SystemRow id="title" name={t('agentsView.title', 'Title')} desc={t('agentsView.titleDesc', 'Generate chat title')} ruleBased ruleLabel={t('agentsView.ruleBased', 'Rule-based')} />
          <SystemRow id="summary" name={t('agentsView.summary', 'Summary')} desc={t('agentsView.summaryDesc', 'Conversation summary')} ruleBased ruleLabel={t('agentsView.ruleBased', 'Rule-based')} />
        </div>
      </div>

      {dialog ? <ProfileDialog profile={dialog.profile} isNew={dialog.isNew} builtin={isBuiltin(dialog.profile)} groups={composerModelGroups} onSave={saveDialog} onCancel={() => setDialog(null)} /> : null}
      {generateOpen ? <GenerateDialog onCancel={() => setGenerateOpen(false)} onAccept={(g) => {
        setGenerateOpen(false)
        setDialog({ isNew: true, profile: {
          id: crypto.randomUUID(), enabled: true, name: g.name?.trim() || 'New agent',
          ...(g.description ? { description: g.description } : {}), ...(g.color ? { color: g.color } : {}),
          mode: g.mode ?? 'subagent', ...(g.model ? { model: g.model } : {}), ...(g.providerId ? { providerId: g.providerId } : {}),
          ...(g.systemPrompt ? { systemPrompt: g.systemPrompt } : {}), ...(g.promptPreamble ? { promptPreamble: g.promptPreamble } : {}),
          toolPolicy: g.toolPolicy ?? 'readOnly', ...(g.allowedTools ? { allowedTools: g.allowedTools } : {})
        } })
      }} /> : null}
    </div>
  )
}

function ModelSelect({ value, providerId, groups, onChange, disabled }: {
  value: string; providerId: string
  groups: { providerId: string; providerLabel: string; models: { id: string; label: string }[] }[]
  onChange: (model: string, providerId: string) => void; disabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const cur = value ? `${providerId} ${value}` : ''
  return (
    <div className="relative shrink-0">
      <select
        value={cur} disabled={disabled}
        onChange={(e) => { const [pid, m] = e.target.value.split(' '); onChange(m ?? '', pid ?? '') }}
        className="h-8 w-[150px] appearance-none rounded-full border border-ds-border bg-ds-surface pl-3 pr-7 text-xs text-ds-heading disabled:opacity-50"
      >
        <option value="">{t('agentsView.followDefault', 'Follow default')}</option>
        {groups.map((g) => (
          <optgroup key={g.providerId} label={g.providerLabel}>
            {g.models.map((m) => <option key={`${g.providerId}/${m.id}`} value={`${g.providerId} ${m.id}`}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint" />
    </div>
  )
}

function AgentRow({ profile, builtin, groups, onModel, onToggle, onEdit, onDelete }: {
  profile: KunSubagentProfileV1; builtin: boolean
  groups: { providerId: string; providerLabel: string; models: { id: string; label: string }[] }[]
  onModel: (m: string, pid: string) => void; onToggle: () => void; onEdit: () => void; onDelete: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const desc = builtin ? t(`agentsView.builtin.${profile.id}`, profile.description ?? '') : (profile.description ?? '')
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${profile.enabled ? 'border-ds-border bg-ds-surface' : 'border-ds-border/50 bg-ds-surface/50 opacity-60'}`}>
      <AgentKun id={profile.id} color={profile.color ?? '#3b82d8'} className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ds-heading">{profile.name || profile.id}</span>
          {builtin ? <span className="rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10px] text-ds-muted">{t('agentsView.builtinTag', 'built-in')}</span> : null}
        </div>
        {desc ? <div className="truncate text-xs text-ds-muted">{desc}</div> : null}
      </div>
      <ModelSelect value={profile.model ?? ''} providerId={profile.providerId ?? ''} groups={groups} onChange={onModel} />
      <div className="flex shrink-0 items-center gap-0.5">
        <button onClick={onToggle} title={profile.enabled ? t('disable', 'Disable') : t('enable', 'Enable')} className={`rounded p-1.5 hover:bg-ds-subtle ${profile.enabled ? 'text-ds-accent' : 'text-ds-faint'}`}><Power className="h-3.5 w-3.5" /></button>
        <button onClick={onEdit} title={t('agentsView.edit', 'Edit')} className="rounded p-1.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-heading"><Pencil className="h-3.5 w-3.5" /></button>
        {builtin ? null : <button onClick={onDelete} title={t('agentsView.delete', 'Delete')} className="rounded p-1.5 text-ds-muted hover:bg-ds-subtle hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  )
}

function SystemRow({ id, name, desc, model, providerId, groups, onModel, ruleBased, ruleLabel }: {
  id: string; name: string; desc: string
  model?: string; providerId?: string
  groups?: { providerId: string; providerLabel: string; models: { id: string; label: string }[] }[]
  onModel?: (m: string, pid: string) => void; ruleBased?: boolean; ruleLabel?: string
}): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ds-border bg-ds-surface px-3 py-2.5">
      <AgentKun id={id} color="#7f77dd" className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ds-heading">{name}</div>
        <div className="truncate text-xs text-ds-muted">{desc}</div>
      </div>
      {ruleBased
        ? <span className="shrink-0 rounded-full border border-dashed border-ds-border px-3 py-1 text-xs text-ds-faint">{ruleLabel}</span>
        : <ModelSelect value={model ?? ''} providerId={providerId ?? ''} groups={groups ?? []} onChange={(m, pid) => onModel?.(m, pid)} />}
    </div>
  )
}

function ProfileDialog({ profile: initial, isNew, builtin, groups, onSave, onCancel }: {
  profile: KunSubagentProfileV1; isNew: boolean; builtin: boolean
  groups: { providerId: string; providerLabel: string; models: { id: string; label: string }[] }[]
  onSave: (p: KunSubagentProfileV1) => void; onCancel: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [d, setD] = useState<KunSubagentProfileV1>(initial)
  const set = <K extends keyof KunSubagentProfileV1>(k: K, v: KunSubagentProfileV1[K]): void => setD((p) => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-ds-border bg-ds-main shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ds-border px-4 py-3">
          <Bot className="h-4 w-4 text-ds-muted" />
          <span className="text-sm font-semibold text-ds-heading">{isNew ? t('newAgent', 'New agent') : t('agentsView.editAgent', 'Edit agent')}</span>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <Field label={t('agentsView.fName', 'Name')}>
            <input autoFocus value={d.name} disabled={builtin} onChange={(e) => set('name', e.target.value)} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm" />
          </Field>
          <Field label={t('agentsView.fDesc', 'Description')}>
            <input value={d.description ?? ''} onChange={(e) => set('description', e.target.value || undefined)} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm" />
          </Field>
          <Field label={t('agentsView.fColor', 'Color')}>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button key={c} onClick={() => set('color', c)} className="h-6 w-6 rounded-full" style={{ backgroundColor: c, outline: d.color === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }} />
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('agentsView.fMode', 'Mode')}>
              <select value={d.mode} onChange={(e) => set('mode', e.target.value as KunSubagentProfileV1['mode'])} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm">
                <option value="subagent">{t('agentsView.modeDelegate', 'delegate')}</option>
                <option value="primary">{t('agentsView.modePersona', 'persona')}</option>
                <option value="all">{t('agentsView.modeBoth', 'both')}</option>
              </select>
            </Field>
            <Field label={t('agentsView.fTools', 'Tool access')}>
              <select value={d.toolPolicy} onChange={(e) => set('toolPolicy', e.target.value as KunSubagentProfileV1['toolPolicy'])} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm">
                <option value="readOnly">{t('agentsView.toolReadOnly', 'read-only')}</option>
                <option value="inherit">{t('agentsView.toolInherit', 'all tools')}</option>
              </select>
            </Field>
          </div>
          <Field label={t('agentsView.fModel', 'Model')} hint={t('agentsView.modelHint', 'Pick on the list row, or set provider:model here')}>
            <div className="grid grid-cols-2 gap-3">
              <input value={d.providerId ?? ''} placeholder={t('agentsView.providerId', 'provider id')} onChange={(e) => set('providerId', e.target.value.trim() || undefined)} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 font-mono text-xs" />
              <input value={d.model ?? ''} placeholder="model" onChange={(e) => set('model', e.target.value.trim() || undefined)} className="w-full rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 font-mono text-xs" />
            </div>
          </Field>
          <Field label={t('agentsView.fSystemPrompt', 'System prompt')}>
            <textarea value={d.systemPrompt ?? ''} rows={3} onChange={(e) => set('systemPrompt', e.target.value || undefined)} className="w-full resize-none rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-ds-muted hover:text-ds-heading">{t('agentsView.cancel', 'Cancel')}</button>
          <button onClick={() => onSave({ ...d, name: d.name.trim() || d.id })} className="rounded-md bg-ds-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-ds-accent/90">{isNew ? t('agentsView.create', 'Create') : t('agentsView.save', 'Save')}</button>
        </div>
      </div>
    </div>
  )
}

function GenerateDialog({ onAccept, onCancel }: { onAccept: (g: GeneratedProfile) => void; onCancel: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    if (!intent.trim()) return
    setBusy(true); setErr(null)
    const r = await aiDraftProfile(intent.trim())
    setBusy(false)
    if ('error' in r) setErr(r.error); else onAccept(r)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col rounded-xl border border-ds-border bg-ds-main shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ds-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold text-ds-heading">{t('agentsView.aiDraftTitle', 'AI draft an agent')}</span>
        </div>
        <div className="space-y-3 px-4 py-4">
          <textarea autoFocus value={intent} rows={4} onChange={(e) => { setIntent(e.target.value); setErr(null) }} placeholder={t('agentsView.aiDraftPlaceholder', 'e.g. a Python type-hint reviewer')} className="w-full resize-none rounded-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm" />
          {err ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{err}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button onClick={onCancel} disabled={busy} className="rounded-md px-3 py-1.5 text-sm text-ds-muted hover:text-ds-heading disabled:opacity-50">{t('agentsView.cancel', 'Cancel')}</button>
          <button onClick={() => void run()} disabled={busy || !intent.trim()} className="rounded-md bg-ds-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-ds-accent/90 disabled:opacity-50">{busy ? t('agentsView.drafting', 'Drafting…') : t('agentsView.draft', 'Draft')}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement }): ReactElement {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ds-muted">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-ds-faint">{hint}</p> : null}
    </div>
  )
}
