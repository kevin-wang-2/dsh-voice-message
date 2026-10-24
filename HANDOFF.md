# dsh-voice-message 实现交接

> 2026-10-24 更新。目标宿主版本：DSH `0.2.1-rc.2`。
> 当前状态：方案已确认；端到端接口关卡及插件功能尚未验收。

## 1. 已确认目标与边界

提供真正的语音消息：保留原始录音，附带自动转写，在会话中显示为可回听语音条。它不是将识别文字填入草稿的语音输入法。

- v1 只使用公开插件接口：Cordis 注册、Client factory/slot、附件存储与上传、Speech Remote、正常消息提交。
- 不修改或 hack DSH core，不伪造会话事件，不 monkey-patch 私有实现。宿主暂不支持的能力明确标为不支持。
- 使用原生 `file` block 保存原音、独立 `text` block 保存转写和提示；不新增 `audio` block，不承诺原生音频模型投递。
- 原始音频保留；进入 ASR 前解码、重采样并生成规范 WAV，预处理只作用于副本。
- **插件完全不管 MMP 或其他音频分析插件**：不探测、不调用、不预检、不获取 digest，也不向消息写入具体工具或插件名。
- 用户显式发送，不自动发送；首版不提供转写校对，不做 TTS、流式字幕、唤醒词或波形。

## 2. 处理流程

```text
浏览器录音 → 原始音频 Blob
              ├─ 原始字节保留 → 用户发送时上传为 file 附件
              └─ 解码 → 16 kHz mono PCM16 WAV → Host 本地 ASR
                                          ↓
                        待发送录音 + 转写结果
                                          ↓ 用户显式发送
                  session/prompt [text, file receipt]
                                          ↓
                    持久化会话 → factory 包装 → 语音条
                                          ↓
                       授权回取原音 → 浏览器播放
```

“本地 ASR”指 Host 本地推理，浏览器到 Host 仍需网络。转写在提交前完成；不依赖发送后修改用户消息。

## 3. 宿主接口依据

以下来自目标版本安装包的类型和编译产物；接口存在不等于端到端验收通过。
路径相对于 DSH 安装目录内的 `node_modules/@deepseek-ai/`。

| 事实 | 源码或类型位置 | 实现含义 |
|---|---|---|
| FileAttachmentRef 包含 attachmentId、name、bytes，没有 mediaType | dsh-attachment/lib/types/types.d.ts | 格式信息需由插件契约携带 |
| 文件按原始字节保存，attachmentId 是内容摘要 | 同上；dsh-attachment/lib/types/index.d.ts | 可复用原音字节，不代表以后零迁移成本 |
| saveFile 契约没有文件 admission 大小限制 | dsh-attachment/lib/types/index.d.ts；lib/types/admission.js | 不套用图片 batch policy；Remote 和部署限制另测 |
| readFileStream(ref) 可读取原始文件，fileHostPath(ref) 可能返回宿主路径 | dsh-attachment/lib/types/index.d.ts | 插件音频回取的候选基础，仍需会话授权 |
| workspaceFiles.readBytes 支持二进制读取 | dsh-api-workspace-files/lib/types/index.d.ts | 路径映射和授权需验证，不能从 id 任意读文件 |
| session/attachment 当前只回图片 | dsh-api-session-controller/lib/types/types.d.ts | 不能直接用于音频 |
| fileUploads/upload 接受 base64 和 name，返回 receiptId 与 file ref | dsh-client-file-upload/lib/types/index.d.ts | receipt 绑定接收 Agent 的确切 Session |
| session/prompt 支持 text 与 {type:'file', receiptId} | dsh-api-session-controller/lib/types/types.d.ts | 正常用户消息提交，使用 queue 模式 |
| file 被投影为文本句柄和只读路径，不原生交给模型 | dsh-llm/lib/types/content.js 的 fileHandleText / projectFilesToText | 明确提示二进制，不声称模型已听到原音 |
| conversation.chat.user.content 是 factory，默认由 UserContent 渲染 | dsh-client-ui-chat/lib/types/client/contract/slots.d.ts；lib/client.js | 先验证公开包装能力，不当作可追加普通 slot |
| 输入活动条为 conversation.input.activity | dsh-client-ui-conversation/lib/client.js | 录音控制挂载候选 |
| Speech provider 接收 WAV；Remote 校验 16 kHz mono PCM16 | dsh-experimental-speech-to-text/lib/types/types.d.ts、wave.d.ts；dsh-experimental-api-speech-to-text/lib/index.js | WebM/MP4 不能直接送入 ASR |
| Transcript 包含 text、audioSeconds、inferenceSeconds，没有 confidence | dsh-experimental-speech-to-text/lib/types/types.d.ts | 不伪造置信度 |

## 4. 录音与转写

- 用 MediaRecorder.isTypeSupported 选择实际支持的录音格式；优先 WebM/Opus，Safari 可采用 MP4。文件扩展名与真实格式保持一致。
- 保存浏览器产出的原始录音，不以重采样 WAV 替换附件；编码目标值不得当作实际采样率或码率写入元数据。
- 参考原有 voice-input 的设备选择、权限处理、解码与重采样实现，但不导入其未导出的 Client 模块，不改造其 UI。
- 通过公开 Speech Remote 复用 Host 上现有 Speech 服务，不自建推理进程，也不为此强制加载原语音输入 UI。
- provider 未准备好时显示明确的准备引导；下载和启用操作由用户显式触发。
- 单条时长先按 120 秒；依据实际 Remote 返回的时长、字节上限核对预处理 WAV 是否可提交。
- 成功但空转写：允许发送，正文标为“无可用语音转写”。
- ASR 失败：保留录音供重试；允许用户显式选择仅发送原音，并标明“转写失败”，不得伪装为空转写。
- 支持取消；重录采用取消后重新录制。切会话、页面隐藏时终止录音并使迟到结果失效，释放轨道。

## 5. 消息契约

原音命名：voice-<UTC 紧凑时间>-<时长>s.<实际扩展名>。

text 在前，file 在后。首行 marker、音频格式、时长及文件关联方式应在 M0 固定，并有构造/解析往返测试。播放器用 marker 与对应附件共同识别语音消息，不仅凭扩展名猜测。

示意文本：

```text
[语音 12.4s · audio/webm · 74 KB · 自动转写]
<转写正文>

原始音频：voice-20261024T131900Z-12s.webm
以下为自动语音转写，可能存在误识别或遗漏，也不包含完整的语气及环境声音信息。
若转写含糊、疑似错误，或不足以完成任务，应主动使用当前可用的音频能力辅助理解原始录音。
若没有可用能力，应说明理解限制，不要臆测。原始音频为二进制文件，不要用 read 作为文本打开。
```

只有确实得到转写时才使用“自动转写”的状态文案；仅原音消息单独标识。稳定机器标记与可变状态的具体格式在 M0 确定。

## 6. UI 与存储

- 录音、转写、待发送、上传/提交和失败状态明确区分；点击停止不等于发送。
- 用户发送时上传原音，并通过 receipt 提交完整消息；核对 requestId 和 receipt 重试语义，避免重复消息或跨会话误发。
- 语音条提供播放/暂停、进度、时长、大小和转写展示，不重复显示原文件卡片。
- 通过公开接口包装 factory，普通消息委托原渲染器；卸载时应恢复原渲染，不干扰其他插件。
- 回听以持久化附件为来源；当前页面 Blob 缓存只能优化，不能代替刷新后的字节回取。
- 回取必须验证附件归属会话，不能只凭任意 attachmentId 或路径读文件。
- 原音随宿主会话附件保存，插件不另建定时清理机制；宿主删除、留存语义需实测并如实说明，不承诺永久保存。

## 7. 实现顺序与验收

| 阶段 | 工作 | 通过条件 |
|---|---|---|
| 0 | 初始化 Git 与 public GitHub 仓库，建立 main 与功能分支布局 | origin 正确，公开内容无环境配置，基线推送成功 |
| 前置关卡 | 真实音频上传/提交/回取，公开 factory 包装 | 刷新与切会话后仍可播放；语音可接管，普通消息委托正常 |
| M0 | 消息契约与插件 Host/Client 结构 | 构造解析测试通过；提示无具体音频工具或插件依赖 |
| M1 | 录音、预处理与本地转写 | 原音保留；有声/静音/环境声、取消与失败正确处理 |
| M2 | 显式发送与语音条 | 完整消息一次提交，刷新后回听，失败可重试，默认内容正常 |
| M3 | 完整功能验收 | 桌面 Chromium、Safari/WebKit 覆盖；实际手机结果单独报告 |

不再有 MMP 集成阶段。每阶段汇报已验证、未验证、设计偏差；接口无法满足时报告具体阻碍，不扩展到 core。

## 8. 待验证项

1. 同一 Session 的 upload receipt → prompt 的端到端行为；同名、重复提交、断线和重试。
2. Remote 传输、文件上传和部署层的真实大小限制；不要误用图片 admission 限制。
3. 持久化文件授权回取；刷新、切会话及宿主重启后的可回听性；会话删除与文件留存语义。
4. 公开 factory 包装/委托/卸载恢复；混合附件、普通消息、其他插件共存。
5. 本地 Speech provider 准备状态及无需加载旧语音输入 UI 的接入方式。
6. 10 秒、60 秒及上限录音的预处理、上传和 ASR 总时延；分别记录冷启动和已就绪状态，不预设统一三秒保证。
7. 桌面与手机浏览器的录音、解码和跨格式播放；权限拒绝、隐藏页面、切会话及取消。
8. 无其他音频分析插件时，本插件仍可录音、转写、发送、回听，消息无悬空工具引用。

## 9. v2 范围外

原生 audio block、模型音频能力声明、provider 音频序列化、历史迁移及 compaction 都属于另行设计的宿主能力，本项目不实现。
v1 可保留可复用的原始字节；未来能否复用为原生音频输入，要以宿主届时的公开契约为准。

DSH 上游：<https://github.com/deepseek-ai/deepseek-harness>。
