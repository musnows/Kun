# 扩展媒体与后台任务

Extension API v1.1 新增 Host 代理的本地媒体能力和持久后台 Job。它适用于
视频、音频、图像序列和渲染类扩展，避免把大文件塞进 JSON IPC。

## 权限模型

只声明实际需要的权限：

| 权限 | 能力 |
| --- | --- |
| `media.read` | 读取 Host 已授权的不透明媒体 handle |
| `media.process` | 使用有界的 Host `ffprobe`/`ffmpeg` broker |
| `media.export` | 写入 Host 已授权的导出目标 |
| `jobs.manage` | 观察和取消本扩展拥有的 Job |
| `workspace.read` / `workspace.write` | 还必须与对应媒体权限配套授予 |

每次调用都会重新检查当前扩展、必要时的精确版本、workspace、信任、权限和
文件身份。Handle 不是环境文件系统权限。可信 Node 扩展仍属于可信原生代码；
这些 broker 不会把任意扩展代码变成操作系统沙箱。

## 受保护选择

`context.media.pickFiles()` 和 `pickSaveTarget()` 只打开 Main 拥有的对话框。
扩展提供的是有界显示过滤器和建议名称，不是路径或授权。取消不会创建 handle、
目标文件或半成品。成功响应只含带不透明 `handleId` 的 `MediaMetadata`，不含
绝对路径。

Picker 需要交互式桌面 View。Headless 工具应返回 interaction-required 检查点，
提示用户打开编辑器；不能自行弹窗、选择默认路径或伪造授权。

## 元数据与播放

`media.stat()` 返回有界元数据。`media.probe()` 使用固定 ffprobe JSON profile，
返回归一化 container/stream 字段，不返回可执行文件路径、源路径、环境或原始日志。

沙箱 View 通过 `media.openViewResource()` 把可读 handle 换成短期
`kun-media://` URL。该 URL 绑定扩展、精确 View Session、contribution、sender
主 frame、workspace 和文件身份。不得持久化 URL；应持久化 handle 或 artifact
引用，重开后重新申请 lease。

Chromium 播放支持 `HEAD`、完整 `GET` 和单个有界 byte Range。Host 以背压方式
流式读取。复制的 URL、多 Range、过期 session/lease、替换后的文件和其他 sender
都会被拒绝。View CSP 只为媒体允许 `kun-media:`，仍保持 `connect-src 'none'`、
context isolation、sandbox、导航限制和 Node integration 关闭。

不再使用时调用 `media.release()`。Disable、update、rollback、uninstall、权限或
workspace 变化、View 关闭/崩溃、到期和文件替换也会撤销相关资源。

## FFmpeg broker

`media.startFfmpegJob()` 接收参数数组和具名 handle 绑定。资源占位符必须独占一个参数：

```ts
const { job } = await context.media.startFfmpegJob({
  arguments: [
    '-i', '{{input:source}}',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '{{output:video}}'
  ],
  inputs: { source: inputHandleId },
  outputs: { video: exportTargetHandleId },
  textOutputs: {
    captions: {
      handleId: subtitleTargetHandleId,
      mimeType: 'application/x-subrip',
      content: generatedSrt
    }
  },
  idempotencyKey: `project-${projectId}-revision-${revision}`
})
```

Host 仅在最终 spawn 边界替换规范路径。Shell 语法、原始路径、URL、协议、设备、
response file、可执行文件覆盖、会加载路径的 filter 和 Host 保留选项都会被拒绝。
Kun 只使用配置或清理后 PATH 中的程序，采用 `shell: false`、最小环境、有界日志与
进度、同目录 staging、字节/时间配额、进程树取消、输出后 ffprobe 和原子提升。

`textOutputs` 是可选的有界 UTF-8 sidecar 映射，用于与媒体输出属于同一事务的字幕等
文本文件。每项只能包含 Host 授权的 export handle、`application/x-subrip` 或
`text/vtt` MIME，以及限制内的内联内容；内容绝不会进入
FFmpeg 参数。Kun 会把这些文本与声明的 FFmpeg 输出一起 staging、校验、提升、消费或
回滚，避免视频与字幕导出失败时只发布一半。

Kun 不在每个 `.kunx` 内捆绑 FFmpeg。请安装兼容的 Host FFmpeg，或配置应用管理的
override。缺失原生工具时仍可编辑项目，但 probe/export 返回
`MEDIA_EXECUTABLE_UNAVAILABLE`。

## 持久 Job

v1.1 只有 core capability 能创建 Job；扩展不能注册任意 worker。使用
`jobs.get()`、`jobs.list()`、`jobs.subscribe()` 和 `jobs.cancel()`。Snapshot 与
单调事件会跨 renderer/runtime 重启持久化。订阅先从 cursor 重放，再交付 live event；
若 `replayGap` 为 true，应先用响应中的 snapshot 替换本地状态。

取消是幂等的，已完成 Job 保持原终态。Kun 重启时，结果未知的 FFmpeg Job 会变为
`interrupted`；必须显式新建渲染，不能假设半成品可以安全续跑。

## 生成制品

成功媒体 Job 发布顶层 `generatedArtifacts`。Artifact 包含持久不透明身份、
owner/workspace、媒体 handle、完成身份、MIME/大小、可用性以及 Job/调用来源，
不包含本地路径或 lease URL。工具结果只能引用调用者拥有且已完成的 artifact；Kun
会在写入历史前再次验证。缺失、替换或撤销后的文件明确投影为 `unavailable`。

Result-preview View 只收到 artifact 和 media-handle 引用，再申请新的 View lease，
而不是读取路径或 data URL。视频、音频和图片使用新 lease 预览；SRT/VTT 等非播放器
制品可由交互式 View 调用
`media.performArtifactAction({ artifactId, action: 'open' | 'reveal' })`。
请求不包含路径、owner、版本或 workspace 声明。Main 从已认证 View Session 派生这些
字段，重新校验 artifact 所有权、精确扩展版本、workspace、可用性和完成身份，再执行
桌面动作，且绝不向 View 返回路径。Headless、过期或跨扩展/跨 workspace 调用会失败关闭。

## 排错

- `MEDIA_INTERACTION_REQUIRED`：打开桌面 View 并完成受保护 picker。
- `MEDIA_PERMISSION_DENIED`：同时检查媒体权限和配套 workspace grant。
- `MEDIA_HANDLE_REVOKED` / `MEDIA_NOT_FOUND`：重新选择源或恢复缺失导出。
- `MEDIA_EXECUTABLE_UNAVAILABLE`：检查 Host FFmpeg/ffprobe 或配置的 override。H.264 与烧录字幕还要求 `libx264` 和 `drawtext`；macOS 会检查 keg-only Homebrew `ffmpeg-full` 的受审目录。
- `MEDIA_INVALID_ARGUMENT`：用精确具名 handle 占位符替换路径/URL。
- `MEDIA_LIMIT_EXCEEDED`：降低输出大小/并发，或调整用户控制的策略。
- Job `interrupted`：检查项目和目标后显式发起新渲染。
- 视频无法 seek：申请新 lease，并确认文件未被替换；不要复用过期 URL。

日志和诊断会刻意隐藏绝对路径、可复用 lease 凭据、环境与完整原生命令行。

## 分发、隐私与清理审查

- 首方示例源码使用随包 MIT 许可证；它不复制或分发 FFmpeg、codec、模型权重、
  素材库或第三方视频。以后若捆绑 FFmpeg，必须另做目标平台和 codec 许可审查。
- Probe、转录导入、时间线编辑和渲染默认在本地完成；不会隐式启用 cloud ASR 或
  生成服务，也不会在项目 state 中复制 provider secret。
- 输入 handle 只读；输入/输出 alias 检查和同目录 staging 防止改写源视频。项目操作
  保存 source range，而不是修改源文件字节。
- 失败、取消、超配额或中断的渲染会删除 staging 并释放 reservation。已完成导出与
  项目属于用户数据，卸载扩展不会删除；派生 cache 由显式清理流程管理。
- Audit 只记录不透明 handle/job/artifact 身份与有界结果，不记录受保护路径、operation
  token、lease 凭据、环境或无界原生输出。
- Node 扩展仍可在现有高风险信任披露下导入 `fs` 或 `child_process`。应优先使用媒体
  broker 获得最小权限，但不能把它描述成任意扩展代码的操作系统沙箱。
