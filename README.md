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
| **Speed** | 0.25x–4.0x，仅向 `tts-1` / `tts-1-hd` 发送并检查范围；mini-tts 系列请用 Instructions 控制语速，其他模型省略未确认支持的参数 |
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

使用当前公开模型列表中的 `mistralai/voxtral-mini-tts-2603`：

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai` 或完整 `https://openrouter.ai/api/v1/audio/speech` |
| **Custom Model ID** | `mistralai/voxtral-mini-tts-2603` |
| **Custom Voice ID** | `en_paul_neutral` |
| **Audio Format** | MP3；该模型不支持 PCM，选择其他格式时回退到 MP3 |
| **Instructions** | 留空；此选项只用于 mini-tts 系列 |

模型和音色组合已根据 [OpenRouter 公开 TTS 模型列表](https://openrouter.ai/api/v1/models?output_modalities=speech)于 **2026-10-02** 核对。可用模型、音色和格式会变化，配置前请核对当前列表及[官方 TTS 文档](https://openrouter.ai/docs/guides/overview/multimodal/tts)。该列表当日未包含 OpenAI Speech 模型，旧的 `openai/gpt-4o-mini-tts-2025-12-15` 示例不应作为当前可用性保证。

若服务提供 mini-tts 模型，OpenRouter 下的 Instructions 仍通过 `provider.options.openai.instructions` 传递；直接 OpenAI 或兼容服务使用顶层 `instructions`。未知模型只发送必要参数，不会根据名称中包含某个片段就发送 `speed` 或 Instructions。

## 音频与错误处理

- OpenAI 可返回 MP3、OPUS、AAC、FLAC、WAV 和 PCM；OpenRouter Speech 端点当前仅接受 MP3 和 PCM。
- AAC 响应必须使用常见的 ADTS 或 MP4/M4A 容器；少见的 ADIF 裸码流不在兼容范围内。
- PCM 会根据响应 `Content-Type` 中的 `rate`、`channels` 参数补上 WAV 文件头。支持 8000–384000 Hz、1–8 声道的 16-bit signed little-endian 采样，并检查完整采样帧。OpenAI TTS 和已知 OpenRouter MAI-Voice 模型在缺少参数时采用其文档中的 24 kHz、单声道默认值；其他模型缺少元数据时会提示改用 MP3。显式不支持的位深或字节序会被拒绝。
- 插件拒绝空响应、JSON/HTML 错误页、明显非音频内容、与请求格式不匹配的 MIME/文件头，以及超过 64 MB 安全上限的响应，不会把错误文本伪装成音频。
- 单次文本最多 4096 个 Unicode 字符。mini-tts 另对文本与 Instructions 合计采用 **2000 token 的保守输入预算**，使用随插件打包的 `o200k_base` 词表离线计数；超限时提示缩短或按句、段落分段输入。其他模型仍可能有自己的服务端上限，插件会把相关 400 错误转为明确的输入超限提示。
- 错误识别读取合并后的原始字节，支持跨 UTF-8 字符分块；合法 PCM 不会仅因某个采样字节像 `{` 或文本被截断而被拒绝。结构化错误解析最多读取 64 KiB，显示信息继续受长度和脱敏限制。
- MP3 / ADTS AAC 检查所有帧边界，MP4/M4A 要求存在 AAC 音轨和媒体数据，Ogg Opus 检查页面顺序与结束标记。格式检查用于识别明显无效或截断的内容，不代替完整音频解码；开发测试中的真实样本会另行通过 FFmpeg 解码验证。
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

要求 Node.js 18 或以上版本。插件运行和常规测试不需要第三方 npm 包；离线词表固定在 `vendor/`，构建时检查 SHA-256，并附带其 MIT 许可证。本地打包另需系统提供 `zip` 和 `unzip`。独立的真实音频解码检查需要 FFmpeg。

```bash
npm test
npm run check
npm run build
npm run verify:appcast
npm run verify:audio # 需要 FFmpeg；可用 FFMPEG_BIN 指定路径
```

`main.js` 只保留 Bob 入口，`src/` 按地址解析、模型与输入检查、传输、二进制、PCM、音频格式和错误处理组织代码。`scripts/bundle.js` 会将这些源码与离线词表合并；构建产物写入 `dist/`，包内仍只有 `info.json`、合并后的 `main.js` 和 `LICENSE`。调试或安装请使用构建后的脚本/安装包。

单元测试加载同一套合并源码，使用本地桩响应、真实音频样本、异步分块与故障场景，以及 tiktoken 0.12.0 生成的多语言计数样例，不调用真实语音 API，也不需要 API Key。词表首次用于 mini 模型时才加载；常规模型不会建立 token 查询表。

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
