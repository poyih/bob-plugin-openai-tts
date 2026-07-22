# Identifier migration

## Who is affected

Version `0.3.2` used the Bob plugin identifier:

```text
com.poyih.bobplugin.openai.tts
```

Version `0.3.3` and every later release use:

```text
bob-plugin-openai-tts
```

Bob associates updates with the plugin identifier. The repository's static `appcast.json` can expose only one top-level identifier, so a feed for the current identifier cannot also update an installed `0.3.2` copy. The current feed therefore starts at `0.3.3`; older artifacts deliberately remain outside it because their identifiers are incompatible. This history cannot be repaired by changing the current identifier again; another rename would break updates for every current installation.

`bob-plugin-openai-tts` contains hyphens and is a legacy exception to Bob's current identifier schema. Existing installations are already bound to that value, so changing it in place would be more damaging than retaining it. A schema-compliant identifier could only be introduced as a separately named plugin with another explicit manual migration.

## Upgrade from 0.3.2 or earlier

1. Before changing anything, record the old plugin's API URL, model, voice, format and Instructions settings. Be prepared to enter the API Key again; secure fields may not migrate between identifiers.
2. Download the current `.bobplugin` file from [GitHub Releases](https://github.com/poyih/bob-plugin-openai-tts/releases/latest).
3. Double-click the downloaded file and install it in Bob. It may temporarily appear beside the legacy copy because Bob sees the identifiers as different plugins.
4. Configure the new **OpenAI TTS** entry and use Bob's validation action to verify it.
5. After successful synthesis, remove or disable the legacy copy to avoid selecting it by mistake.

Users already running `0.3.3` or later keep the current identifier and can use normal appcast updates.

## Maintainer guardrails

- Treat `bob-plugin-openai-tts` as immutable. Do not rename it for cosmetic or schema reasons.
- Keep the current appcast at `0.3.3` or later; never mix artifacts from a different identifier into the feed.
- Never add an appcast entry before its exact Release asset exists. Compute the SHA-256 from the uploaded `.bobplugin` file and use the actual GitHub `publishedAt` time.
- Keep the appcast's top-level identifier equal to `info.json`.
- Do not fabricate a second version entry as a workaround for the legacy identifier. Document the one-time manual migration instead.
