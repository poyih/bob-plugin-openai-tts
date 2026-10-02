// models: bundled with main.js for the Bob JavaScriptCore runtime.

function getModel() {
    var customModel = readOption('customModel');
    if (customModel) {
        return customModel;
    }

    var preset = readOption('model');
    return preset === 'custom' ? '' : preset;
}

function isMiniTtsModel(model) {
    return /^(?:openai\/)?gpt-4o-mini-tts(?:-\d{4}-\d{2}-\d{2})?$/.test(model || '');
}

function getVoice() {
    var customVoice = readOption('customVoice');
    if (customVoice) {
        return customVoice;
    }
    var model = getModel();
    return isMiniTtsModel(model) ? readOption('voiceMini') : readOption('voice');
}

function getVoiceForRequest(openRouter) {
    var voice = getVoice();
    if (!openRouter && readOption('customVoice') && /^voice_[a-z0-9_-]+$/i.test(voice)) {
        return { id: voice };
    }
    return voice;
}

function buildRequestBody(input) {
    var model = getModel();
    var openRouter = isUsingOpenRouter();
    var capabilities = getModelCapabilities(model);
    var instructions = readOption('instructions');
    var body = {
        model: model,
        input: input,
        voice: getVoiceForRequest(openRouter),
        response_format: clampFormat(readOption('responseFormat') || 'mp3')
    };
    if (capabilities.speed) body.speed = getConfiguredSpeed();
    if (instructions && capabilities.instructions) {
        if (openRouter) body.provider = { options: { openai: { instructions: instructions } } };
        else body.instructions = instructions;
    }
    return body;
}

function countCodePoints(value) {
    var count = 0;
    for (var i = 0; i < value.length; i++) {
        var first = value.charCodeAt(i);
        if (first >= 0xd800 && first <= 0xdbff && i + 1 < value.length) {
            var second = value.charCodeAt(i + 1);
            if (second >= 0xdc00 && second <= 0xdfff) i++;
        }
        count++;
    }
    return count;
}

function readOption(name) {
    var value = typeof $option === 'undefined' ? '' : $option[name];
    return value == null ? '' : String(value).trim();
}

function validateOptions() {
    if (!readOption('apiKey')) {
        return { type: 'secretKey', message: '请先在插件设置中填写 API Key。' };
    }
    if (!getModel()) {
        return { type: 'param', message: '请先填写 TTS 模型 ID。' };
    }
    if (!getVoice()) {
        return { type: 'param', message: '请先在插件设置中选择或填写音色。' };
    }

    var endpoint = resolveConfiguredEndpoint();
    if (endpoint.error) {
        return { type: 'param', message: endpoint.error };
    }
    if (endpoint.scheme !== 'https' && !endpoint.isLoopback && !isTrueOption('allowInsecureHttp')) {
        return {
            type: 'param',
            message: '为防止 API Key 和待合成文本泄露，非本机 API 地址必须使用 HTTPS。若服务确实只支持 HTTP，请显式开启“允许不安全 HTTP”。'
        };
    }
    var capabilities = getModelCapabilities(getModel());
    if (capabilities.speed) {
        var speed = getConfiguredSpeed();
        if (!isFinite(speed) || speed < capabilities.speed.minimum || speed > capabilities.speed.maximum) {
            return { type: 'param', message: '该模型的 Speed 必须在 ' + capabilities.speed.minimum + 'x 到 ' + capabilities.speed.maximum + 'x 之间。' };
        }
    }
    var format = readOption('responseFormat') || 'mp3';
    if (['mp3', 'aac', 'opus', 'flac', 'wav', 'pcm'].indexOf(format) === -1) {
        return { type: 'param', message: '请选择有效的音频格式。' };
    }
    return null;
}

function isTrueOption(name) {
    var value = readOption(name).toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
}

function getModelCapabilities(model) {
    var id = String(model || '').replace(/^openai\//, '');
    var capabilities = { maxCharacters: MAX_TEXT_LENGTH, maxTokens: 0, speed: null, instructions: false, pcm: null, formats: null };
    if (id === 'tts-1' || id === 'tts-1-hd') {
        capabilities.speed = { minimum: 0.25, maximum: 4.0 };
        capabilities.pcm = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
    } else if (isMiniTtsModel(model)) {
        capabilities.maxTokens = 2000;
        capabilities.instructions = true;
        capabilities.pcm = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
    } else if (isUsingOpenRouter() && /^microsoft\/mai-voice-2(?:\.1)?(?:-flash)?$/.test(model)) {
        capabilities.pcm = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
    }
    if (isUsingOpenRouter() && model === 'mistralai/voxtral-mini-tts-2603') capabilities.formats = ['mp3'];
    return capabilities;
}

function getConfiguredSpeed() {
    var value = readOption('speed');
    return value ? Number(value) : 1.0;
}

function validateInput(text) {
    var capabilities = getModelCapabilities(getModel());
    var textLength = countCodePoints(text);
    if (textLength > capabilities.maxCharacters) {
        return { type: 'param', message: '文本超出 ' + capabilities.maxCharacters + ' 字符限制（当前 ' + textLength + ' 字符），请按句或段落分段输入。' };
    }
    if (capabilities.maxTokens) {
        if (countCodePoints(readOption('instructions')) > 16384) return { type: 'param', message: 'Instructions 过长，请缩短后再试。' };
        try {
            var tokenCount = countInputTokens(text, capabilities.maxTokens);
            if (capabilities.instructions) tokenCount += countInputTokens(readOption('instructions'), capabilities.maxTokens);
            if (tokenCount > capabilities.maxTokens) {
                return { type: 'param', message: '文本与 Instructions 超出该模型的 ' + capabilities.maxTokens + ' token 输入预算，请缩短 Instructions，或按句、段落分段输入。' };
            }
        } catch (error) {
            return { type: 'param', message: '当前 Bob 环境无法检查此模型的输入长度，请更新 Bob 或改用 tts-1。' };
        }
    }
    return null;
}
