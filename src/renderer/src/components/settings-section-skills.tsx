import type { ReactElement } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import type { AppSettingsV1 } from '@shared/app-settings'
import type { SkillListItem } from '@shared/ds-gui-api'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

const SLASH_SKILL_LIMIT = 40

function comparablePath(path: string | undefined): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isProjectSkillRoot(skillRoot: string | undefined, workspaceRoot: string): boolean {
  const root = comparablePath(skillRoot)
  const workspace = comparablePath(workspaceRoot)
  return Boolean(root && workspace && (root === workspace || root.startsWith(`${workspace}/`)))
}

function isProjectSkill(
  skill: { root?: string; scope?: 'project' | 'global' },
  workspaceRoot: string
): boolean {
  return (
    skill.scope === 'project' ||
    (skill.scope !== 'global' && isProjectSkillRoot(skill.root, workspaceRoot))
  )
}

function slashMenuIndex(
  skill: SkillListItem,
  allSkills: SkillListItem[],
  disabledIds: string[],
  workspaceRoot: string
): number | null {
  let pos = -1
  for (const s of allSkills) {
    if (disabledIds.includes(s.id)) continue
    pos++
    if (s.id === skill.id && s.root === skill.root) return pos
  }
  return null
}

function SkillRow({
  skill,
  disabled,
  scopeLabel,
  statusBadge,
  onToggle
}: {
  skill: SkillListItem
  disabled: boolean
  scopeLabel: string
  statusBadge: ReactElement | null
  onToggle: () => void
}): ReactElement {
  return (
    <div className="flex flex-col gap-4 px-3 py-5 sm:flex-row sm:items-start sm:gap-8">
      <div className={`min-w-0 max-w-[640px] ${disabled ? 'opacity-55' : ''}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <span className={disabled ? 'text-ds-muted' : ''}>{skill.name}</span>
          <span className="shrink-0 rounded-full border border-ds-border-muted px-2 py-0 text-[10px] font-medium text-ds-muted">
            {scopeLabel}
          </span>
          {statusBadge}
        </div>
        {skill.description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-ds-muted">{skill.description}</p>
        ) : null}
        <p className="mt-1 text-[11px] leading-5 text-ds-faint">
          <code className="rounded bg-ds-subtle px-1 py-0.5 text-[11px]">{skill.id}</code>
          {' '}&middot;{' '}
          <span className="select-all break-all">{skill.root}</span>
        </p>
      </div>
      <div className="flex shrink-0 sm:ml-auto">
        <Toggle checked={!disabled} onChange={onToggle} />
      </div>
    </div>
  )
}

export function SkillsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const t: (key: string, vars?: Record<string, unknown>) => string = ctx.t
  const form = ctx.form as AppSettingsV1
  const update = ctx.update as (patch: Record<string, unknown>) => void
  const allSkills = (ctx.allSkills ?? []) as SkillListItem[]
  const skillsLoading = ctx.skillsLoading as boolean
  const disabledSkillIds: string[] = form.disabledSkillIds ?? []
  const workspaceRoot = normalizeWorkspaceRoot(form.workspaceRoot)

  const sorted = [...allSkills].sort((a, b) => {
    const aProj = isProjectSkill(a, workspaceRoot)
    const bProj = isProjectSkill(b, workspaceRoot)
    if (aProj !== bProj) return aProj ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const enabledCount = sorted.filter((s) => !disabledSkillIds.includes(s.id)).length
  const totalCount = sorted.length
  const loadedCount = Math.min(enabledCount, SLASH_SKILL_LIMIT)
  const unloadedCount = Math.max(0, enabledCount - SLASH_SKILL_LIMIT)

  const updateDisabledIds = (addId: string | null, removeId: string | null): void => {
    let next: string[]
    if (addId) {
      if (disabledSkillIds.includes(addId)) return
      next = [...disabledSkillIds, addId]
    } else if (removeId) {
      next = disabledSkillIds.filter((id) => id !== removeId)
    } else {
      return
    }
    update({ disabledSkillIds: next })
  }

  if (skillsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[14px] text-ds-muted">{t('skillsLoading')}</p>
      </div>
    )
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Sparkles className="h-8 w-8 text-ds-faint" strokeWidth={1.5} />
        <p className="text-[14px] text-ds-muted">{t('skillsEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* limit notice */}
      {unloadedCount > 0 ? (
        <div className="rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
            <div>
              <div className="text-[15px] font-semibold">
                {t('skillsLimitTitle')}
              </div>
              <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
                {t('skillsLimitNotice', {
                  loaded: String(loadedCount),
                  total: String(totalCount),
                  unloaded: String(unloadedCount)
                })}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* stats card */}
      <SettingsCard title={t('skills')}>
        <SettingRow
          title={t('skillsTotal')}
          control={
            <span className="text-[14px] text-ds-muted">
              {t('skillsCount', {
                enabled: String(enabledCount),
                total: String(totalCount)
              })}
            </span>
          }
        />
        <SettingRow
          title={t('skillsLoaded')}
          description={t('skillsLoadedDesc', { limit: String(SLASH_SKILL_LIMIT) })}
          control={
            <span className="text-[14px] tabular-nums font-semibold text-ds-ink">
              {loadedCount}
            </span>
          }
        />
      </SettingsCard>

      {/* skill list */}
      <SettingsCard title={t('skillsList')}>
        {sorted.map((skill) => {
          const disabled = disabledSkillIds.includes(skill.id)
          const slashIdx = slashMenuIndex(skill, sorted, disabledSkillIds, workspaceRoot)
          const inSlashMenu = slashIdx !== null && slashIdx < SLASH_SKILL_LIMIT
          const scopeLabel = isProjectSkill(skill, workspaceRoot)
            ? t('skillsScopeProject')
            : t('skillsScopeGlobal')

          let statusBadge: ReactElement | null = null
          if (disabled) {
            statusBadge = (
              <span className="shrink-0 rounded-full bg-ds-faint px-2 py-0.5 text-[11px] font-medium text-ds-muted">
                {t('skillsStatusDisabled')}
              </span>
            )
          } else if (!inSlashMenu) {
            statusBadge = (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
                {t('skillsStatusNotLoaded')}
              </span>
            )
          }

          return (
            <SkillRow
              key={`${skill.id}-${skill.root}`}
              skill={skill}
              disabled={disabled}
              scopeLabel={scopeLabel}
              statusBadge={statusBadge}
              onToggle={() => {
                if (disabled) {
                  updateDisabledIds(null, skill.id)
                } else {
                  updateDisabledIds(skill.id, null)
                }
              }}
            />
          )
        })}
      </SettingsCard>
    </div>
  )
}
