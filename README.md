# Bob Plugin - OpenAI TTS

[Bob](https://bobtranslate.com/) 的 TTS 语音合成插件，兼容 OpenAI 和 OpenRouter，支持 `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts` 及其快照模型。

## 安装

1. 下载最新版本的 [openai-tts.bobplugin](https://github.com/poyih/bob-plugin-openai-tts/releases/latest)
2. 双击文件即可安装到 Bob

## 配置

在 Bob 的插件设置中填写以下信息：

| 选项 | 说明 |
| --- | --- |
| **API Key** | 你的 OpenAI 或 OpenRouter API 密钥 |
| **API URL** | 自定义 API 地址，用于代理或兼容服务（默认 `https://api.openai.com`） |
| **Model** | 常用 TTS 模型预设：`tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`（最新可控）、`gpt-4o-mini-tts-2025-12-15`（固定快照） |
| **Custom Model ID** | 可选。填写完整模型 ID 时，会覆盖上方预设，适合 OpenRouter 等兼容服务 |
| **Voice (tts-1 / tts-1-hd)** | 音色：alloy、echo、fable、onyx、nova、shimmer |
| **Voice (gpt-4o-mini-tts family)** | 音色：alloy、ash、ballad、cedar、coral、echo、fable、marin、onyx、nova、sage、shimmer、verse |
| **Speed** | 语速：0.5x ~ 2.0x（仅 `tts-1` / `tts-1-hd` 生效；`gpt-4o-mini-tts` 不支持 speed，请用 Instructions 控制语速） |
| **Audio Format** | 音频格式：MP3（默认）、AAC、OPUS、FLAC、WAV、PCM |
| **Instructions** | 控制语音风格、语气、情感（`gpt-4o-mini-tts` 系列模型支持） |

## OpenRouter 配置示例

如需使用 OpenRouter 上架的 `openai/gpt-4o-mini-tts-2025-12-15`：

| 选项 | 值 |
| --- | --- |
| **API Key** | 你的 OpenRouter API Key |
| **API URL** | `https://openrouter.ai`、`https://openrouter.ai/api`、`https://openrouter.ai/api/v1` 或完整 `https://openrouter.ai/api/v1/tts` |
| **Model** | `gpt-4o-mini-tts` 或任意预设 |
| **Custom Model ID** | `openai/gpt-4o-mini-tts-2025-12-15` |

## 注意事项

- 单次合成文本长度不能超过 4096 个字符。
- OpenAI 兼容地址会自动补全到 `/v1/audio/speech`；OpenRouter 地址会自动补全到 `/api/v1/tts`。
- API URL 支持填写完整地址（如 `https://your-proxy.com/v1/audio/speech` 或 `https://openrouter.ai/api/v1/tts`）、`/v1` 基地址，或仅填写域名；未带 `http(s)://` 协议时会自动补上 `https://`。
- `gpt-4o-mini-tts` 的快照模型和 OpenRouter 命名空间模型会自动复用同一套音色与 `Instructions` 逻辑。
- `gpt-4o-mini-tts` 不支持 `speed` 参数（传非 1.0 值会被 OpenAI 拒绝并返回 400），因此 Speed 选项仅对 `tts-1` / `tts-1-hd` 生效；mini-tts 系列请用 Instructions 控制语速。
- 需要 Bob 1.8.0 及以上版本，兼容最新的 Bob 1.20；`gpt-4o-mini-tts-2025-12-15` 为 OpenAI 当前最新的 TTS 快照模型。

## 支持的语言

中文（简/繁/粤）、英语、日语、韩语、法语、德语、西班牙语、意大利语、俄语、葡萄牙语、荷兰语、波兰语、阿拉伯语、印地语、土耳其语、越南语、泰语、印尼语、马来语、乌克兰语、捷克语、丹麦语、芬兰语、希腊语、希伯来语、匈牙利语、挪威语、罗马尼亚语、斯洛伐克语、瑞典语、泰米尔语

## 开发

插件由两个核心文件组成：

- `info.json` — 插件元信息与配置项定义
- `main.js` — TTS 调用逻辑

构建 `.bobplugin` 文件：

```bash
zip -j openai-tts.bobplugin info.json main.js
```

## License

MIT
