# Bob Plugin - OpenAI TTS

[Bob](https://bobtranslate.com/) 的 TTS 语音合成插件，兼容 OpenAI、OpenRouter 和 OpenAI Speech API 兼容服务。支持 `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`、固定快照及自定义模型。

## 安装

1. 从 [Releases](https://github.com/poyih/bob-plugin-openai-tts/releases/latest) 下载最新的 `.bobplugin` 文件。
2. 双击文件并在 Bob 中确认安装。

从 `0.3.2` 或更早版本升级时，请先阅读 [MIGRATION.md](MIGRATION.md)。旧版 identifier 与当前版本不同，Bob 无法通过同一个静态 appcast 自动跨 identifier 更新。

## 配置

在 Bob 的插件设置中填写：

| 选项 | 说明 |
| --- | --- |
| **API Key** | OpenAI、OpenRouter 或兼容服务的 API 密钥 |
| **API URL** | 服务地址，默认 `https://api.openai.com`；可填写域名、API 基地址或完整 Speech 端点 |
| **Allow insecure remote HTTP** | 默认关闭。仅在明确接受密钥和文本明文传输风险时，允许连接远程 HTTP 服务 |
| **Model** | `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`、固定快照或 Custom |
| **Custom Model ID** | 覆盖 Model 预设，适合 OpenRouter 命名空间模型和其他兼容服务 |
| **Voice** | 按模型选择内置音色 |
| **Custom Voice ID** | 覆盖 Voice 预设；可填写 OpenAI `voice_...` ID，或兼容服务定义的音色字符串 |
| **Speed** | 0.5x–2.0x，仅对 `tts-1` / `tts-1-hd` 生效；mini-tts 系列请用 Instructions 控制语速 |
| **Audio Format** | MP3、AAC、OPUS、FLAC、WAV 或 PCM |
| **Instructions** | 控制 mini-tts 系列的风格、语气、情感和语速 |

`tts-1` / `tts-1-hd` 可选音色为 alloy、ash、coral、echo、fable、onyx、nova、sage、shimmer。`gpt-4o-mini-tts` 系列另支持 ballad、cedar、marin、verse；其中 marin 和 cedar 是 OpenAI 推荐音色。

OpenAI 自定义音色仅向符合条件的客户开放。非 OpenRouter 地址下，以 `voice_` 开头的自定义 ID 会按 OpenAI 要求作为 voice 对象发送；OpenRouter 地址下始终按 provider 定义的字符串发送，其他自定义值也保持字符串。

## API URL 规则

- OpenAI 默认地址自动补全为 `https://api.openai.com/v1/audio/speech`。
- OpenRouter 的 `https://openrouter.ai`、`https://openrouter.ai/api`、`https://openrouter.ai/api/v1` 等基地址自动补全为 `https://openrouter.ai/api/v1/audio/speech`。
- 也可直接填写完整端点，例如 `https://your-proxy.example/v1/audio/speech`。
- 未填写协议时自动使用 `https://`；URL 的查询参数会保留在端点之后。
- 出于密钥安全考虑，远程服务默认必须使用 HTTPS。本机 `localhost`、`127.0.0.0/8` 和 `[::1]` 可使用 HTTP；其他远程 HTTP 地址必须显式开启危险选项。IPv4 回环地址必须使用完整四段写法。
- URL 中的用户信息、片段或控制字符会被拒绝，避免密钥误发或地址歧义。

## OpenRouter 示例

使用 OpenRouter 上的 `openai/gpt-4o-mini-tts-2025-12-15`：

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai` 或完整 `https://openrouter.ai/api/v1/audio/speech` |
| **Custom Model ID** | `openai/gpt-4o-mini-tts-2025-12-15` |
| **Audio Format** | MP3 或 PCM；选择其他格式时自动回退到 MP3 |
| **Instructions** | 以 `provider.options.openai.instructions` 传给 OpenAI provider |

OpenRouter 的可用模型和音色会随 provider 变化。需要非 OpenAI 音色时，在 **Custom Voice ID** 中填写模型页面列出的字符串。

## 音频与错误处理

- OpenAI 可返回 MP3、OPUS、AAC、FLAC、WAV 和 PCM；OpenRouter Speech 端点当前仅接受 MP3 和 PCM。
- AAC 响应必须使用常见的 ADTS 或 MP4/M4A 容器；少见的 ADIF 裸码流不在兼容范围内。
- API 返回的 PCM 是无文件头的 24 kHz、单声道、16-bit signed little-endian 采样。插件会补上 WAV 文件头再交给 Bob，避免将裸 PCM 当作普通音频文件播放。
- 插件拒绝空响应、JSON/HTML 错误页、明显非音频内容、与请求格式不匹配的 MIME/文件头，以及超过 64 MB 安全上限的响应，不会把错误文本伪装成音频。
- 单次输入最多 4096 个 Unicode 字符。
- 插件会从可见错误信息中清理 Bearer token、常见 API Key 形态和 URL 用户信息；API Key 仍应只提供给可信的 HTTPS 服务。

## 支持的语言

阿非利卡语、阿拉伯语、亚美尼亚语、阿塞拜疆语、白俄罗斯语、波斯尼亚语、保加利亚语、加泰罗尼亚语、中文（简/繁/粤）、克罗地亚语、捷克语、丹麦语、荷兰语、英语、爱沙尼亚语、芬兰语、法语、加利西亚语、德语、希腊语、希伯来语、印地语、匈牙利语、冰岛语、印尼语、意大利语、日语、卡纳达语、哈萨克语、韩语、拉脱维亚语、立陶宛语、马其顿语、马来语、马拉地语、毛利语、尼泊尔语、挪威语、波斯语、波兰语、葡萄牙语、罗马尼亚语、俄语、塞尔维亚语、斯洛伐克语、斯洛文尼亚语、西班牙语、斯瓦希里语、瑞典语、他加禄语、泰米尔语、泰语、土耳其语、乌克兰语、乌尔都语、越南语、威尔士语。

声音主要针对英语优化；其他语言的效果取决于文本、模型与音色。

## 使用提示

- `gpt-4o-mini-tts` 是 OpenAI 当前最新且最可靠的 TTS 模型，可用 Instructions 控制口音、情感、语调、语速、语气和耳语等特征。
- `tts-1` 更重视低延迟，`tts-1-hd` 更重视质量。
- 根据 OpenAI 的使用政策，应向最终用户明确披露听到的声音由 AI 生成，而非真人语音。
- 需要 Bob 1.8.0 或以上版本。

## 开发与验证

要求 Node.js 18 或以上版本。仓库不依赖第三方运行时包；本地打包另需系统提供 `zip` 和 `unzip`。

```bash
npm test
npm run check
npm run build
npm run verify:appcast
```

构建产物写入 `dist/`，只包含 Bob 插件运行所需的 `info.json`、`main.js` 以及 `LICENSE`。单元测试使用本地桩响应，不会调用真实 API，也不需要 API Key；`verify:appcast` 会联网核对每个 GitHub Release 的真实发布时间、资产 URL、大小、SHA-256，以及包内的版本、identifier 与最低 Bob 版本。

发布时必须保持 `identifier` 为 `bob-plugin-openai-tts`。这是现有安装所绑定的历史兼容键，也是 Bob 当前 identifier 规则的遗留例外，详见 [MIGRATION.md](MIGRATION.md)。当前 appcast 从采用此 identifier 的 `0.3.3` 开始；只有在 GitHub Release 资产实际上传后才可添加新版本。URL、SHA-256 和发布时间必须来自已发布资产，不应预填或猜测。

## License

[MIT](LICENSE)
