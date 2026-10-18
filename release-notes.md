OpenAI TTS v1.6.0

### 新增 Realtime 合成

- 接入 OpenAI Realtime GA WebSocket，支持 `gpt-realtime-2.1-mini` 和 `gpt-realtime-2.1`，输出 24 kHz 单声道 WAV。
- 新安装默认使用 `gpt-realtime-2.1-mini`；保留已有保存配置和旧模型 ID。新增 Realtime 音色选择，Speed 支持 0.25x–1.5x。
- OpenAI 已公告旧 TTS 模型于 2027-01-06 停服，增加弃用提示和具体迁移、验证步骤。
- 支持代理前缀、原 Speech 地址与完整 WSS 端点，保留查询选项；超时、取消、异常与未完成响应均关闭连接并只回调一次。

### 修复

- 接受流式 WAV 的 RIFF/data 未知长度文件头，接收完成后按实际长度修复，保留元数据及音频字节，同时检查完整 PCM 采样帧。
- Instructions 单独限制为 4096 个 Unicode 字符，mini-tts 继续检查合计 2000 token 的保守输入预算。
- WebSocket 错误 URL 中的用户凭据纳入脱敏。

### 验证与发布

- 覆盖 WAV、Instructions 和 Realtime 协议及故障场景的离线回归测试；六种真实音频样本与规范化后的流式 WAV 通过 FFmpeg 严格解码。
- Realtime 真实账户握手和发音、逐字朗读效果仍需在 Bob 中验证，步骤见 MIGRATION.md。
- 构建产物为 `dist/openai-tts-1.6.0.bobplugin`。只有该资产实际上传为 GitHub Release 后，才按真实发布时间与下载哈希补充 appcast。
