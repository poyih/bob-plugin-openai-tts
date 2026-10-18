// Bob entry points. Build with scripts/build.sh to include the helpers in src/.

var supportedLanguageCodes = [
    'zh-Hans', 'zh-Hant', 'yue', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it',
    'ru', 'pt', 'pt-pt', 'pt-br', 'nl', 'pl', 'ar', 'hi', 'tr', 'vi',
    'th', 'id', 'ms', 'uk', 'cs', 'da', 'fi', 'el', 'he', 'hu',
    'no', 'ro', 'sk', 'sv', 'ta', 'af', 'hy', 'az', 'be', 'bs',
    'bg', 'ca', 'hr', 'et', 'gl', 'is', 'kn', 'kk', 'lv', 'lt',
    'mk', 'mr', 'mi', 'ne', 'fa', 'sr', 'sl', 'sw', 'tl', 'ur', 'cy'
];

var MAX_TEXT_LENGTH = 4096;
var MAX_AUDIO_BYTES = 64 * 1024 * 1024;
var MAX_ERROR_SOURCE_CHARS = 8192;
var MAX_JSON_ERROR_BYTES = 64 * 1024;
var PLUGIN_TIMEOUT_INTERVAL = 120;
var VALIDATION_REQUEST_TIMEOUT_INTERVAL = 30;
var TTS_REQUEST_TIMEOUT_INTERVAL = 105;
var BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function supportLanguages() {
    return supportedLanguageCodes.slice();
}

function pluginTimeoutInterval() {
    return PLUGIN_TIMEOUT_INTERVAL;
}

function getConfiguredAudioFormat() {
    return isRealtimeTtsModel(getModel()) ? 'pcm' : clampFormat(readOption('responseFormat') || 'mp3');
}

function requestSpeech(text, timeout, completion) {
    if (isRealtimeTtsModel(getModel())) {
        return performRealtimeSpeechRequest(text, timeout, completion);
    }
    performAudioRequest({
        method: 'POST',
        url: getApiUrl(),
        header: {
            Authorization: 'Bearer ' + readOption('apiKey'),
            'Content-Type': 'application/json'
        },
        body: buildRequestBody(text),
        timeout: timeout
    }, getConfiguredAudioFormat(), completion);
}

function pluginValidate(completion) {
    var error = validateOptions() || validateInput('hi');
    if (error) {
        completion({ error: error });
        return;
    }

    requestSpeech('hi', VALIDATION_REQUEST_TIMEOUT_INTERVAL, function(result) {
        if (result.error) {
            completion({ error: result.error });
            return;
        }
        completion({ result: true });
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
    var inputError = validateInput(text);
    if (inputError) {
        completion({ error: inputError });
        return;
    }

    var model = getModel();
    var voice = getVoice();
    var format = getConfiguredAudioFormat();

    requestSpeech(text, TTS_REQUEST_TIMEOUT_INTERVAL, function(audioResult) {
        if (audioResult.error) {
            completion({ error: audioResult.error });
            return;
        }

        completion({
            result: {
                type: 'base64',
                value: audioResult.base64,
                raw: {
                    model: model,
                    voice: voice,
                    format: format === 'pcm' ? 'wav' : format,
                    sourceFormat: format
                }
            }
        });
    });
}
