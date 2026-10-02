// errors: bundled with main.js for the Bob JavaScriptCore runtime.

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

function hasStructuredErrorPayload(resp, pcmRequested) {
    var data = resp.data;
    if (data && typeof data === 'object' && !isBinaryDataObject(data)) {
        return !pcmRequested || isApiErrorObject(data);
    }
    // Declared compressed audio is validated by its container/frame structure. Avoid
    // copying an additional text prefix from every successful audio response.
    var mimeType = getMimeType(resp.response || {});
    if (!pcmRequested && mimeType && isAllowedAudioMimeType(mimeType)) return false;
    if (pcmRequested && resp.rawData && typeof resp.rawData.readUInt8 === 'function') {
        var preview = decodeUtf8Bytes(getRawDataPrefix(resp.rawData, 64), true).trim();
        if (!preview || (preview.charAt(0) !== '{' && preview.charAt(0) !== '[')) return false;
    }
    var source = readResponseText(resp, MAX_JSON_ERROR_BYTES);
    if (!source.text) return false;
    if (pcmRequested) return looksLikeCompleteApiErrorJson(source.text, source.truncated);
    return looksLikeErrorText(source.text);
}

function looksLikeCompleteApiErrorJson(value, wasTruncated) {
    var text = String(value || '').trim();
    if (!text || (text.charAt(0) !== '{' && text.charAt(0) !== '[')) return false;
    if (wasTruncated) {
        // A lone JSON-looking PCM sample is not evidence of an API error. An oversized
        // error must have an explicit error envelope and contain only valid JSON text.
        return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) &&
            /^\{\s*"errors?"\s*:\s*(?:\{|\[|"|null\b)/.test(text);
    }
    try {
        return isApiErrorObject(JSON.parse(text));
    } catch (ignored) {
        return false;
    }
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
    if (statusCode === 400 && /(?:token|context|input|text).*(?:limit|long|maximum|exceed)|(?:limit|maximum).*(?:token|input|text)/i.test(apiMessage)) {
        return { type: 'param', message: sanitizeMessage('文本或 Instructions 超出模型输入限制，请按句或段落分段输入。 ' + apiMessage) };
    }
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
        if (isBinaryDataObject(body) || body == null) body = readResponseText(resp, MAX_JSON_ERROR_BYTES).text;
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

function isApiErrorObject(value, depth) {
    depth = depth || 0;
    if (depth > 8) return false;
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) if (isApiErrorObject(value[i], depth + 1)) return true;
        return false;
    }
    return value.error != null || value.errors != null || typeof value.message === 'string' || typeof value.detail === 'string';
}

function readResponseText(resp, maximumBytes) {
    var raw = resp && resp.rawData;
    var length = getRawDataLength(raw);
    if (raw && length >= 0) {
        var truncated = length > maximumBytes;
        var prefix = getRawDataPrefix(raw, Math.min(length, maximumBytes));
        if (prefix.length) return { text: decodeUtf8Bytes(prefix, truncated), truncated: truncated };
    }
    var value = resp && typeof resp.data === 'string' ? resp.data : '';
    return { text: value.slice(0, maximumBytes), truncated: value.length > maximumBytes };
}

function decodeUtf8Bytes(bytes, allowTruncatedEnd) {
    var parts = [];
    var part = '';
    for (var i = 0; i < bytes.length;) {
        var first = bytes[i++];
        var code;
        var continuation;
        var minimum;
        if (first < 0x80) { code = first; continuation = 0; minimum = 0; }
        else if (first >= 0xc2 && first <= 0xdf) { code = first & 31; continuation = 1; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { code = first & 15; continuation = 2; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { code = first & 7; continuation = 3; minimum = 0x10000; }
        else return '';
        if (i + continuation > bytes.length) {
            if (allowTruncatedEnd) break;
            return '';
        }
        for (var j = 0; j < continuation; j++) {
            var next = bytes[i++];
            if ((next & 0xc0) !== 0x80) return '';
            code = code * 64 + (next & 63);
        }
        if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
        if (code <= 0xffff) part += String.fromCharCode(code);
        else {
            code -= 0x10000;
            part += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
        }
        if (part.length >= 4096) { parts.push(part); part = ''; }
    }
    parts.push(part);
    return parts.join('');
}
