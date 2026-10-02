# Offline tokenizer data

o200k_base.tiktoken is the OpenAI vocabulary used by the GPT-4o family.

- Source: https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken
- Reference configuration: https://github.com/openai/tiktoken/blob/0.12.0/tiktoken_ext/openai_public.py
- SHA-256: `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`
- License: [tiktoken MIT license](tiktoken-LICENSE)

The build checks the digest and embeds the ranks into the single Bob script. There is no network access or external package dependency at plugin runtime. Tokenizer behavior is checked against golden counts from tiktoken 0.12.0.
