// binary: bundled with main.js for the Bob JavaScriptCore runtime.

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
