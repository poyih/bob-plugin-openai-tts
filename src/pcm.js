// pcm: bundled with main.js for the Bob JavaScriptCore runtime.

function wrapPcmBase64AsWav(pcmBase64, specification) {
    var pcmBytes = decodeBase64(pcmBase64);
    if (!pcmBytes) {
        return { error: { type: 'api', message: 'PCM 音频数据解码失败。' } };
    }
    var lengthError = validatePcmLength(pcmBytes.length, specification);
    if (lengthError) return { error: lengthError };
    if (pcmBytes.length + 44 > MAX_AUDIO_BYTES) {
        return { error: audioTooLargeError(pcmBytes.length + 44) };
    }
    if (typeof Uint8Array === 'undefined') {
        return { error: { type: 'api', message: '当前 Bob 版本无法包装 PCM 音频，请改用 MP3。' } };
    }

    var wavBytes = new Uint8Array(44 + pcmBytes.length);
    var header = createWavHeader(pcmBytes.length, specification);
    for (var headerIndex = 0; headerIndex < header.length; headerIndex++) wavBytes[headerIndex] = header[headerIndex];
    if (typeof wavBytes.set === 'function') {
        wavBytes.set(pcmBytes, 44);
    } else {
        for (var i = 0; i < pcmBytes.length; i++) wavBytes[44 + i] = pcmBytes[i];
    }

    return { base64: encodeBase64(wavBytes) };
}

function wrapPcmRawDataAsWav(rawData, rawLength, specification) {
    if (rawLength === 0 || rawLength > MAX_AUDIO_BYTES - 44) {
        return rawLength > 0
            ? { error: audioTooLargeError(rawLength + 44) }
            : { error: { type: 'api', message: 'PCM 音频数据为空。' } };
    }
    var lengthError = validatePcmLength(rawLength, specification);
    if (lengthError) return { error: lengthError };

    // Bob 的 $data 可原地拼接 NSData。主路径只创建 44 字节 WAV 头，避免把整段音频展开为 JS number 数组。
    if (rawLength > 0 && typeof $data !== 'undefined' && $data && typeof $data.fromByteArray === 'function') {
        try {
            var headerBytes = createWavHeader(rawLength, specification);
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
    return wrapPcmBase64AsWav(pcmBase64, specification);
}

function createWavHeader(pcmByteLength, specification) {
    var header = [];
    for (var i = 0; i < 44; i++) header.push(0);
    writeAscii(header, 0, 'RIFF');
    writeUint32LE(header, 4, 36 + pcmByteLength);
    writeAscii(header, 8, 'WAVE');
    writeAscii(header, 12, 'fmt ');
    writeUint32LE(header, 16, 16);
    writeUint16LE(header, 20, 1);
    writeUint16LE(header, 22, specification.channels);
    writeUint32LE(header, 24, specification.sampleRate);
    writeUint32LE(header, 28, specification.sampleRate * specification.channels * specification.bitsPerSample / 8);
    writeUint16LE(header, 32, specification.channels * specification.bitsPerSample / 8);
    writeUint16LE(header, 34, specification.bitsPerSample);
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

function getPcmSpecification(response) {
    var defaults = getModelCapabilities(getModel()).pcm || {};
    var specification = { sampleRate: defaults.sampleRate, channels: defaults.channels, bitsPerSample: 16 };
    var parameters = getResponseContentType(response).split(';');
    var seen = {};
    for (var i = 1; i < parameters.length; i++) {
        var match = /^\s*([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^;]*))\s*$/i.exec(parameters[i]);
        if (!match) continue;
        var name = match[1].toLowerCase();
        var value = (match[2] != null ? match[2] : match[3]).trim().toLowerCase();
        if (name === 'rate' || name === 'channels' || name === 'bits' || name === 'bitdepth') {
            var field = name === 'rate' ? 'sampleRate' : (name === 'channels' ? 'channels' : 'bitsPerSample');
            if (seen[field] || !/^\d+$/.test(value)) return { error: { type: 'api', message: 'PCM 响应中的采样率、声道或位深参数无效。' } };
            seen[field] = true;
            specification[field] = Number(value);
        } else if ((name === 'encoding' && ['pcm_s16le', 's16le', 'signed-integer', 'signed'].indexOf(value) === -1) ||
            (name === 'endianness' && ['little', 'little-endian', 'le'].indexOf(value) === -1)) {
            return { error: { type: 'api', message: '此 PCM 编码暂不支持，请改用 MP3 或 WAV。' } };
        }
    }
    if (!specification.sampleRate || !specification.channels) {
        return { error: { type: 'api', message: '该模型的 PCM 响应缺少采样率或声道信息，请改用 MP3，或让服务在 Content-Type 中返回 rate 和 channels。' } };
    }
    if (specification.sampleRate < 8000 || specification.sampleRate > 384000 ||
        specification.channels < 1 || specification.channels > 8 || specification.bitsPerSample !== 16) {
        return { error: { type: 'api', message: 'PCM 参数超出支持范围：采样率 8000–384000 Hz、1–8 声道、16 位小端采样。' } };
    }
    return specification;
}

function validatePcmLength(length, specification) {
    if (!length || length % (specification.channels * specification.bitsPerSample / 8) !== 0) {
        return { type: 'api', message: 'PCM 数据长度无效，必须包含完整的声道采样帧。' };
    }
    return null;
}
