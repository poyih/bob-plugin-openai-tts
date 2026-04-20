var supportedLanguageCodes = [
    'zh-Hans', 'zh-Hant', 'yue', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it',
    'ru', 'pt', 'pt-pt', 'pt-br', 'nl', 'pl', 'ar', 'hi', 'tr', 'vi',
    'th', 'id', 'ms', 'uk', 'cs', 'da', 'fi', 'el', 'he', 'hu',
    'no', 'ro', 'sk', 'sv', 'ta'
];

var MAX_TEXT_LENGTH = 4096;

function supportLanguages() {
    return supportedLanguageCodes.slice();
}

function isOpenRouterBaseUrl(base) {
    return /^https?:\/\/(?:[^\/]+\.)?openrouter\.ai(?:\/|$)/i.test(base);
}

function getModel() {
    var customModel = readOption('customModel');
    if (customModel) {
        return customModel;
    }

    var preset = readOption('model');
    return preset === 'custom' ? '' : preset;
}

function getApiUrl() {
    var base = readOption('apiUrl') || 'https://api.openai.com';
    base = base.replace(/\/+$/, '');
    if (/\/tts$/i.test(base)) {
        return base;
    }
    if (/\/audio\/speech$/i.test(base)) {
        return base;
    }
    if (isOpenRouterBaseUrl(base)) {
        if (/\/api\/v1$/i.test(base)) {
            return base + '/tts';
        }
        if (/\/api$/i.test(base)) {
            return base + '/v1/tts';
        }
        return base + '/api/v1/tts';
    }
    if (/\/v1$/i.test(base)) {
        return base + '/audio/speech';
    }
    return base + '/v1/audio/speech';
}

function isMiniTtsModel(model) {
    return !!model && model.indexOf('gpt-4o-mini-tts') !== -1;
}

function getVoice() {
    var model = getModel();
    return isMiniTtsModel(model) ? readOption('voiceMini') : readOption('voice');
}

function pluginValidate(completion) {
    var error = validateOptions();
    if (error) {
        completion({ error: error });
        return;
    }

    $http.request({
        method: 'POST',
        url: getApiUrl(),
        header: {
            Authorization: 'Bearer ' + readOption('apiKey'),
            'Content-Type': 'application/json'
        },
        body: {
            model: getModel(),
            input: 'hi',
            voice: getVoice(),
            response_format: 'mp3'
        },
        timeout: 15,
        handler: function(resp) {
            if (resp.error) {
                completion({ error: toServiceError(resp.error) });
                return;
            }
            if (resp.response && resp.response.statusCode >= 400) {
                completion({ error: parseHttpError(resp) });
                return;
            }
            completion({ result: true });
        }
    });
}

function tts(query, completion) {
    var validationError = validateOptions();
    if (validationError) {
        completion({ error: validationError });
        return;
    }

    if (!query || !query.text || !String(query.text).trim()) {
        completion({ error: { type: 'param', message: '待合成文本不能为空。' } });
        return;
    }

    var text = String(query.text).trim();
    if (text.length > MAX_TEXT_LENGTH) {
        completion({
            error: {
                type: 'param',
                message: '文本超出 ' + MAX_TEXT_LENGTH + ' 字符限制（当前 ' + text.length + ' 字符）。'
            }
        });
        return;
    }

    var model = getModel();
    var voice = getVoice();
    var speed = parseFloat(readOption('speed')) || 1.0;
    var format = readOption('responseFormat') || 'mp3';
    var instructions = readOption('instructions');

    var body = {
        model: model,
        input: text,
        voice: voice,
        response_format: format,
        speed: speed
    };
    if (instructions && isMiniTtsModel(model)) {
        body.instructions = instructions;
    }

    $http.request({
        method: 'POST',
        url: getApiUrl(),
        header: {
            Authorization: 'Bearer ' + readOption('apiKey'),
            'Content-Type': 'application/json'
        },
        body: body,
        timeout: 60,
        handler: function(resp) {
            if (resp.error) {
                completion({ error: toServiceError(resp.error) });
                return;
            }

            if (resp.response && resp.response.statusCode >= 400) {
                completion({ error: parseHttpError(resp) });
                return;
            }

            if (!resp.rawData) {
                completion({ error: { type: 'api', message: 'TTS 服务没有返回音频数据。' } });
                return;
            }

            var audioBase64 = resp.rawData.toBase64();
            if (!audioBase64) {
                completion({ error: { type: 'api', message: '音频数据转换失败。' } });
                return;
            }

            completion({
                result: {
                    type: 'base64',
                    value: audioBase64,
                    raw: {
                        model: model,
                        voice: voice,
                        format: format
                    }
                }
            });
        }
    });
}

function readOption(name) {
    var value = $option[name];
    return value == null ? '' : String(value).trim();
}

function validateOptions() {
    if (!readOption('apiKey')) {
        return { type: 'param', message: '请先在插件设置中填写 API Key。' };
    }
    if (!getModel()) {
        return { type: 'param', message: '请先填写 TTS 模型 ID。' };
    }
    if (!getVoice()) {
        return { type: 'param', message: '请先在插件设置中选择音色。' };
    }
    return null;
}

function parseHttpError(resp) {
    var statusCode = resp.response ? resp.response.statusCode : 0;
    var apiMessage = '';

    try {
        var body = resp.data;
        if (body && body.error && body.error.message) {
            apiMessage = body.error.message;
        }
    } catch (e) {}

    var context = '';
    if (statusCode === 401) {
        context = 'API Key 无效或已过期';
    } else if (statusCode === 429) {
        context = '请求过于频繁，请稍后再试';
    } else if (statusCode >= 500) {
        context = 'TTS 服务暂时不可用，请稍后再试';
    }

    var message = 'HTTP ' + statusCode;
    if (context) message += ' - ' + context;
    if (apiMessage) message += '\n' + apiMessage;

    return { type: 'api', message: message };
}

function toServiceError(error) {
    var message = '请求失败';
    if (error) {
        if (typeof error === 'string') {
            message = error;
        } else if (error.localizedDescription) {
            message = error.localizedDescription;
        } else if (error.message) {
            message = error.message;
        }
    }
    return { type: 'network', message: message };
}
