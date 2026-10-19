OpenAI TTS v1.7.0

### 修复

- Realtime 合成不再朗读模型自带的提示性语音（preamble）。gpt-realtime-2 系列默认可能先说一句开场白，插件现在会在 `response.done` 时丢弃标记为 `phase: "commentary"` 的音频，只返回朗读内容，并在朗读指令中明确禁止这类语音。
- 若 Realtime 只返回了提示性语音而没有朗读内容，会给出明确错误，不再把它当作朗读结果。
- 不提供 `item_id` 或 `phase` 字段的兼容服务，行为与 1.6.0 相同。

### 维护

- CI 与发布工作流改用 Node 24 版本的 actions/checkout v7.0.1、actions/setup-node v7.1.0 和 actions/upload-artifact v7.0.2，继续按完整 commit 固定，消除 Node 20 弃用警告。

### 验证与发布

- Node.js 18/22：81/81 项测试通过，新增 preamble 丢弃、仅有提示性语音和缺少 `item_id` 三类 Realtime 回归测试。
- 六种真实音频样本与规范化后的流式 WAV 通过 FFmpeg 严格解码；十一个历史发布资产核验通过。
- Realtime 真实账户试听仍需在 Bob 中验证，确认朗读开头没有多余的提示语，步骤见 MIGRATION.md。
- 构建产物为 `dist/openai-tts-1.7.0.bobplugin`。只有该资产实际上传为 GitHub Release 后，才按真实发布时间与下载哈希补充 appcast。
