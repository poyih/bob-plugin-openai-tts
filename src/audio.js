// audio: bundled with main.js for the Bob JavaScriptCore runtime.

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
    if (hasStructuredErrorPayload(resp, format === 'pcm')) {
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
        var specification = getPcmSpecification(response);
        if (specification.error) return specification;
        var wavResult = wrapPcmRawDataAsWav(resp.rawData, rawLength, specification);
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
    return getResponseContentType(response).split(';')[0].trim().toLowerCase();
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
    var bitrateTable = version === 3
        ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    var rates = version === 3 ? [44100, 48000, 32000] :
        (version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000]);
    return Math.floor((version === 3 ? 144 : 72) * bitrateTable[bitrateIndex - 1] * 1000 / rates[sampleRateIndex] + (header[2] >>> 1 & 1));
}

function isCompleteMp3Data(rawData, prefix, totalLength) {
    var offset = getId3End(rawData, prefix, totalLength);
    if (offset < 0) offset = 0;
    var frames = 0;
    while (offset < totalLength && frames < 200000) {
        if (frames && totalLength - offset === 128 && matchesAscii(readAudioBytes(rawData, prefix, offset, 3), 0, 'TAG')) return true;
        var header = readAudioBytes(rawData, prefix, offset, 4);
        var length = getMpegFrameLength(header);
        if (length < 8 || offset + length > totalLength) return false;
        offset += length;
        frames++;
    }
    return frames > 0 && offset === totalLength;
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
    var frames = 0;
    while (offset < totalLength && frames < 200000) {
        if (!isCompleteAdtsFrameAt(rawData, prefix, totalLength, offset)) return false;
        var header = readAudioBytes(rawData, prefix, offset, 7);
        offset += (header[3] & 3) * 2048 + header[4] * 8 + (header[5] >>> 5 & 7);
        frames++;
    }
    return frames > 0 && offset === totalLength;
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
    var sawMedia = false;
    var sawAudioTrack = false;
    var budget = { boxes: 0 };
    while (offset < totalLength && budget.boxes++ < 4096) {
        var box = readIsoBox(rawData, prefix, totalLength, offset);
        if (!box) return false;
        if (offset === 0) {
            if (box.type !== 'ftyp' || box.size < 16) return false;
            sawFtyp = true;
        }
        if (box.type === 'mdat' && box.size > box.headerLength) sawMedia = true;
        if (box.type === 'moov') {
            var movie = inspectMp4Container(rawData, prefix, offset + box.headerLength, offset + box.size, null, budget, 0);
            if (!movie.valid) return false;
            if (movie.audio) sawAudioTrack = true;
        }
        offset += box.size;
    }
    return offset === totalLength && sawFtyp && sawMedia && sawAudioTrack;
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
    var sawAudio = false;
    var sawEnd = false;
    var streamSerial = null;
    var previousSequence = -1;
    var packetLength = 0;
    var packetPrefix = [];
    for (var pageIndex = 0; pageIndex < 65536 && offset < totalLength; pageIndex++) {
        var pageHeader = readAudioBytes(rawData, prefix, offset, 27);
        if (pageHeader.length < 27 || !matchesAscii(pageHeader, 0, 'OggS') || pageHeader[4] !== 0) return false;
        if (pageHeader[5] & 0xf8) return false;
        var serial = readUint32LEValue(pageHeader, 14);
        var sequence = readUint32LEValue(pageHeader, 18);
        if (streamSerial === null) streamSerial = serial;
        if (serial !== streamSerial || sequence !== previousSequence + 1 || sawEnd ||
            (pageIndex > 0 && (pageHeader[5] & 0x02))) return false;
        previousSequence = sequence;
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
                    if (packetLength < 16 || sawTags || sawAudio) return false;
                    sawTags = true;
                } else if (sawTags && packetLength > 0 && !matchesAscii(packetPrefix, 0, 'OpusHead')) {
                    sawAudio = true;
                } else {
                    return false;
                }
                packetLength = 0;
                packetPrefix = [];
            }
        }
        if (pageHeader[5] & 0x04) {
            if (packetLength !== 0 || pageEnd !== totalLength) return false;
            sawEnd = true;
        }
        offset = pageEnd;
    }
    return offset === totalLength && sawHead && sawTags && sawAudio && sawEnd;
}

function getResponseContentType(response) {
    var headers = response && response.headers;
    if (headers) {
        var names = Object.keys(headers);
        for (var i = 0; i < names.length; i++) {
            if (names[i].toLowerCase() === 'content-type') return String(headers[names[i]] || '');
        }
    }
    return String(response && (response.MIMEType || response.mimeType) || '');
}

function inspectMp4Container(rawData, prefix, start, end, track, budget, depth) {
    if (depth > 8) return { valid: false };
    var offset = start;
    var audio = false;
    while (offset < end && budget.boxes++ < 4096) {
        var box = readIsoBox(rawData, prefix, end, offset);
        if (!box) return { valid: false };
        var bodyStart = offset + box.headerLength;
        var boxEnd = offset + box.size;
        if (box.type === 'trak') {
            var candidate = { sound: false, aac: false };
            var childTrack = inspectMp4Container(rawData, prefix, bodyStart, boxEnd, candidate, budget, depth + 1);
            if (!childTrack.valid) return { valid: false };
            if (candidate.sound && candidate.aac) audio = true;
        } else if (['mdia', 'minf', 'stbl'].indexOf(box.type) !== -1) {
            var child = inspectMp4Container(rawData, prefix, bodyStart, boxEnd, track, budget, depth + 1);
            if (!child.valid) return { valid: false };
            if (child.audio) audio = true;
        } else if (box.type === 'hdlr' && track) {
            var handler = readAudioBytes(rawData, prefix, bodyStart, Math.min(12, boxEnd - bodyStart));
            if (handler.length < 12) return { valid: false };
            if (matchesAscii(handler, 8, 'soun')) track.sound = true;
        } else if (box.type === 'stsd' && track) {
            var header = readAudioBytes(rawData, prefix, bodyStart, Math.min(8, boxEnd - bodyStart));
            if (header.length < 8) return { valid: false };
            var entries = readUint32BEValue(header, 4);
            if (entries < 1 || entries > 128) return { valid: false };
            var sampleOffset = bodyStart + 8;
            for (var index = 0; index < entries; index++) {
                var sample = readIsoBox(rawData, prefix, boxEnd, sampleOffset);
                if (!sample) return { valid: false };
                if (sample.type === 'mp4a') {
                    if (sample.size < 36) return { valid: false };
                    track.aac = true;
                }
                sampleOffset += sample.size;
            }
            if (sampleOffset !== boxEnd) return { valid: false };
        }
        offset = boxEnd;
    }
    return { valid: offset === end, audio: audio };
}
