# Bob Plugin - OpenAI TTS

[Bob](https://bobtranslate.com/) 的语音合成插件，支持 OpenAI Realtime、OpenAI Speech、OpenRouter 和兼容服务。新安装默认使用 `gpt-realtime-2.1-mini`；保留 `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`、固定快照及自定义模型配置。

OpenAI 已公告 `tts-1`、`tts-1-hd` 和现有 mini-tts 快照将于 **2027-01-06** 停止服务，推荐迁移到 `gpt-realtime-2.1-mini`。1.6.0 已提供独立的 Realtime WebSocket 合成路径；已有保存配置不会自动切换，请按 [迁移说明](MIGRATION.md#openai-tts-迁移到-realtime160)更换模型并验证。[官方弃用公告](https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models)

## 安装

1. 从 [Releases](https://github.com/poyih/bob-plugin-openai-tts/releases/latest) 下载最新的 `.bobplugin` 文件。
2. 双击文件并在 Bob 中确认安装。

从 `0.3.2` 或更早版本升级时，请先阅读 [MIGRATION.md](MIGRATION.md)。旧版 identifier 与当前版本不同，Bob 无法通过同一个静态 appcast 自动跨 identifier 更新。

## 配置

在 Bob 的插件设置中填写：

| 选项 | 说明 |
| --- | --- |
| **API Key** | OpenAI、OpenRouter 或兼容服务的 API 密钥 |
| **API URL** | 默认 `https://api.openai.com`；支持域名、API 基地址、完整 Speech 端点或 Realtime WSS 地址 |
| **Allow insecure remote HTTP** | 默认关闭。显式开启后才允许远程 HTTP/WS，密钥和文本会以明文传输 |
| **Model** | 默认 `gpt-realtime-2.1-mini`，也可选 `gpt-realtime-2.1`、旧 Speech 模型或 Custom |
| **Custom Model ID** | 覆盖 Model 预设，适合 OpenRouter 命名空间模型和其他兼容服务 |
| **Voice** | 按 Realtime、mini-tts 和旧 tts-1 模型分别选择内置音色 |
| **Custom Voice ID** | 覆盖 Voice 预设；可填写 OpenAI `voice_...` ID，或兼容服务定义的音色字符串 |
| **Speed** | Realtime 支持 0.25x–1.5x；`tts-1` / `tts-1-hd` 支持 0.25x–4.0x。mini-tts 请用 Instructions 控制语速；未知模型省略此参数 |
| **Audio Format** | Speech 模型可选 MP3、AAC、OPUS、FLAC、WAV 或 PCM；Realtime 固定输出 WAV |
| **Instructions** | Realtime / mini-tts 的朗读风格、语气和情感，最多 4096 个 Unicode 字符 |

Realtime 可选 alloy、ash、ballad、cedar、coral、echo、marin、sage、shimmer、verse，推荐 marin 或 cedar。[官方会话配置](https://developers.openai.com/api/reference/resources/realtime/client-events)

`tts-1` / `tts-1-hd` 可选音色为 alloy、ash、coral、echo、fable、onyx、nova、sage、shimmer。`gpt-4o-mini-tts` 系列另支持 ballad、cedar、marin、verse；其中 marin 和 cedar 是 OpenAI 推荐音色。

OpenAI 自定义音色仅向符合条件的客户开放。非 OpenRouter 地址下，以 `voice_` 开头的自定义 ID 会按 OpenAI 要求作为 voice 对象发送；OpenRouter 地址下始终按 provider 定义的字符串发送，其他自定义值也保持字符串。

## API URL 规则

- Realtime 模型将默认地址转换为 `wss://api.openai.com/v1/realtime?model=...`。支持根地址、`/v1` 基地址、完整 `/v1/realtime` WSS 地址，或原有 `/v1/audio/speech` 地址；代理前缀与查询参数保留，旧 `model` 查询参数替换为当前模型。
- Speech 模型将 OpenAI 默认地址补全为 `https://api.openai.com/v1/audio/speech`。
- OpenRouter 的 `https://openrouter.ai`、`https://openrouter.ai/api`、`https://openrouter.ai/api/v1` 等基地址自动补全为 `https://openrouter.ai/api/v1/audio/speech`。
- 也可直接填写完整端点，例如 `https://your-proxy.example/v1/audio/speech`。
- 未填写协议时自动使用 `https://`；URL 的查询参数会保留在端点之后。
- 远程服务默认必须使用 HTTPS/WSS。本机 `localhost`、`127.0.0.0/8` 和 `[::1]` 可使用 HTTP/WS；其他远程明文地址必须显式开启危险选项。IPv4 回环地址必须使用完整四段写法。
- URL 中的用户信息、片段或控制字符会被拒绝，避免密钥误发或地址歧义。

## Realtime 语音合成

选择 `gpt-realtime-2.1-mini`，API URL 使用 `https://api.openai.com`，Voice (Realtime) 选择 marin，Speed 保持 1.0x。若 Custom Model ID 或 Custom Voice ID 留有旧值，请先清空；这些选项会覆盖模型和音色菜单。

插件通过 Bob 原生 `$websocket` 建立 OpenAI Realtime GA 会话，确认 PCM 输出配置后，以独立输入请求逐字朗读文本。只在完整成功的 `response.done` 后返回音频；取消、超时、异常或未完成响应会关闭连接并返回错误。音频使用 24 kHz、单声道、16 位小端 PCM，合并后封装为 WAV；此路径忽略 Audio Format 选项。[官方 WebSocket 指南](https://developers.openai.com/api/docs/guides/realtime-websocket)

Realtime 使用对话模型生成朗读，已通过指令限制其回答、翻译或改写输入。gpt-realtime-2 系列默认可能先说一段提示性语音（preamble，输出项标记为 `phase: "commentary"`）；插件在指令中禁止这类语音，并在 `response.done` 时丢弃其音频，只返回朗读内容。迁移时仍应在 Bob 中试听陈述、问题、命令及多语言文本，确认逐字朗读效果；本地协议模拟测试无法衡量模型实际发音与逐字准确性。代理必须转发 Realtime WebSocket 升级连接，普通 Speech HTTP 代理不足以支持该路径。OpenRouter 的 Speech 端点也不能直接使用 Realtime 模型。

## OpenRouter 示例

使用当前公开模型列表中的 `mistralai/voxtral-mini-tts-2603`：

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai` 或完整 `https://openrouter.ai/api/v1/audio/speech` |
| **Custom Model ID** | `mistralai/voxtral-mini-tts-2603` |
| **Custom Voice ID** | `en_paul_neutral` |
| **Audio Format** | MP3；插件对该模型保守固定为 MP3 |
| **Instructions** | 留空；该模型不使用此选项 |

模型和音色组合已根据 [OpenRouter 公开 TTS 模型列表](https://openrouter.ai/api/v1/models?output_modalities=speech)于 **2026-10-18** 核对。可用模型、音色和格式会变化，配置前请核对当前列表及[官方 TTS 文档](https://openrouter.ai/docs/guides/overview/multimodal/tts)。该列表当日未包含 OpenAI Speech 模型，旧的 `openai/gpt-4o-mini-tts-2025-12-15` 示例不应作为当前可用性保证。

若服务提供 mini-tts 模型，OpenRouter 下的 Instructions 仍通过 `provider.options.openai.instructions` 传递；直接 OpenAI 或兼容服务使用顶层 `instructions`。未知模型只发送必要参数，不会根据名称中包含某个片段就发送 `speed` 或 Instructions。

## 音频与错误处理

- OpenAI Speech 可返回 MP3、OPUS、AAC、FLAC、WAV 和 PCM；Realtime 固定返回 WAV；OpenRouter Speech 端点当前仅接受 MP3 和 PCM。
- 接受流式 WAV 的 RIFF/data `0xffffffff` 未知长度文件头，接收完成后按真实长度规范化。保留音频与元数据，并检查 WAV 结构、格式参数及完整 PCM 采样帧；非占位长度仍须与实际内容一致。
- AAC 响应必须使用常见的 ADTS 或 MP4/M4A 容器；少见的 ADIF 裸码流不在兼容范围内。
- PCM 会根据响应 `Content-Type` 中的 `rate`、`channels` 参数补上 WAV 文件头。支持 8000–384000 Hz、1–8 声道的 16-bit signed little-endian 采样，并检查完整采样帧。OpenAI TTS 和已知 OpenRouter MAI-Voice 模型在缺少参数时采用其文档中的 24 kHz、单声道默认值；其他模型缺少元数据时会提示改用 MP3。显式不支持的位深或字节序会被拒绝。
- 插件拒绝空响应、JSON/HTML 错误页、明显非音频内容、与请求格式不匹配的 MIME/文件头，以及超过 64 MB 安全上限的响应，不会把错误文本伪装成音频。
- 插件将单次文本限制为 4096 个 Unicode 字符，Realtime 与 mini-tts 的 Instructions 也单独限制为 4096 字符。mini-tts 另对文本与 Instructions 合计采用 **2000 token 的保守输入预算**，使用随插件打包的 `o200k_base` 词表离线计数；Realtime 不套用这个旧模型预算。超限时提示缩短或按句、段落分段输入。其他模型仍可能有自己的服务端上限。
- 错误识别读取合并后的原始字节，支持跨 UTF-8 字符分块；合法 PCM 不会仅因某个采样字节像 `{` 或文本被截断而被拒绝。结构化错误解析最多读取 64 KiB，显示信息继续受长度和脱敏限制。
- MP3 / ADTS AAC 检查所有帧边界，MP4/M4A 要求存在 AAC 音轨和媒体数据，Ogg Opus 检查页面顺序与结束标记。格式检查用于识别明显无效或截断的内容，不代替完整音频解码；开发测试中的真实样本会另行通过 FFmpeg 解码验证。
- 插件会从可见错误信息中清理 Bearer token、常见 API Key 形态和 HTTP(S)/WS(S) URL 用户信息；API Key 仍应只提供给可信的加密服务。

## 支持的语言

阿非利卡语、阿拉伯语、亚美尼亚语、阿塞拜疆语、白俄罗斯语、波斯尼亚语、保加利亚语、加泰罗尼亚语、中文（简/繁/粤）、克罗地亚语、捷克语、丹麦语、荷兰语、英语、爱沙尼亚语、芬兰语、法语、加利西亚语、德语、希腊语、希伯来语、印地语、匈牙利语、冰岛语、印尼语、意大利语、日语、卡纳达语、哈萨克语、韩语、拉脱维亚语、立陶宛语、马其顿语、马来语、马拉地语、毛利语、尼泊尔语、挪威语、波斯语、波兰语、葡萄牙语、罗马尼亚语、俄语、塞尔维亚语、斯洛伐克语、斯洛文尼亚语、西班牙语、斯瓦希里语、瑞典语、他加禄语、泰米尔语、泰语、土耳其语、乌克兰语、乌尔都语、越南语、威尔士语。

声音主要针对英语优化；其他语言的效果取决于文本、模型与音色。

## 使用提示

- 新安装默认使用 `gpt-realtime-2.1-mini`，可用 Instructions 控制朗读风格，Speed 范围为 0.25x–1.5x。
- `tts-1`、`tts-1-hd` 与 mini-tts 保留用于旧配置和兼容服务；OpenAI 的旧模型停服日期为 2027-01-06。
- 根据 OpenAI 的使用政策，应向最终用户明确披露听到的声音由 AI 生成，而非真人语音。
- 需要 Bob 1.8.0 或以上版本。

## 开发与验证

要求 Node.js 18 或以上版本。插件运行和常规测试不需要第三方 npm 包；离线词表固定在 `vendor/`，构建时检查 SHA-256，并附带其 MIT 许可证。本地打包另需系统提供 `zip` 和 `unzip`。独立的真实音频解码检查需要 FFmpeg。

```bash
npm test
npm run check
npm run build
npm run verify:appcast
npm run verify:audio # 需要 FFmpeg；可用 FFMPEG_BIN 指定路径
```

`main.js` 保留 Bob 入口与模型路由，`src/` 按地址解析、模型与输入检查、HTTP 传输、Realtime WebSocket、二进制、PCM、音频格式和错误处理组织代码。`scripts/bundle.js` 会将这些源码与离线词表合并；构建产物写入 `dist/`，包内仍只有 `info.json`、合并后的 `main.js` 和 `LICENSE`。调试或安装请使用构建后的脚本/安装包。

单元测试加载同一套合并源码，使用本地 HTTP/WebSocket 桩响应、真实音频样本、异步分块与故障场景，以及 tiktoken 0.12.0 生成的多语言计数样例，不调用真实语音 API，也不需要 API Key。回归测试覆盖未知长度 WAV、Instructions 字符与 token 边界、Realtime GA 握手、PCM 分片、commentary 语音过滤、超时、取消与单次回调。词表首次用于 mini 模型时才加载；其他模型不会建立 token 查询表。真实服务的账户权限、握手和试听需在 Bob 中另行验证，步骤见 [MIGRATION.md](MIGRATION.md#openai-tts-迁移到-realtime160)。

`verify:appcast` 会联网核对每个 GitHub Release 的真实发布时间、资产 URL、大小、SHA-256，以及包内的版本、identifier 与最低 Bob 版本。每次请求的 30 秒超时覆盖响应头和完整下载；临时网络错误、429、5xx 最多尝试 3 次，使用有限退避并遵守短时 Retry-After；404、鉴权失败和超大响应立即失败。下载按流读取并限制大小，不会先无界读取整个响应。

发布时必须保持 `identifier` 为 `bob-plugin-openai-tts`。这是现有安装所绑定的历史兼容键，也是 Bob 当前 identifier 规则的遗留例外，详见 [MIGRATION.md](MIGRATION.md)。当前 appcast 从采用此 identifier 的 `0.3.3` 开始；只有在 GitHub Release 资产实际上传后才可添加新版本。URL、SHA-256 和发布时间必须来自已发布资产，不应预填或猜测。

发布流程：先在 `main` 上把 `info.json` 与 `package.json` 提升到同一版本号并合并；然后推送附注标签 `vX.Y.Z`（标签说明会成为 Release 正文），`.github/workflows/release.yml` 会重新运行测试、确定性构建并创建带 `openai-tts-X.Y.Z.bobplugin` 资产的 GitHub Release；最后下载已上传的资产计算 SHA-256，用 Release 的实际发布时间补充 `appcast.json` 条目，运行 `npm run verify:appcast` 核对后再合并。

打标签时请加上 `--cleanup=verbatim`。Git 默认会把 `#` 开头的行当作注释删除，标签说明里的 Markdown 标题会因此丢失，Release 正文只剩下段落和列表：

```bash
git tag -a --cleanup=verbatim -F release-notes.md vX.Y.Z <commit>
git push origin vX.Y.Z
```

## License

[MIT](LICENSE)
