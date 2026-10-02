# Agent instructions

## Local preferences and privacy

Before wardrobe imports, outfit generation, or styling tasks, read `data/AGENTS.local.md` if present. It holds the current user's private reference paths and clothing preferences. Treat these as local preferences, not defaults for other users. Keep this file and all personal photos, identity crops, wardrobe records, and generated assets under Git-ignored `data/`. Never copy their contents into public documentation or commit them. Only explicitly approved README screenshots may be tracked.

## Modeled images

Use the current user's primary identity reference and available clear, user-only supplemental identity crops. Inspect all identity and garment references before generation. Preserve the user's actual appearance, skin texture, distinguishing marks, age, and natural proportions; do not beautify or substitute an idealized model. Compare the result against the references and regenerate material identity drift.

Use exact owned-garment cutouts as separate clothing references. Supporting layers must be backed by source photos. Hold items when defining construction or artwork is obscured; do not invent missing details. Never modify original photos.

## Default: Codex usage

This repository chooses ChatGPT-authenticated Codex usage by default (`WARDROBE_IMPORT_MODE=codex`). Use the built-in Codex image generation route for modeled images. Do not switch to separately billed API calls or a generation fallback without an explicit user request. If the route is unavailable, report the issue.

For imports, follow the bundled `import-clothes` skill. For curated outfit generation, follow `generate-outfits`. The local outfit, Taste, and recommendation runners require Codex signed in with ChatGPT. See [official authentication guidance](https://learn.chatgpt.com/docs/auth).

## Optional: API browser imports

When the user explicitly chooses API imports, configure their ignored `.env` file:

```dotenv
WARDROBE_IMPORT_MODE=api
OPENAI_API_KEY=your-api-key
WARDROBE_MODEL_REFERENCE=data/model-reference.png
```

The user must provide their own [OpenAI API key](https://developers.openai.com/api/docs/quickstart) and a real PNG identity reference at the configured path. Restart the local server, then use the browser importer to review and approve garment cutouts and modeled previews. API usage is billed separately from ChatGPT plan usage. Never expose the key in browser code, logs, chat, or Git.

This setting changes browser imports only; outfit generation, Taste, and recommendations remain Codex-based. To return to the default, set `WARDROBE_IMPORT_MODE=codex` and restart. See [the setup guide](docs/PERSONAL_SETUP.md) for details.

## Development

Keep changes focused, retain upstream attribution and the MIT license, and run `npm run check` before publishing.
