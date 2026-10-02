# Test fixtures

The six audio files contain an original, generated 440 Hz tone (0.2 seconds), encoded with FFmpeg 7.1 into MP3, ADTS AAC, AAC/M4A, Ogg Opus, FLAC and signed 16-bit WAV. Each fixture was decoded successfully with FFmpeg before inclusion.

`token-counts.json` contains deterministic multilingual, whitespace, contraction, emoji and boundary cases counted by OpenAI tiktoken 0.12.0 using the pinned o200k_base vocabulary. No paid API calls are used.
