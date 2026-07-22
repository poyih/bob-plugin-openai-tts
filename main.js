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
var PLUGIN_TIMEOUT_INTERVAL = 120;
var VALIDATION_REQUEST_TIMEOUT_INTERVAL = 30;
var TTS_REQUEST_TIMEOUT_INTERVAL = 105;
var PCM_SAMPLE_RATE = 24000;
var PCM_CHANNELS = 1;
var PCM_BITS_PER_SAMPLE = 16;
var BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function supportLanguages() {
    return supportedLanguageCodes.slice();
}

function pluginTimeoutInterval() {
    return PLUGIN_TIMEOUT_INTERVAL;
}

function parseApiEndpoint(value) {
    var rawValue = value == null ? '' : String(value);
    if (!rawValue.trim()) {
        rawValue = 'https://api.openai.com';
    }

    if (/[\u0000-\u001f\u007f]/.test(rawValue)) {
        return { error: 'API 地址不能包含控制字符。' };
    }

    var base = rawValue.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
        base = 'https://' + base;
    }

    var match = /^(https?):\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(base);
    if (!match) {
        return { error: 'API 地址格式无效，仅支持 HTTP 或 HTTPS 地址。' };
    }
    if (match[5]) {
        return { error: 'API 地址不能包含片段（#fragment）。' };
    }

    var scheme = match[1].toLowerCase();
    var authority = match[2];
    var path = match[3] || '';
    var query = match[4] || '';

    if (authority.indexOf('@') !== -1) {
        return { error: 'API 地址不能包含用户名或密码。' };
    }
    if (/\s|\\/.test(authority) || /\s|\\/.test(path) || /\s/.test(query)) {
        return { error: 'API 地址不能包含空格或反斜杠。' };
    }
    if (path && path.charAt(0) !== '/') {
        return { error: 'API 地址路径格式无效。' };
    }

    var hostResult = parseAuthority(authority);
    if (hostResult.error) {
        return { error: hostResult.error };
    }

    var hostname = hostResult.hostname;
    var openRouter = hostname === 'openrouter.ai' || endsWith(hostname, '.openrouter.ai');
    var normalizedPath = normalizeApiPath(path, openRouter);
    var normalizedAuthority = hostResult.isIpv6 ? '[' + hostname + ']' : hostname;
    if (hostResult.port) {
        normalizedAuthority += ':' + hostResult.port;
    }

    return {
        url: scheme + '://' + normalizedAuthority + normalizedPath + query,
        scheme: scheme,
        hostname: hostname,
        port: hostResult.port,
        isLoopback: isLoopbackHostname(hostname),
        isOpenRouter: openRouter
    };
}

function parseAuthority(authority) {
    var hostname = '';
    var port = '';
    var isIpv6 = false;
    var match;

    if (authority.charAt(0) === '[') {
        match = /^\[([0-9a-f:.]+)\](?::([0-9]+))?$/i.exec(authority);
        if (!match) {
            return { error: 'API 地址中的 IPv6 主机或端口无效。' };
        }
        hostname = match[1].toLowerCase();
        port = match[2] || '';
        isIpv6 = true;
    } else {
        match = /^([^:]+)(?::([0-9]+))?$/.exec(authority);
        if (!match) {
            return { error: 'API 地址中的主机或端口无效。' };
        }
        hostname = match[1].toLowerCase();
        port = match[2] || '';
        if (!/^[a-z0-9.-]+$/i.test(hostname)) {
            return { error: 'API 地址中的主机名无效。' };
        }
    }

    hostname = hostname.replace(/\.+$/, '');
    if (!hostname || hostname.indexOf('..') !== -1 || hostname.charAt(0) === '.' || hostname.charAt(0) === '-') {
        return { error: 'API 地址中的主机名无效。' };
    }
    if (port) {
        var portNumber = parseInt(port, 10);
        if (portNumber < 1 || portNumber > 65535) {
            return { error: 'API 地址中的端口必须在 1 到 65535 之间。' };
        }
        port = String(portNumber);
    }

    return { hostname: hostname, port: port, isIpv6: isIpv6 };
}

function normalizeApiPath(path, openRouter) {
    var normalized = path || '';
    normalized = normalized.replace(/\/+$/, '');

    if (openRouter) {
        // OpenRouter 只有这一条 TTS 路径。把常见基地址、旧 /tts 地址和仿 OpenAI 的错误路径统一纠正。
        if (!normalized ||
            /^\/(?:api(?:\/v1)?|v1)$/i.test(normalized) ||
            /^\/(?:(?:api\/v1|v1)\/)?(?:audio(?:\/speech)?|tts)$/i.test(normalized)) {
            return '/api/v1/audio/speech';
        }
        return normalized + '/api/v1/audio/speech';
    }

    if (/\/audio\/speech$/i.test(normalized)) {
        return normalized;
    }
    if (/\/audio$/i.test(normalized)) {
        return normalized + '/speech';
    }

    // 对非 OpenRouter 的第三方服务保留显式 /tts 端点，避免破坏其自定义 API。
    if (/\/tts$/i.test(normalized)) {
        return normalized;
    }
    if (/\/v1$/i.test(normalized)) {
        return normalized + '/audio/speech';
    }
    if (!normalized) {
        return '/v1/audio/speech';
    }
    return normalized + '/v1/audio/speech';
}

function endsWith(value, suffix) {
    return value.slice(-suffix.length) === suffix;
}

function isLoopbackHostname(hostname) {
    if (hostname === 'localhost') {
        return true;
    }
    var ipv4Match = /^(127)\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.exec(hostname);
    if (ipv4Match) {
        for (var i = 1; i < ipv4Match.length; i++) {
            if (parseInt(ipv4Match[i], 10) > 255) return false;
        }
        return true;
    }
    return hostname === '::1' || hostname === '0:0:0:0:0:0:0:1';
}

function resolveConfiguredEndpoint() {
    var rawApiUrl = typeof $option === 'undefined' ? '' : $option.apiUrl;
    return parseApiEndpoint(rawApiUrl);
}

function isOpenRouterBaseUrl(base) {
    var endpoint = parseApiEndpoint(base);
    return !endpoint.error && endpoint.isOpenRouter;
}

function isUsingOpenRouter() {
    var endpoint = resolveConfiguredEndpoint();
    return !endpoint.error && endpoint.isOpenRouter;
}

function getApiUrl() {
    var endpoint = resolveConfiguredEndpoint();
    return endpoint.error ? '' : endpoint.url;
}

function clampFormat(format) {
    // OpenRouter 的音频端点仅接受 mp3 / pcm，其余格式自动回退到 mp3。
    if (isUsingOpenRouter() && format !== 'mp3' && format !== 'pcm') {
        return 'mp3';
    }
    return format;
}

function getModel() {
    var customModel = readOption('customModel');
    if (customModel) {
        return customModel;
    }

    var preset = readOption('model');
    return preset === 'custom' ? '' : preset;
}

function isMiniTtsModel(model) {
    return !!model && model.indexOf('gpt-4o-mini-tts') !== -1;
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
    var speedRaw = parseFloat(readOption('speed'));
    var speed = isNaN(speedRaw) ? 1.0 : speedRaw;
    var instructions = readOption('instructions');
    var body = {
        model: model,
        input: input,
        voice: getVoiceForRequest(openRouter),
        response_format: clampFormat(readOption('responseFormat') || 'mp3')
    };

    // speed 仅 tts-1 / tts-1-hd 支持；mini 模型的语速应通过 instructions 控制。
    if (!isMiniTtsModel(model)) {
        body.speed = speed;
    }
    if (instructions && isMiniTtsModel(model)) {
        if (openRouter) {
            body.provider = { options: { openai: { instructions: instructions } } };
        } else {
            body.instructions = instructions;
        }
    }
    return body;
}

function performAudioRequest(requestOptions, format, completion) {
    if (canUseStreamingAudioRequest()) {
        performStreamingAudioRequest(requestOptions, format, completion);
        return;
    }

    var finished = false;
    function finish(result) {
        if (finished) return;
        finished = true;
        completion(result);
    }
    requestOptions.handler = function(resp) {
        finish(processAudioResponse(resp, format));
    };
    try {
        $http.request(requestOptions);
    } catch (e) {
        finish({ error: toServiceError(e) });
    }
}

function canUseStreamingAudioRequest() {
    return typeof $http !== 'undefined' && $http && typeof $http.streamRequest === 'function' &&
        typeof $signal !== 'undefined' && $signal && typeof $signal.new === 'function' &&
        typeof $data !== 'undefined' && $data && typeof $data.fromData === 'function';
}

function performStreamingAudioRequest(requestOptions, format, completion) {
    var cancelSignal;
    try {
        cancelSignal = $signal.new();
    } catch (e) {
        completion({ error: toServiceError(e) });
        return;
    }
    if (!cancelSignal || typeof cancelSignal.send !== 'function') {
        completion({ error: { type: 'network', message: '当前 Bob 版本无法安全地接收流式音频。' } });
        return;
    }

    var bufferedData = null;
    var bufferedLength = 0;
    var streamedText = '';
    var streamedTextTruncated = false;
    var finished = false;

    function finish(result, shouldCancel) {
        if (finished) return;
        finished = true;
        if (shouldCancel) {
            try {
                cancelSignal.send();
            } catch (ignored) {}
        }
        completion(result);
    }

    requestOptions.cancelSignal = cancelSignal;
    requestOptions.streamHandler = function(stream) {
        if (finished || !stream) return;

        if (stream.text) {
            var textChunk = String(stream.text);
            var remaining = MAX_ERROR_SOURCE_CHARS - streamedText.length;
            if (remaining > 0) streamedText += textChunk.slice(0, remaining);
            if (textChunk.length > remaining) streamedTextTruncated = true;
        }

        var chunk = stream.rawData;
        if (!chunk) return;
        var chunkLength = getRawDataLength(chunk);
        if (chunkLength < 0) {
            finish({ error: { type: 'api', message: '无法确认流式音频数据大小，已停止接收。' } }, true);
            return;
        }
        if (bufferedLength + chunkLength > MAX_AUDIO_BYTES) {
            finish({ error: audioTooLargeError(bufferedLength + chunkLength) }, true);
            return;
        }
        if (chunkLength === 0) return;

        try {
            if (!bufferedData) {
                bufferedData = $data.fromData(chunk);
            } else if (typeof bufferedData.appendData === 'function') {
                var appendedData = bufferedData.appendData(chunk);
                if (appendedData && typeof appendedData.toBase64 === 'function') {
                    bufferedData = appendedData;
                }
            } else {
                throw new Error('appendData is unavailable');
            }
            if (!bufferedData) throw new Error('fromData returned no data');
            bufferedLength += chunkLength;
            var actualLength = getRawDataLength(bufferedData);
            if (actualLength !== bufferedLength) {
                finish({ error: { type: 'api', message: '流式音频数据长度不一致，已停止接收。' } }, true);
                return;
            }
        } catch (e) {
            finish({ error: { type: 'api', message: '流式音频数据拼接失败。' } }, true);
        }
    };
    requestOptions.handler = function(resp) {
        if (finished) return;
        var collectedText = streamedTextTruncated
            ? streamedText.slice(0, MAX_ERROR_SOURCE_CHARS - 1) + '…'
            : streamedText;
        var combinedResponse = {
            response: resp && resp.response,
            error: resp && resp.error,
            data: resp && resp.data != null ? resp.data : (collectedText || bufferedData),
            rawData: resp && resp.rawData ? resp.rawData : bufferedData,
            textTruncated: streamedTextTruncated
        };
        finish(processAudioResponse(combinedResponse, format), false);
    };

    try {
        $http.streamRequest(requestOptions);
    } catch (e) {
        finish({ error: toServiceError(e) }, true);
    }
}

function pluginValidate(completion) {
    var error = validateOptions();
    if (error) {
        completion({ error: error });
        return;
    }

    var format = clampFormat(readOption('responseFormat') || 'mp3');
    performAudioRequest({
        method: 'POST',
        url: getApiUrl(),
        header: {
            Authorization: 'Bearer ' + readOption('apiKey'),
            'Content-Type': 'application/json'
        },
        body: buildRequestBody('hi'),
        timeout: VALIDATION_REQUEST_TIMEOUT_INTERVAL
    }, format, function(result) {
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
    var textLength = countCodePoints(text);
    if (textLength > MAX_TEXT_LENGTH) {
        completion({
            error: {
                type: 'param',
                message: '文本超出 ' + MAX_TEXT_LENGTH + ' 字符限制（当前 ' + textLength + ' 字符）。'
            }
        });
        return;
    }

    var model = getModel();
    var voice = getVoice();
    var format = clampFormat(readOption('responseFormat') || 'mp3');

    performAudioRequest({
        method: 'POST',
        url: getApiUrl(),
        header: {
            Authorization: 'Bearer ' + readOption('apiKey'),
            'Content-Type': 'application/json'
        },
        body: buildRequestBody(text),
        timeout: TTS_REQUEST_TIMEOUT_INTERVAL
    }, format, function(audioResult) {
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

function processAudioResponse(resp, format) {
    if (!resp) {
        return { error: { type: 'network', message: 'TTS 服务没有返回响应。' } };
    }
    if (resp.error) {
        return { error: toServiceError(resp.error) };
    }

    var response = resp.response;
    var statusCode = response && typeof response.statusCode === 'number' ? response.statusCode : 0;
    if (!statusCode) {
        return { error: { type: 'network', message: 'TTS 服务响应状态无效。' } };
    }

    var expectedLength = getNumericLength(response.expectedContentLength);
    if (expectedLength > MAX_AUDIO_BYTES) {
        return { error: audioTooLargeError(expectedLength) };
    }
    if (statusCode === 204 || statusCode === 205) {
        return { error: { type: 'api', message: 'TTS 服务返回了空响应（HTTP ' + statusCode + '）。' } };
    }
    if (statusCode !== 200) {
        return { error: parseHttpError(resp) };
    }

    if (!resp.rawData) {
        return { error: { type: 'api', message: 'TTS 服务没有返回音频数据。' } };
    }
    var rawLength = getRawDataLength(resp.rawData);
    if (rawLength < 0) {
        return { error: { type: 'api', message: '无法确认音频数据大小，已拒绝该响应。' } };
    }
    if (rawLength === 0) {
        return { error: { type: 'api', message: 'TTS 服务返回的音频数据为空。' } };
    }
    if (rawLength > MAX_AUDIO_BYTES) {
        return { error: audioTooLargeError(rawLength) };
    }

    var rawPrefix = getRawDataPrefix(resp.rawData, 256);
    var rawBase64 = '';
    if (!rawPrefix.length) {
        try {
            rawBase64 = String(resp.rawData.toBase64() || '').replace(/\s+/g, '');
            rawPrefix = decodeBase64Prefix(rawBase64, 256);
        } catch (ignored) {}
    }

    var mimeType = getMimeType(response);
    var explicitPcm = format === 'pcm' && isPcmMimeType(mimeType);
    var rawIsWav = format === 'pcm' && !explicitPcm && isCompleteWavData(resp.rawData, rawLength);
    if (!isMimeTypeCompatibleWithFormat(mimeType, format, rawIsWav)) {
        return {
            error: invalidPayloadError(
                resp,
                'TTS 服务返回的内容类型与请求格式不一致（请求 ' + format + '，返回 ' + (mimeType || '未知类型') + '）。'
            )
        };
    }

    // 明确的 PCM MIME 可以跳过模糊文本启发式，避免把合法首样本误判成 JSON；
    // 已解析对象或完整 API 错误 JSON 仍会被拒绝。
    if (hasStructuredErrorPayload(resp, explicitPcm)) {
        return { error: invalidPayloadError(resp, 'TTS 服务返回了文本或 JSON，而不是音频。') };
    }

    var detectedFormat = explicitPcm ? '' : detectKnownAudioFormat(resp.rawData, rawPrefix, rawLength);
    if (format === 'pcm') {
        if (!rawIsWav && detectedFormat) {
            return {
                error: invalidPayloadError(
                    resp,
                    'TTS 服务没有返回原始 PCM，而是返回了 ' + detectedFormat + ' 数据。'
                )
            };
        }
        if (!rawIsWav && !explicitPcm && looksLikeMostlyPrintableText(rawPrefix)) {
            return { error: invalidPayloadError(resp, 'TTS 服务返回了文本，而不是 PCM 音频。') };
        }
    } else if (!hasExpectedAudioMagic(resp.rawData, rawPrefix, rawLength, format)) {
        return {
            error: invalidPayloadError(
                resp,
                'TTS 服务返回的数据不是有效的 ' + String(format).toUpperCase() + ' 音频。'
            )
        };
    }

    var audioBase64 = '';
    if (format === 'pcm' && !rawIsWav) {
        var wavResult = wrapPcmRawDataAsWav(resp.rawData, rawLength);
        if (wavResult.error) {
            return wavResult;
        }
        audioBase64 = wavResult.base64;
    } else {
        try {
            audioBase64 = rawBase64 || String(resp.rawData.toBase64() || '').replace(/\s+/g, '');
        } catch (e) {
            return { error: { type: 'api', message: '音频数据转换失败。' } };
        }
    }

    if (!audioBase64) {
        return { error: { type: 'api', message: '音频数据转换失败。' } };
    }
    var decodedLength = getBase64DecodedLength(audioBase64);
    if (decodedLength <= 0) {
        return { error: { type: 'api', message: 'TTS 服务返回的音频数据格式无效。' } };
    }
    var expectedDecodedLength = format === 'pcm' && !rawIsWav ? rawLength + 44 : rawLength;
    if (decodedLength !== expectedDecodedLength) {
        return { error: { type: 'api', message: '音频数据长度在转换过程中发生变化，已拒绝该响应。' } };
    }
    if (decodedLength > MAX_AUDIO_BYTES) {
        return { error: audioTooLargeError(decodedLength) };
    }

    return { base64: audioBase64 };
}

function getMimeType(response) {
    var value = response.MIMEType || response.mimeType || '';
    return String(value).split(';')[0].trim().toLowerCase();
}

function isAllowedAudioMimeType(mimeType) {
    return mimeType.indexOf('audio/') === 0 ||
        mimeType === 'application/ogg' ||
        mimeType === 'application/octet-stream' ||
        mimeType === 'binary/octet-stream' ||
        mimeType === 'application/binary';
}

function isGenericBinaryMimeType(mimeType) {
    return !mimeType || mimeType === 'application/octet-stream' ||
        mimeType === 'binary/octet-stream' || mimeType === 'application/binary';
}

function isPcmMimeType(mimeType) {
    return mimeType === 'audio/pcm' || mimeType === 'audio/x-pcm' ||
        mimeType === 'audio/raw';
}

function isWavMimeType(mimeType) {
    return mimeType === 'audio/wav' || mimeType === 'audio/wave' ||
        mimeType === 'audio/x-wav' || mimeType === 'audio/vnd.wave';
}

function isMimeTypeCompatibleWithFormat(mimeType, format, rawIsWav) {
    if (isGenericBinaryMimeType(mimeType)) return true;
    if (format === 'pcm') {
        return isPcmMimeType(mimeType) || (rawIsWav && isWavMimeType(mimeType));
    }
    if (format === 'mp3') {
        return mimeType === 'audio/mpeg' || mimeType === 'audio/mp3' || mimeType === 'audio/x-mp3';
    }
    if (format === 'aac') {
        return mimeType === 'audio/aac' || mimeType === 'audio/aacp' ||
            mimeType === 'audio/x-aac' || mimeType === 'audio/mp4';
    }
    if (format === 'opus') {
        return mimeType === 'audio/opus' || mimeType === 'audio/ogg' || mimeType === 'application/ogg';
    }
    if (format === 'flac') {
        return mimeType === 'audio/flac' || mimeType === 'audio/x-flac';
    }
    if (format === 'wav') return isWavMimeType(mimeType);
    return isAllowedAudioMimeType(mimeType);
}

function hasExpectedAudioMagic(rawData, prefix, totalLength, format) {
    var detected = detectKnownAudioFormat(rawData, prefix, totalLength);
    if (format === 'mp3') return detected === 'mp3';
    if (format === 'aac') return detected === 'aac' || detected === 'mp4';
    if (format === 'opus') return detected === 'opus';
    if (format === 'flac') return detected === 'flac';
    if (format === 'wav') return detected === 'wav';
    return !!detected;
}

function detectKnownAudioFormat(rawData, prefix, totalLength) {
    if (!prefix || !prefix.length || totalLength <= 0) return '';
    if (isCompleteWavData(rawData, totalLength)) return 'wav';
    if (isCompleteFlacData(rawData, prefix, totalLength)) return 'flac';
    if (isCompleteOggOpusData(rawData, prefix, totalLength)) return 'opus';
    if (isCompleteAacData(rawData, prefix, totalLength)) return 'aac';
    if (isCompleteMp4Data(rawData, prefix, totalLength)) return 'mp4';
    if (isCompleteMp3Data(rawData, prefix, totalLength)) return 'mp3';
    return '';
}

function matchesAscii(bytes, offset, value) {
    if (!bytes || bytes.length < offset + value.length) return false;
    for (var i = 0; i < value.length; i++) {
        if (bytes[offset + i] !== value.charCodeAt(i)) return false;
    }
    return true;
}

function readAudioBytes(rawData, prefix, offset, count) {
    var result = [];
    if (offset < 0 || count < 0) return result;
    if (prefix && offset + count <= prefix.length) {
        for (var i = 0; i < count; i++) result.push(prefix[offset + i]);
        return result;
    }
    if (!rawData || typeof rawData.readUInt8 !== 'function') return result;
    try {
        for (var j = 0; j < count; j++) result.push(rawData.readUInt8(offset + j));
    } catch (e) {
        return [];
    }
    return result;
}

function readUint16LEValue(bytes, offset) {
    return bytes[offset] + bytes[offset + 1] * 256;
}

function readUint16BEValue(bytes, offset) {
    return bytes[offset] * 256 + bytes[offset + 1];
}

function readUint24BEValue(bytes, offset) {
    return bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
}

function readUint32LEValue(bytes, offset) {
    return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216;
}

function readUint32BEValue(bytes, offset) {
    return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function isValidId3Header(header) {
    if (!header || header.length < 10 || !matchesAscii(header, 0, 'ID3')) return false;
    var majorVersion = header[3];
    if (majorVersion < 2 || majorVersion > 4 || header[4] === 0xff) return false;
    var allowedFlags = majorVersion === 2 ? 0xc0 : (majorVersion === 3 ? 0xe0 : 0xf0);
    if (header[5] & (255 ^ allowedFlags)) return false;
    // ID3v2 stores its tag size as four 7-bit synchsafe bytes.
    for (var i = 6; i < 10; i++) {
        if (header[i] > 0x7f) return false;
    }
    return true;
}

function getId3End(rawData, prefix, totalLength) {
    var header = readAudioBytes(rawData, prefix, 0, 10);
    if (!isValidId3Header(header)) return -1;
    var tagSize = header[6] * 2097152 + header[7] * 16384 + header[8] * 128 + header[9];
    var footerSize = header[3] === 4 && (header[5] & 0x10) ? 10 : 0;
    var end = 10 + tagSize + footerSize;
    return end <= totalLength ? end : -1;
}

function getMpegFrameLength(header) {
    if (!header || header.length < 4 || header[0] !== 0xff || (header[1] & 0xe0) !== 0xe0) return -1;
    var version = header[1] >>> 3 & 3;
    var layer = header[1] >>> 1 & 3;
    var bitrateIndex = header[2] >>> 4 & 15;
    var sampleRateIndex = header[2] >>> 2 & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 ||
        sampleRateIndex === 3 || (header[3] & 3) === 2) return -1;

    var mpeg1Layer1 = [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
    var mpeg1Layer2 = [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
    var mpeg1Layer3 = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    var mpeg2Layer1 = [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
    var mpeg2Layer23 = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    var sampleRates = version === 3 ? [44100, 48000, 32000] :
        (version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000]);
    var bitrateTable;
    if (version === 3) bitrateTable = layer === 3 ? mpeg1Layer1 : (layer === 2 ? mpeg1Layer2 : mpeg1Layer3);
    else bitrateTable = layer === 3 ? mpeg2Layer1 : mpeg2Layer23;
    var bitrate = bitrateTable[bitrateIndex - 1] * 1000;
    var sampleRate = sampleRates[sampleRateIndex];
    var padding = header[2] >>> 1 & 1;
    if (layer === 3) return Math.floor(12 * bitrate / sampleRate + padding) * 4;
    if (layer === 1 && version !== 3) return Math.floor(72 * bitrate / sampleRate + padding);
    return Math.floor(144 * bitrate / sampleRate + padding);
}

function isCompleteMpegFrameAt(rawData, prefix, totalLength, offset) {
    var header = readAudioBytes(rawData, prefix, offset, 4);
    var frameLength = getMpegFrameLength(header);
    return frameLength >= 8 && offset + frameLength <= totalLength;
}

function isCompleteMp3Data(rawData, prefix, totalLength) {
    var offset = getId3End(rawData, prefix, totalLength);
    if (offset < 0) offset = 0;
    return isCompleteMpegFrameAt(rawData, prefix, totalLength, offset);
}

function isCompleteAdtsFrameAt(rawData, prefix, totalLength, offset) {
    var header = readAudioBytes(rawData, prefix, offset, 7);
    if (header.length < 7 || header[0] !== 0xff || (header[1] & 0xf6) !== 0xf0) return false;
    var sampleRateIndex = header[2] >>> 2 & 15;
    if (sampleRateIndex >= 13) return false;
    var headerLength = header[1] & 1 ? 7 : 9;
    var frameLength = (header[3] & 3) * 2048 + header[4] * 8 + (header[5] >>> 5 & 7);
    return frameLength > headerLength && offset + frameLength <= totalLength;
}

function isCompleteAacData(rawData, prefix, totalLength) {
    var offset = getId3End(rawData, prefix, totalLength);
    if (offset < 0) offset = 0;
    return isCompleteAdtsFrameAt(rawData, prefix, totalLength, offset);
}

function readIsoBox(rawData, prefix, totalLength, offset) {
    var header = readAudioBytes(rawData, prefix, offset, 8);
    if (header.length < 8) return null;
    var size = readUint32BEValue(header, 0);
    var headerLength = 8;
    if (size === 1) {
        var extendedSize = readAudioBytes(rawData, prefix, offset + 8, 8);
        if (extendedSize.length < 8 || readUint32BEValue(extendedSize, 0) !== 0) return null;
        size = readUint32BEValue(extendedSize, 4);
        headerLength = 16;
    } else if (size === 0) {
        size = totalLength - offset;
    }
    if (size < headerLength || offset + size > totalLength) return null;
    return {
        type: String.fromCharCode(header[4], header[5], header[6], header[7]),
        size: size,
        headerLength: headerLength
    };
}

function isCompleteMp4Data(rawData, prefix, totalLength) {
    var offset = 0;
    var sawFtyp = false;
    for (var count = 0; count < 128 && offset < totalLength; count++) {
        var box = readIsoBox(rawData, prefix, totalLength, offset);
        if (!box) return false;
        if (offset === 0) {
            if (box.type !== 'ftyp' || box.size < 16) return false;
            sawFtyp = true;
        }
        if (sawFtyp && box.type === 'mdat' && box.size > box.headerLength) return true;
        offset += box.size;
    }
    return false;
}

function isCompleteWavData(rawData, totalLength) {
    if (totalLength < 46) return false;
    var header = readAudioBytes(rawData, null, 0, 12);
    if (header.length < 12 || !looksLikeWavBytes(header)) return false;
    var riffEnd = readUint32LEValue(header, 4) + 8;
    if (riffEnd !== totalLength) return false;

    var offset = 12;
    var sawFormat = false;
    var sawData = false;
    for (var count = 0; count < 128 && offset + 8 <= riffEnd; count++) {
        var chunkHeader = readAudioBytes(rawData, null, offset, 8);
        if (chunkHeader.length < 8) return false;
        var chunkId = String.fromCharCode(chunkHeader[0], chunkHeader[1], chunkHeader[2], chunkHeader[3]);
        var chunkLength = readUint32LEValue(chunkHeader, 4);
        var dataStart = offset + 8;
        var nextOffset = dataStart + chunkLength + (chunkLength & 1);
        if (nextOffset > riffEnd || nextOffset <= offset) return false;
        if (chunkId === 'fmt ') {
            if (chunkLength < 16) return false;
            var format = readAudioBytes(rawData, null, dataStart, 16);
            if (format.length < 16 || readUint16LEValue(format, 0) === 0 ||
                readUint16LEValue(format, 2) === 0 || readUint32LEValue(format, 4) === 0 ||
                readUint16LEValue(format, 12) === 0) return false;
            sawFormat = true;
        } else if (chunkId === 'data') {
            if (chunkLength === 0) return false;
            sawData = true;
        }
        offset = nextOffset;
    }
    return sawFormat && sawData && offset === riffEnd;
}

function calculateFlacCrc8(bytes, length) {
    var crc = 0;
    for (var i = 0; i < length; i++) {
        crc ^= bytes[i];
        for (var bit = 0; bit < 8; bit++) {
            crc = crc & 0x80 ? (crc << 1 ^ 0x07) & 255 : crc << 1 & 255;
        }
    }
    return crc;
}

function calculateFlacCrc16(bytes, length) {
    var crc = 0;
    for (var i = 0; i < length; i++) {
        crc ^= bytes[i] << 8;
        for (var bit = 0; bit < 8; bit++) {
            crc = crc & 0x8000 ? (crc << 1 ^ 0x8005) & 0xffff : crc << 1 & 0xffff;
        }
    }
    return crc;
}

function getUtf8IntegerLength(firstByte) {
    if (firstByte < 0x80) return 1;
    if ((firstByte & 0xe0) === 0xc0) return 2;
    if ((firstByte & 0xf0) === 0xe0) return 3;
    if ((firstByte & 0xf8) === 0xf0) return 4;
    if ((firstByte & 0xfc) === 0xf8) return 5;
    if ((firstByte & 0xfe) === 0xfc) return 6;
    if (firstByte === 0xfe) return 7;
    return -1;
}

function isPlausibleFlacFrame(rawData, prefix, totalLength, offset, streamSampleRate, streamChannels, streamBitsPerSample, streamTotalSamples) {
    var available = totalLength - offset;
    if (available < 12) return false;
    var header = readAudioBytes(rawData, prefix, offset, Math.min(32, available));
    if (header.length < 7 || header[0] !== 0xff || (header[1] & 0xfc) !== 0xf8 || (header[3] & 1)) return false;

    var blockSizeCode = header[2] >>> 4;
    var sampleRateCode = header[2] & 15;
    var channelAssignment = header[3] >>> 4;
    var sampleSizeCode = header[3] >>> 1 & 7;
    if (blockSizeCode === 0 || sampleRateCode === 15 || channelAssignment > 10 ||
        sampleSizeCode === 3 || sampleSizeCode === 7) return false;

    var cursor = 4;
    var numberLength = getUtf8IntegerLength(header[cursor]);
    if (numberLength < 1 || cursor + numberLength > header.length) return false;
    for (var utfIndex = 1; utfIndex < numberLength; utfIndex++) {
        if ((header[cursor + utfIndex] & 0xc0) !== 0x80) return false;
    }
    cursor += numberLength;

    var blockSize;
    if (blockSizeCode === 1) blockSize = 192;
    else if (blockSizeCode >= 2 && blockSizeCode <= 5) blockSize = 576 * Math.pow(2, blockSizeCode - 2);
    else if (blockSizeCode === 6) {
        if (cursor >= header.length) return false;
        blockSize = header[cursor++] + 1;
    } else if (blockSizeCode === 7) {
        if (cursor + 1 >= header.length) return false;
        blockSize = header[cursor] * 256 + header[cursor + 1] + 1;
        cursor += 2;
    } else blockSize = 256 * Math.pow(2, blockSizeCode - 8);
    if (blockSize <= 0) return false;

    var knownSampleRates = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
    var frameSampleRate = sampleRateCode < 12 ? (knownSampleRates[sampleRateCode] || streamSampleRate) : 0;
    if (sampleRateCode === 12) {
        if (cursor >= header.length) return false;
        frameSampleRate = header[cursor++] * 1000;
    } else if (sampleRateCode === 13 || sampleRateCode === 14) {
        if (cursor + 1 >= header.length) return false;
        frameSampleRate = header[cursor] * 256 + header[cursor + 1];
        if (sampleRateCode === 14) frameSampleRate *= 10;
        cursor += 2;
    }
    if (frameSampleRate !== streamSampleRate) return false;

    var frameChannels = channelAssignment <= 7 ? channelAssignment + 1 : 2;
    var knownSampleSizes = [0, 8, 12, 0, 16, 20, 24, 0];
    var frameBitsPerSample = knownSampleSizes[sampleSizeCode] || streamBitsPerSample;
    if (frameChannels !== streamChannels || frameBitsPerSample !== streamBitsPerSample || cursor >= header.length) return false;
    if (calculateFlacCrc8(header, cursor) !== header[cursor]) return false;

    var subframeOffset = offset + cursor + 1;
    var subframeHeader = readAudioBytes(rawData, prefix, subframeOffset, 1);
    if (subframeHeader.length !== 1 || (subframeHeader[0] & 0x80)) return false;
    var subframeType = subframeHeader[0] >>> 1 & 63;
    if ((subframeType >= 2 && subframeType <= 7) || (subframeType >= 13 && subframeType <= 31)) return false;
    var minimumSubframeBytes = streamChannels + 2;
    if (subframeType === 0) minimumSubframeBytes += Math.ceil(streamBitsPerSample / 8);
    else minimumSubframeBytes += 1;
    if (totalLength - subframeOffset < minimumSubframeBytes) return false;

    if (subframeType === 0 && !(subframeHeader[0] & 1) && streamChannels === 1 &&
        streamTotalSamples > 0 && streamTotalSamples <= blockSize) {
        var expectedFrameEnd = subframeOffset + 1 + Math.ceil(streamBitsPerSample / 8) + 2;
        if (expectedFrameEnd !== totalLength) return false;
        var frameBytes = readAudioBytes(rawData, prefix, offset, totalLength - offset);
        if (frameBytes.length !== totalLength - offset) return false;
        var storedCrc = frameBytes[frameBytes.length - 2] * 256 + frameBytes[frameBytes.length - 1];
        if (calculateFlacCrc16(frameBytes, frameBytes.length - 2) !== storedCrc) return false;
    }
    return true;
}

function isCompleteFlacData(rawData, prefix, totalLength) {
    if (totalLength < 52 || !matchesAscii(prefix, 0, 'fLaC')) return false;
    var offset = 4;
    var sawLastBlock = false;
    var streamSampleRate = 0;
    var streamChannels = 0;
    var streamBitsPerSample = 0;
    var streamTotalSamples = 0;
    for (var count = 0; count < 128 && offset + 4 <= totalLength; count++) {
        var blockHeader = readAudioBytes(rawData, prefix, offset, 4);
        if (blockHeader.length < 4) return false;
        var isLast = !!(blockHeader[0] & 0x80);
        var blockType = blockHeader[0] & 0x7f;
        var blockLength = readUint24BEValue(blockHeader, 1);
        if (count === 0) {
            if (blockType !== 0 || blockLength !== 34) return false;
            var streamInfo = readAudioBytes(rawData, prefix, offset + 4, 34);
            if (streamInfo.length !== 34) return false;
            var minimumBlockSize = readUint16BEValue(streamInfo, 0);
            var maximumBlockSize = readUint16BEValue(streamInfo, 2);
            streamSampleRate = streamInfo[10] * 4096 + streamInfo[11] * 16 + (streamInfo[12] >>> 4);
            streamChannels = (streamInfo[12] >>> 1 & 7) + 1;
            streamBitsPerSample = ((streamInfo[12] & 1) * 16 + (streamInfo[13] >>> 4)) + 1;
            streamTotalSamples = (streamInfo[13] & 15) * 4294967296 +
                streamInfo[14] * 16777216 + streamInfo[15] * 65536 + streamInfo[16] * 256 + streamInfo[17];
            if (minimumBlockSize < 16 || maximumBlockSize < minimumBlockSize ||
                streamSampleRate === 0 || streamBitsPerSample < 4 || streamBitsPerSample > 32) return false;
        }
        offset += 4 + blockLength;
        if (offset > totalLength) return false;
        if (isLast) {
            sawLastBlock = true;
            break;
        }
    }
    if (!sawLastBlock) return false;
    return isPlausibleFlacFrame(
        rawData,
        prefix,
        totalLength,
        offset,
        streamSampleRate,
        streamChannels,
        streamBitsPerSample,
        streamTotalSamples
    );
}

function isCompleteOggOpusData(rawData, prefix, totalLength) {
    var offset = 0;
    var sawHead = false;
    var sawTags = false;
    var packetLength = 0;
    var packetPrefix = [];
    for (var pageIndex = 0; pageIndex < 64 && offset < totalLength; pageIndex++) {
        var pageHeader = readAudioBytes(rawData, prefix, offset, 27);
        if (pageHeader.length < 27 || !matchesAscii(pageHeader, 0, 'OggS') || pageHeader[4] !== 0) return false;
        var isContinuation = !!(pageHeader[5] & 0x01);
        if ((packetLength > 0) !== isContinuation) return false;
        var segmentCount = pageHeader[26];
        if (segmentCount === 0) return false;
        var lacing = readAudioBytes(rawData, prefix, offset + 27, segmentCount);
        if (lacing.length !== segmentCount) return false;
        var bodyLength = 0;
        for (var i = 0; i < lacing.length; i++) bodyLength += lacing[i];
        var bodyStart = offset + 27 + segmentCount;
        var pageEnd = bodyStart + bodyLength;
        if (pageEnd > totalLength || pageEnd <= offset) return false;

        var bodyOffset = bodyStart;
        for (var segment = 0; segment < lacing.length; segment++) {
            var segmentLength = lacing[segment];
            var prefixBytesNeeded = Math.min(segmentLength, 19 - packetPrefix.length);
            if (prefixBytesNeeded > 0) {
                var prefixPart = readAudioBytes(rawData, prefix, bodyOffset, prefixBytesNeeded);
                if (prefixPart.length !== prefixBytesNeeded) return false;
                for (var partIndex = 0; partIndex < prefixPart.length; partIndex++) packetPrefix.push(prefixPart[partIndex]);
            }
            packetLength += segmentLength;
            bodyOffset += segmentLength;
            if (segmentLength < 255) {
                if (!sawHead) {
                    if (pageIndex !== 0 || !(pageHeader[5] & 0x02) || packetLength < 19 ||
                        !matchesAscii(packetPrefix, 0, 'OpusHead') || packetPrefix[8] === 0 || packetPrefix[9] === 0) {
                        return false;
                    }
                    sawHead = true;
                } else if (matchesAscii(packetPrefix, 0, 'OpusTags')) {
                    if (packetLength < 16) return false;
                    sawTags = true;
                } else if (sawTags && packetLength > 0 && !matchesAscii(packetPrefix, 0, 'OpusHead')) {
                    return true;
                }
                packetLength = 0;
                packetPrefix = [];
            }
        }
        offset = pageEnd;
    }
    return false;
}

function looksLikeMostlyPrintableText(prefix) {
    if (!prefix || prefix.length < 4) return false;
    var printable = 0;
    var inspected = Math.min(prefix.length, 256);
    for (var i = 0; i < inspected; i++) {
        var byte = prefix[i];
        if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
            printable++;
        }
    }
    return printable / inspected >= 0.85;
}

function hasStructuredErrorPayload(resp, allowPcmString) {
    if (resp.data == null) {
        return false;
    }
    if (isBinaryDataObject(resp.data)) {
        return false;
    }
    if (typeof resp.data === 'string') {
        if (allowPcmString) {
            return looksLikeCompleteApiErrorJson(resp.data, !!resp.textTruncated);
        }
        var mimeType = getMimeType(resp.response || {});
        if (mimeType && isAllowedAudioMimeType(mimeType)) {
            // PCM can occasionally be valid UTF-8 and begin with a JSON-looking byte.
            // For declared audio, inspect rawData below instead of trusting the decoded string.
            return false;
        }
        return looksLikeErrorText(resp.data);
    }
    return typeof resp.data === 'object';
}

function looksLikeCompleteApiErrorJson(value, wasTruncated) {
    var rawText = String(value == null ? '' : value);
    var sourceWasTruncated = wasTruncated || rawText.length > MAX_ERROR_SOURCE_CHARS;
    var text = limitErrorSource(rawText).trim();
    if (!text || (text.charAt(0) !== '{' && text.charAt(0) !== '[')) return false;
    if (sourceWasTruncated) return true;
    try {
        var parsed = JSON.parse(text);
        return !!parsed && typeof parsed === 'object';
    } catch (ignored) {
        return false;
    }
}

function isBinaryDataObject(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof $data !== 'undefined' && $data && typeof $data.isData === 'function') {
        try {
            if ($data.isData(value)) return true;
        } catch (ignored) {}
    }
    return typeof value.toBase64 === 'function' &&
        (typeof value.readUInt8 === 'function' || getRawDataLength(value) >= 0);
}

function getNumericLength(value) {
    var number = Number(value);
    return isFinite(number) && number >= 0 ? number : -1;
}

function getRawDataLength(rawData) {
    if (!rawData) return -1;
    var candidates = [rawData.length, rawData.byteLength];
    for (var i = 0; i < candidates.length; i++) {
        var length = getNumericLength(candidates[i]);
        if (length >= 0) return length;
    }
    return -1;
}

function getBase64DecodedLength(value) {
    if (!value || value.length % 4 !== 0 || /[^a-z0-9+/=]/i.test(value)) {
        return -1;
    }
    var padding = 0;
    if (value.charAt(value.length - 1) === '=') padding++;
    if (value.charAt(value.length - 2) === '=') padding++;
    if (value.slice(0, value.length - padding).indexOf('=') !== -1) {
        return -1;
    }
    return value.length / 4 * 3 - padding;
}

function looksLikeTextPayload(base64) {
    var prefix = decodeBase64Prefix(base64, 256);
    return looksLikeTextBytes(prefix);
}

function looksLikeTextBytes(prefix) {
    if (!prefix || !prefix.length) return false;
    var start = prefix.length >= 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf ? 3 : 0;
    var text = '';
    var printable = 0;
    var inspected = 0;
    for (var i = start; i < prefix.length && inspected < 256; i++) {
        var byte = prefix[i];
        inspected++;
        if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
            printable++;
        }
        text += String.fromCharCode(byte);
    }
    var trimmed = text.replace(/^\s+/, '').toLowerCase();
    if (/^\{\s*(?:"|\})/.test(trimmed) ||
        /^\[\s*(?:"|\{|\]|-?[0-9]|true|false|null)/.test(trimmed) ||
        /^<\/?(?:[a-z][a-z0-9:.-]*|!doctype|\?xml)(?:\s|>|\/|\?)/.test(trimmed) ||
        /^(?:unauthorized|forbidden|access denied|authentication failed|invalid api key|error\b|bad request\b|not found\b|rate limit|too many requests|internal server error|service unavailable|gateway timeout)/.test(trimmed)) {
        return true;
    }
    // 其余情况要求内容大部分可打印，避免把任意以“{”字节开头的原始 PCM 样本误判为 JSON。
    if (!inspected || printable / inspected < 0.85) return false;
    return looksLikeErrorText(trimmed);
}

function looksLikeErrorText(value) {
    var text = limitErrorSource(value || '').replace(/^\s+/, '').toLowerCase();
    if (text.length >= 3 && text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1).replace(/^\s+/, '');
    }
    return text.charAt(0) === '{' || text.charAt(0) === '[' ||
        /^<\/?(?:[a-z][a-z0-9:.-]*|!doctype|\?xml)(?:\s|>|\/|\?)/.test(text) ||
        /^(?:unauthorized|forbidden|access denied|authentication failed|invalid api key|error\b|bad request\b|not found\b|rate limit|too many requests|internal server error|service unavailable|gateway timeout)/.test(text);
}

function looksLikeWavBytes(prefix) {
    return prefix.length >= 12 &&
        prefix[0] === 82 && prefix[1] === 73 && prefix[2] === 70 && prefix[3] === 70 &&
        prefix[8] === 87 && prefix[9] === 65 && prefix[10] === 86 && prefix[11] === 69;
}

function getRawDataPrefix(rawData, maximumBytes) {
    var result = [];
    if (!rawData || typeof rawData.readUInt8 !== 'function') {
        return result;
    }
    var rawLength = getRawDataLength(rawData);
    var bytesToRead = rawLength >= 0 ? Math.min(rawLength, maximumBytes) : maximumBytes;
    try {
        for (var i = 0; i < bytesToRead; i++) {
            result.push(rawData.readUInt8(i));
        }
    } catch (e) {
        return [];
    }
    return result;
}

function decodeBase64Prefix(value, maximumBytes) {
    var charactersNeeded = Math.min(value.length, Math.ceil(maximumBytes / 3) * 4);
    charactersNeeded -= charactersNeeded % 4;
    if (!charactersNeeded && value.length >= 4) charactersNeeded = 4;
    var slice = value.slice(0, charactersNeeded);
    var result = [];
    var buffer = 0;
    var bits = 0;

    for (var i = 0; i < slice.length && result.length < maximumBytes; i++) {
        var character = slice.charAt(i);
        if (character === '=') break;
        var index = BASE64_ALPHABET.indexOf(character);
        if (index < 0) return [];
        buffer = buffer * 64 + index;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result.push(Math.floor(buffer / Math.pow(2, bits)) & 255);
            buffer = buffer % Math.pow(2, bits);
        }
    }
    return result;
}

function decodeBase64(value) {
    var outputLength = getBase64DecodedLength(value);
    if (outputLength < 0 || typeof Uint8Array === 'undefined') {
        return null;
    }
    var output = new Uint8Array(outputLength);
    var outputIndex = 0;
    var buffer = 0;
    var bits = 0;

    for (var i = 0; i < value.length; i++) {
        var character = value.charAt(i);
        if (character === '=') break;
        var index = BASE64_ALPHABET.indexOf(character);
        if (index < 0) return null;
        buffer = buffer * 64 + index;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (outputIndex < outputLength) {
                output[outputIndex++] = Math.floor(buffer / Math.pow(2, bits)) & 255;
            }
            buffer = buffer % Math.pow(2, bits);
        }
    }
    return outputIndex === outputLength ? output : null;
}

function encodeBase64(bytes) {
    var parts = [];
    var part = '';
    for (var i = 0; i < bytes.length; i += 3) {
        var first = bytes[i];
        var hasSecond = i + 1 < bytes.length;
        var hasThird = i + 2 < bytes.length;
        var second = hasSecond ? bytes[i + 1] : 0;
        var third = hasThird ? bytes[i + 2] : 0;
        var triplet = first * 65536 + second * 256 + third;

        part += BASE64_ALPHABET.charAt(Math.floor(triplet / 262144) & 63);
        part += BASE64_ALPHABET.charAt(Math.floor(triplet / 4096) & 63);
        part += hasSecond ? BASE64_ALPHABET.charAt(Math.floor(triplet / 64) & 63) : '=';
        part += hasThird ? BASE64_ALPHABET.charAt(triplet & 63) : '=';

        if (part.length >= 8192) {
            parts.push(part);
            part = '';
        }
    }
    if (part) parts.push(part);
    return parts.join('');
}

function wrapPcmBase64AsWav(pcmBase64) {
    var pcmBytes = decodeBase64(pcmBase64);
    if (!pcmBytes) {
        return { error: { type: 'api', message: 'PCM 音频数据解码失败。' } };
    }
    if (!pcmBytes.length || pcmBytes.length % 2 !== 0) {
        return { error: { type: 'api', message: 'PCM 音频数据长度无效（必须为 16 位采样）。' } };
    }
    if (pcmBytes.length + 44 > MAX_AUDIO_BYTES) {
        return { error: audioTooLargeError(pcmBytes.length + 44) };
    }
    if (typeof Uint8Array === 'undefined') {
        return { error: { type: 'api', message: '当前 Bob 版本无法包装 PCM 音频，请改用 MP3。' } };
    }

    var wavBytes = new Uint8Array(44 + pcmBytes.length);
    writeAscii(wavBytes, 0, 'RIFF');
    writeUint32LE(wavBytes, 4, 36 + pcmBytes.length);
    writeAscii(wavBytes, 8, 'WAVE');
    writeAscii(wavBytes, 12, 'fmt ');
    writeUint32LE(wavBytes, 16, 16);
    writeUint16LE(wavBytes, 20, 1);
    writeUint16LE(wavBytes, 22, PCM_CHANNELS);
    writeUint32LE(wavBytes, 24, PCM_SAMPLE_RATE);
    writeUint32LE(wavBytes, 28, PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE / 8);
    writeUint16LE(wavBytes, 32, PCM_CHANNELS * PCM_BITS_PER_SAMPLE / 8);
    writeUint16LE(wavBytes, 34, PCM_BITS_PER_SAMPLE);
    writeAscii(wavBytes, 36, 'data');
    writeUint32LE(wavBytes, 40, pcmBytes.length);
    if (typeof wavBytes.set === 'function') {
        wavBytes.set(pcmBytes, 44);
    } else {
        for (var i = 0; i < pcmBytes.length; i++) wavBytes[44 + i] = pcmBytes[i];
    }

    return { base64: encodeBase64(wavBytes) };
}

function wrapPcmRawDataAsWav(rawData, rawLength) {
    if (rawLength === 0 || rawLength > MAX_AUDIO_BYTES - 44) {
        return rawLength > 0
            ? { error: audioTooLargeError(rawLength + 44) }
            : { error: { type: 'api', message: 'PCM 音频数据为空。' } };
    }
    if (rawLength > 0 && rawLength % 2 !== 0) {
        return { error: { type: 'api', message: 'PCM 音频数据长度无效（必须为 16 位采样）。' } };
    }

    // Bob 的 $data 可原地拼接 NSData。主路径只创建 44 字节 WAV 头，避免把整段音频展开为 JS number 数组。
    if (rawLength > 0 && typeof $data !== 'undefined' && $data && typeof $data.fromByteArray === 'function') {
        try {
            var headerBytes = createWavHeader(rawLength);
            var wavData = $data.fromByteArray(headerBytes);
            if (wavData && typeof wavData.appendData === 'function') {
                var appendedData = wavData.appendData(rawData);
                if (appendedData && typeof appendedData.toBase64 === 'function') {
                    wavData = appendedData;
                }
                if (wavData && typeof wavData.toBase64 === 'function') {
                    var nativeBase64 = String(wavData.toBase64() || '').replace(/\s+/g, '');
                    if (getBase64DecodedLength(nativeBase64) === rawLength + 44) {
                        return { base64: nativeBase64 };
                    }
                }
            }
        } catch (ignored) {
            // 旧版 Bob 或测试环境没有完整 $data API 时，回退到纯 JavaScript 路径。
        }
    }

    var pcmBase64 = '';
    try {
        pcmBase64 = String(rawData.toBase64() || '').replace(/\s+/g, '');
    } catch (e) {
        return { error: { type: 'api', message: 'PCM 音频数据转换失败。' } };
    }
    return wrapPcmBase64AsWav(pcmBase64);
}

function createWavHeader(pcmByteLength) {
    var header = [];
    for (var i = 0; i < 44; i++) header.push(0);
    writeAscii(header, 0, 'RIFF');
    writeUint32LE(header, 4, 36 + pcmByteLength);
    writeAscii(header, 8, 'WAVE');
    writeAscii(header, 12, 'fmt ');
    writeUint32LE(header, 16, 16);
    writeUint16LE(header, 20, 1);
    writeUint16LE(header, 22, PCM_CHANNELS);
    writeUint32LE(header, 24, PCM_SAMPLE_RATE);
    writeUint32LE(header, 28, PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE / 8);
    writeUint16LE(header, 32, PCM_CHANNELS * PCM_BITS_PER_SAMPLE / 8);
    writeUint16LE(header, 34, PCM_BITS_PER_SAMPLE);
    writeAscii(header, 36, 'data');
    writeUint32LE(header, 40, pcmByteLength);
    return header;
}

function writeAscii(bytes, offset, value) {
    for (var i = 0; i < value.length; i++) {
        bytes[offset + i] = value.charCodeAt(i);
    }
}

function writeUint16LE(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = value >>> 8 & 255;
}

function writeUint32LE(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = value >>> 8 & 255;
    bytes[offset + 2] = value >>> 16 & 255;
    bytes[offset + 3] = value >>> 24 & 255;
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
    return null;
}

function isTrueOption(name) {
    var value = readOption(name).toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
}

function invalidPayloadError(resp, fallbackMessage) {
    var detail = extractApiMessage(resp);
    var message = fallbackMessage;
    if (detail) message += '\n' + detail;
    return { type: 'api', message: sanitizeMessage(message) };
}

function audioTooLargeError(byteLength) {
    var megabytes = Math.ceil(byteLength / 1024 / 1024);
    return {
        type: 'api',
        message: 'TTS 服务返回的音频过大（约 ' + megabytes + ' MB），已超过 64 MB 安全上限。'
    };
}

function parseHttpError(resp) {
    var statusCode = resp.response ? resp.response.statusCode : 0;
    var apiMessage = extractApiMessage(resp);
    var context = '';
    if (statusCode === 401 || statusCode === 403) {
        context = 'API Key 无效、已过期或无权访问该模型';
    } else if (statusCode === 429) {
        context = '请求过于频繁，请稍后再试';
    } else if (statusCode >= 500) {
        context = 'TTS 服务暂时不可用，请稍后再试';
    }

    var message = 'HTTP ' + statusCode;
    if (context) message += ' - ' + context;
    if (apiMessage) message += '\n' + apiMessage;
    return { type: 'network', message: sanitizeMessage(message) };
}

function extractApiMessage(resp) {
    var apiMessage = '';
    try {
        var body = resp ? resp.data : null;
        if (typeof body === 'string') {
            var bodyText = limitErrorSource(body);
            apiMessage = bodyText;
            var trimmed = bodyText.trim();
            if ((trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') && typeof JSON !== 'undefined') {
                try {
                    var parsed = JSON.parse(trimmed);
                    if (parsed && parsed.error && parsed.error.message) apiMessage = limitedErrorValue(parsed.error.message);
                    else if (parsed && parsed.message) apiMessage = limitedErrorValue(parsed.message);
                    else if (parsed && parsed.detail) apiMessage = limitedErrorValue(parsed.detail);
                } catch (ignored) {}
            }
        } else if (body && body.error && body.error.message) {
            apiMessage = limitedErrorValue(body.error.message);
        } else if (body && body.message) {
            apiMessage = limitedErrorValue(body.message);
        } else if (body && body.detail) {
            apiMessage = limitedErrorValue(body.detail);
        }
    } catch (e) {}
    return sanitizeMessage(apiMessage);
}

function limitedErrorValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return limitErrorSource(value);
    }
    if (value && typeof value.message === 'string') {
        return limitErrorSource(value.message);
    }
    return '';
}

function limitErrorSource(value) {
    var text = String(value == null ? '' : value);
    if (text.length > MAX_ERROR_SOURCE_CHARS) {
        return text.slice(0, MAX_ERROR_SOURCE_CHARS - 1) + '…';
    }
    return text;
}

function sanitizeMessage(value) {
    if (value == null) return '';
    var message = limitErrorSource(value);
    var apiKey = readOption('apiKey');
    if (apiKey) {
        message = redactConfiguredSecret(message, apiKey);
    }
    message = message.replace(/authorization\s*:\s*bearer\s+[^\s,;"']+/ig, '[REDACTED]');
    message = message.replace(/\bbearer\s+(?:\[redacted\]|[a-z0-9._~+\/=\-]{8,})/ig, '[REDACTED]');
    message = message.replace(/\bsk-[a-z0-9_-]{4,}\b/ig, '[REDACTED]');
    message = message.replace(/(https?:\/\/)[^\/@\s:]+:[^\/@\s]+@/ig, '$1[REDACTED]@');
    message = message.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ');
    message = message.replace(/ {2,}/g, ' ').trim();
    if (message.length > 500) {
        message = message.slice(0, 499) + '…';
    }
    return message;
}

function redactConfiguredSecret(message, secret) {
    message = replaceAllLiteral(message, secret, '[REDACTED]');
    if (secret.length < 12) return message;

    // The source is already capped. Redact a matching secret prefix as well so a key longer
    // than the cap cannot leak merely because its tail was truncated before exact replacement.
    var probe = secret.slice(0, 12);
    var searchOffset = 0;
    var matchOffset;
    while ((matchOffset = message.indexOf(probe, searchOffset)) !== -1) {
        var matchLength = probe.length;
        while (matchLength < secret.length && matchOffset + matchLength < message.length &&
            message.charAt(matchOffset + matchLength) === secret.charAt(matchLength)) {
            matchLength++;
        }
        var endOffset = matchOffset + matchLength;
        if (message.charAt(endOffset) === '…' && endOffset === message.length - 1) endOffset++;
        message = message.slice(0, matchOffset) + '[REDACTED]' + message.slice(endOffset);
        searchOffset = matchOffset + 10;
    }
    // A previous bounded collector may cut the key before the 12-character probe.
    // Redact a shorter matching prefix only when it is the visible tail of the message.
    var hasTruncationMarker = message.charAt(message.length - 1) === '…';
    var visibleEnd = hasTruncationMarker ? message.length - 1 : message.length;
    var minimumTailLength = hasTruncationMarker ? 1 : 4;
    for (var tailLength = Math.min(11, secret.length, visibleEnd); tailLength >= minimumTailLength; tailLength--) {
        if (message.slice(visibleEnd - tailLength, visibleEnd) === secret.slice(0, tailLength)) {
            message = message.slice(0, visibleEnd - tailLength) + '[REDACTED]';
            break;
        }
    }
    return message;
}

function replaceAllLiteral(value, search, replacement) {
    if (!search) return value;
    return value.split(search).join(replacement);
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
    return { type: 'network', message: sanitizeMessage(message) };
}
