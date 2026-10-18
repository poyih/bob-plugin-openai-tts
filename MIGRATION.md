# Migration guide

## OpenAI TTS 迁移到 Realtime（1.6.0）

OpenAI 于 2026-10-01 公告 `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts-2025-03-20` 和 `gpt-4o-mini-tts-2025-12-15` 将于 **2027-01-06** 停服，推荐替代模型为 `gpt-realtime-2.1-mini`。mini-tts 模型页也已标记为弃用。升级插件后请提前迁移，避免停服当天无法合成。[官方弃用公告](https://developers.openai.com/api/docs/deprecations#2026-10-01-text-to-speech-models)

1. 安装 1.6.0 或以上版本，保留原 API Key，确认使用 Bob 1.8.0 或以上版本。
2. API URL 填写 `https://api.openai.com`。支持 Realtime 的代理可用其基地址、原 `/v1/audio/speech` 地址或完整 `wss://.../v1/realtime` 地址；代理需要支持 WebSocket 升级与 Authorization 请求头。
3. 将 Model 设为 `gpt-realtime-2.1-mini`，清空 Custom Model ID，避免旧值继续覆盖选择。
4. 在 Voice (Realtime) 选择 marin 或 cedar。原 Custom Voice ID 会继续覆盖音色菜单；如不再适用，请清空。自定义 OpenAI `voice_...` 仍需要账户具备相应权限。
5. Speed 选择 0.25x–1.5x，建议先用 1.0x。原 2.0x–4.0x 设置不适用于 Realtime，会在本地提示修改。
6. 如需 Instructions，仅填写语气、风格等朗读偏好，保持在 4096 个 Unicode 字符内。Realtime 固定输出 WAV，Audio Format 选项只用于原 Speech 路径。
7. 在 Bob 中执行插件验证，然后试听短陈述、问题、命令和日常使用的语言，确认发音、完整性与逐字朗读效果。Realtime 是对话模型，插件使用逐字朗读指令；离线协议测试不能验证真实模型输出质量。

新安装默认选择 Realtime，已有模型、音色和 API 配置不会被静默改写。插件每次只为当前文本建立一个独立会话，收到完整成功响应后返回 WAV 并关闭连接；失败不会自动换模型重试产生额外合成请求。

OpenRouter 用户继续使用其公开 Speech 模型和 `/api/v1/audio/speech` 接口，例如 `mistralai/voxtral-mini-tts-2603`，无需切换到 Realtime。兼容服务的模型生命周期以服务方公告为准，OpenAI 的停服日期不自动适用于其他供应商。

迁移依据：[OpenAI Realtime WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket)、[GA 会话与事件](https://developers.openai.com/api/docs/guides/realtime-conversations)、[Bob WebSocket API](https://bobtranslate.com/plugin/api/websocket.html)。本地测试覆盖协议与故障处理；上线前需使用有权限的真实账户完成 Bob 验证和试听。

## Identifier migration

## Who is affected

Version `0.3.2` used the Bob plugin identifier:

```text
com.poyih.bobplugin.openai.tts
```

Version `0.3.3` and every later release use:

```text
bob-plugin-openai-tts
```

Bob associates updates with the plugin identifier. The repository's static `appcast.json` can expose only one top-level identifier, so a feed for the current identifier cannot also update an installed `0.3.2` copy. The current feed therefore starts at `0.3.3`; older artifacts deliberately remain outside it because their identifiers are incompatible. This history cannot be repaired by changing the current identifier again; another rename would break updates for every current installation.

`bob-plugin-openai-tts` contains hyphens and is a legacy exception to Bob's current identifier schema. Existing installations are already bound to that value, so changing it in place would be more damaging than retaining it. A schema-compliant identifier could only be introduced as a separately named plugin with another explicit manual migration.

## Upgrade from 0.3.2 or earlier

1. Before changing anything, record the old plugin's API URL, model, voice, format and Instructions settings. Be prepared to enter the API Key again; secure fields may not migrate between identifiers.
2. Download the current `.bobplugin` file from [GitHub Releases](https://github.com/poyih/bob-plugin-openai-tts/releases/latest).
3. Double-click the downloaded file and install it in Bob. It may temporarily appear beside the legacy copy because Bob sees the identifiers as different plugins.
4. Configure the new **OpenAI TTS** entry and use Bob's validation action to verify it.
5. After successful synthesis, remove or disable the legacy copy to avoid selecting it by mistake.

Users already running `0.3.3` or later keep the current identifier and can use normal appcast updates.

## Maintainer guardrails

- Treat `bob-plugin-openai-tts` as immutable. Do not rename it for cosmetic or schema reasons.
- Keep the current appcast at `0.3.3` or later; never mix artifacts from a different identifier into the feed.
- Never add an appcast entry before its exact Release asset exists. Compute the SHA-256 from the uploaded `.bobplugin` file and use the actual GitHub `publishedAt` time.
- Keep the appcast's top-level identifier equal to `info.json`.
- Do not fabricate a second version entry as a workaround for the legacy identifier. Document the one-time manual migration instead.
