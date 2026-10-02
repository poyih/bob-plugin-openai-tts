// o200k_base byte-pair token counting. The build supplies the pinned rank table.
var o200kPattern = null;

function encodeUtf8(value) {
    var bytes = [];
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
            var low = value.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + (code - 0xd800) * 1024 + low - 0xdc00;
                i++;
            }
        }
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
        else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
        else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    }
    return bytes;
}

function getO200kPattern() {
    if (o200kPattern) return o200kPattern;
    // Match Unicode White_Space exactly: JS \s additionally contains BOM and omits NEL.
    var whitespace = '\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
    var contraction = "(?:'[sStTmMdD]|'[rR][eE]|'[vV][eE]|'[lL][lL])?";
    var patterns = [
        '[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+' + contraction,
        '[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*' + contraction,
        '\\p{N}{1,3}',
        ' ?[^' + whitespace + '\\p{L}\\p{N}]+[\\r\\n/]*',
        '[' + whitespace + ']*[\\r\\n]+',
        '[' + whitespace + ']+(?![^' + whitespace + '])',
        '[' + whitespace + ']+'
    ];
    o200kPattern = new RegExp(patterns.join('|'), 'gu');
    return o200kPattern;
}

function countInputTokens(text, stopAfter) {
    var pattern = getO200kPattern();
    pattern.lastIndex = 0;
    var match;
    var count = 0;
    var covered = 0;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index !== covered) throw new Error('Tokenizer could not read the complete input');
        covered += match[0].length;
        count += countBpePiece(encodeUtf8(match[0]));
        if (stopAfter != null && count > stopAfter) return count;
    }
    if (covered !== text.length) throw new Error('Tokenizer could not read the complete input');
    return count;
}

function countBpePiece(bytes) {
    if (!bytes.length) return 0;
    var ranks = getO200kRanks();
    if (typeof ranks[encodeBase64(bytes)] === 'number') return 1;
    var nodes = [];
    var heap = [];
    var count = bytes.length;
    for (var i = 0; i < bytes.length; i++) {
        nodes.push({ start: i, end: i + 1, previous: i - 1, next: i + 1 < bytes.length ? i + 1 : -1, version: 0, alive: true });
    }
    function less(a, b) {
        return a.rank < b.rank || (a.rank === b.rank && a.left < b.left);
    }
    function push(pair) {
        heap.push(pair);
        var index = heap.length - 1;
        while (index > 0) {
            var parent = Math.floor((index - 1) / 2);
            if (!less(heap[index], heap[parent])) break;
            var previous = heap[parent];
            heap[parent] = heap[index];
            heap[index] = previous;
            index = parent;
        }
    }
    function pop() {
        var first = heap[0];
        var last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            var index = 0;
            while (index * 2 + 1 < heap.length) {
                var child = index * 2 + 1;
                if (child + 1 < heap.length && less(heap[child + 1], heap[child])) child++;
                if (!less(heap[child], heap[index])) break;
                var current = heap[index];
                heap[index] = heap[child];
                heap[child] = current;
                index = child;
            }
        }
        return first;
    }
    function offer(leftIndex) {
        if (leftIndex < 0) return;
        var left = nodes[leftIndex];
        if (!left.alive || left.next < 0) return;
        var right = nodes[left.next];
        var rank = ranks[encodeBase64(bytes.slice(left.start, right.end))];
        if (typeof rank === 'number') push({ left: leftIndex, right: left.next, rank: rank, leftVersion: left.version, rightVersion: right.version });
    }
    for (var pairIndex = 0; pairIndex + 1 < bytes.length; pairIndex++) offer(pairIndex);
    while (heap.length) {
        var pair = pop();
        var left = nodes[pair.left];
        var right = nodes[pair.right];
        if (!left.alive || !right.alive || left.next !== pair.right ||
            left.version !== pair.leftVersion || right.version !== pair.rightVersion) continue;
        left.end = right.end;
        left.next = right.next;
        left.version++;
        right.alive = false;
        if (right.next >= 0) nodes[right.next].previous = pair.left;
        count--;
        offer(left.previous);
        offer(pair.left);
    }
    return count;
}
