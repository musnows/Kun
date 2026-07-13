import type { Locale } from '@kun/extension-api'

const EN = {
  appName: 'Kun Video Editor',
  skipEditor: 'Skip to editor',
  projects: 'Projects',
  createProject: 'New project',
  importMedia: 'Import media',
  undo: 'Undo',
  redo: 'Redo',
  mediaLibrary: 'Media library',
  player: 'Player',
  transcript: 'Transcript',
  timeline: 'Timeline',
  inspector: 'Inspector',
  captions: 'Captions',
  revisions: 'Revisions',
  preview: 'Preview and proof',
  agent: 'Video Agent',
  export: 'Export jobs',
  noProject: 'Create or open a project to begin. Kun will not scan your workspace automatically.',
  noMedia: 'No Host-granted media has been imported.',
  noTranscript: 'No timed transcript is available. Manual timeline editing still works.',
  noSelection: 'Select a timeline item or caption to inspect it.',
  localOnly: 'Local transcript-oriented editing for talking-head, interview, and podcast media.',
  unsupported: 'This MVP does not perform arbitrary visual-scene understanding, stock search, generative B-roll, face tracking, or subject-aware reframing.',
  interactionRequired: 'A protected Kun desktop interaction is required.',
  reconnecting: 'Reconnecting to durable project and job state…',
  connected: 'Connected',
  previewMedia: 'Preview',
  openWithSystem: 'Open with system app',
  showInFolder: 'Show in folder',
  hostArtifactAction: 'Kun opens this file through the trusted desktop Host; its local path stays hidden from the extension View.',
  cancel: 'Cancel',
  refresh: 'Refresh',
  split: 'Split',
  delete: 'Delete',
  apply: 'Apply',
  readScript: 'Review timeline.md',
  startAgent: 'Start Agent',
  steerAgent: 'Send guidance',
  cancelAgent: 'Cancel run',
  exportVideo: 'Export H.264',
  proofFrame: 'Proof frame',
  previewClip: 'Preview clip',
  emptyJobs: 'No retained render jobs.',
  technicallyValidated: 'Technically validated by FFmpeg/ffprobe; not visually reviewed.',
  staleProof: 'Stale proof: this artifact belongs to an older project revision.',
  conflict: 'The project changed before this edit committed. The authoritative revision was refreshed; review and retry.',
  approval: 'This run is waiting for approval in the Kun approval surface.',
  userInput: 'This run needs user input. Add guidance below or complete the Kun input prompt.',
  keyboardHelp: 'Shortcuts: Space play/pause, S split, Delete remove, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo.'
} as const

const ZH: Partial<Record<keyof typeof EN, string>> = {
  appName: 'Kun 视频剪辑',
  skipEditor: '跳到编辑区',
  projects: '项目',
  createProject: '新建项目',
  importMedia: '导入媒体',
  undo: '撤销',
  redo: '重做',
  mediaLibrary: '媒体库',
  player: '播放器',
  transcript: '逐字稿',
  timeline: '时间线',
  inspector: '检查器',
  captions: '字幕',
  revisions: '版本',
  preview: '预览与校样',
  agent: '视频 Agent',
  export: '导出任务',
  noProject: '请先创建或打开项目。Kun 不会自动扫描工作区。',
  noMedia: '还没有导入由 Host 授权的媒体。',
  noTranscript: '没有带时间戳的逐字稿，但仍可手动编辑时间线。',
  localOnly: '面向口播、访谈和播客的本地逐字稿剪辑。',
  unsupported: '当前版本不支持任意视觉语义理解、素材搜索、生成式 B-roll、人脸跟踪或主体感知重构图。',
  interactionRequired: '需要在 Kun 桌面受保护界面完成交互。',
  connected: '已连接',
  reconnecting: '正在重连项目与持久化任务…',
  previewMedia: '预览',
  openWithSystem: '使用系统应用打开',
  showInFolder: '在文件夹中显示',
  hostArtifactAction: 'Kun 通过可信桌面 Host 打开此文件，本地路径不会暴露给扩展视图。',
  conflict: '提交前项目已发生变化。已刷新权威版本，请检查后重试。',
  technicallyValidated: '已通过 FFmpeg/ffprobe 技术校验，但尚未完成视觉审阅。'
}

export type MessageKey = keyof typeof EN
export type Messages = Record<MessageKey, string>

export function messagesFor(locale?: Locale): Messages {
  const base = locale?.language.toLowerCase().startsWith('zh') ? { ...EN, ...ZH } : { ...EN }
  for (const key of Object.keys(base) as MessageKey[]) {
    const override = locale?.messages[`kun-video-editor.${key}`]
    if (override) base[key] = override
  }
  return base
}
