# Set up your personal clothes collection

This repository contains all tracked files from [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe), copied at commit `f44006cce7e4779e595a35b25fbbc8dabc68d7e4`. Your existing clothes Git history and `origin` remote are retained. The upstream MIT attribution is retained alongside your copyright notice. Thijs's personal wardrobe photos are not part of the upstream repository; the gallery starts empty.

## Run on your Mac

Use Node.js 22 or newer (upstream CI uses Node.js 22) and npm. From this repository:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the address printed by Vite, normally `http://localhost:5173`. Keep the terminal running. Stop it with Control-C. The explicit host flag limits access to this Mac; upstream's default binds to all network interfaces.

A local `.env` file and `data/` directory have been created for this copy. On a fresh checkout, create them with:

```sh
cp .env.example .env
mkdir -p data
```

## Default: import with your Codex allowance

This copy defaults to `WARDROBE_IMPORT_MODE=codex`. The website provides an **Import with Codex** instruction panel; API imports and automatic API generation are disabled, even if an API key is present. The website cannot consume your ChatGPT subscription directly.

Use Codex signed in with your ChatGPT account. Upload your clothing photos in the project chat or give their local folder path, include your reference photo, and ask `$import-clothes` to add them. Reload the gallery once Codex finishes. Image generation counts toward your plan allowance; it is not unlimited. API-key authentication in Codex uses separate API billing. See [official usage guidance](https://learn.chatgpt.com/docs/pricing).

## Optional: separately billed browser imports

Only follow this section if you deliberately want API billing. Set `WARDROBE_IMPORT_MODE=api` in `.env`. To enable the browser importer:

1. Add your own OpenAI API key to `OPENAI_API_KEY` in `.env`. The browser importer calls the OpenAI API using this server-side key; API usage is billed to your API account.
2. Place an actual PNG reference photo of yourself at `data/model-reference.png`. Use a clear, well-lit photo suitable for generated previews of you wearing clothes. Export HEIC/JPEG to PNG rather than only changing the extension. Alternatively, change `WARDROBE_MODEL_REFERENCE` in `.env` to your photo's local path.
3. Restart the server after changing `.env`.

The copied importer requires **both** the API key and reference file even if you only want garment cutouts. No API key or personal photo is supplied with this copy. The model names in `.env.example` are upstream defaults; your API account must have access to the configured models.

## Add your own clothing through the optional browser importer

Start with one photo to check the workflow before importing your whole collection. Clear photos of individual garments or outfits work best. Use PNG, JPEG, or WebP; convert iPhone HEIC photos first.

1. Click the **+** button, choose images, or drag/drop or paste a photo into the app.
2. Review each detected clothing crop and select **Use crop**.
3. Review the generated garment cutout. Check the name, category, colors, and tags; edit them before approving. Regenerate when the image misrepresents your actual garment.
4. Approve the cutout to add it to your gallery. The importer then generates a modeled preview using your reference photo; review and approve or reject that preview separately. Rejecting the modeled preview leaves the approved garment in your wardrobe.
5. Click a gallery piece later to edit its details. The category tabs filter your collection.

Detection, generation, and regeneration send relevant photos to OpenAI. The app keeps processing files locally and saves approved assets to your wardrobe. Completed or rejected jobs are removed, so retain your original photos separately. You do not need to modify React components or hard-code image paths to add clothes.

## Import through Codex (recommended)

The copied `.agents/skills/` directory includes two optional project skills. Open this repository in Codex and give a real local folder and reference PNG, for example:

```text
$import-clothes Import the clothes from ~/Pictures/my-clothes, use ~/Pictures/my-reference.png as the model reference, create modeled photos, and add them to this wardrobe.
```

For complete outfit ideas, request a specific number:

```text
$generate-outfits Create 5 modeled outfit ideas from my wardrobe.
```

The outfit skill creates a separate lookbook under `data/`. For combinations you choose yourself, use the new **Outfits** tab: select clothes, choose School, Hiking or Gym, save looks, and prepare a modeled-photo request to paste into Codex. See [the outfit studio guide](OUTFIT_STUDIO.md).

## Import existing cutouts without AI

If you already have product cutouts, the bundled import script can add them without an API key or model reference. Each cutout must be a PNG with both transparent and visible pixels, one garment per image.

Place your cutouts in `data/my-cutouts/`, and create `data/my-manifest.json`:

```json
{
  "items": [
    {
      "slug": "navy-shirt",
      "file": "navy-shirt.png",
      "status": "accepted",
      "name": "Navy shirt",
      "part": "upperbody",
      "color": "#18243b",
      "secondaryColor": null,
      "tags": ["cotton", "casual"]
    }
  ]
}
```

Preview the import, then repeat without `--dry-run` to save it:

```sh
node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs --items data/my-cutouts --manifest data/my-manifest.json --dry-run
node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs --items data/my-cutouts --manifest data/my-manifest.json
```

Reload the gallery afterward. Supported `part` values are `upperbody` (tops), `wholebody_up` (jackets), `lowerbody` (bottoms), `accessories_up` (accessories), and `shoes`.

## What to customize

| Goal | File or place to change |
| --- | --- |
| Your API key and reference photo path | `.env` |
| Your clothing photos and metadata | Importer UI, or the cutout import script above |
| Browser tab title and Apple home screen name | `index.html` |
| Installed app name | `public/manifest.webmanifest` |
| App icon | `public/icon.svg` |
| Colors, spacing, and gallery layout | `src/styles.css` |
| Import panel appearance | `src/import-flow.css` |
| Category labels and gallery behavior | `src/App.jsx` |
| Detection, image generation prompts, and backend logic | `scripts/import-job-api.mjs` |

Keep the package name `wardrobe` unless you also update the import script's repository-name check. Adding a new category requires coordinated changes to the UI, backend validation/prompts, and import script; changing a visible label alone is simpler.

## Your data and backups

- `data/library.json`: saved wardrobe records.
- `data/imported/`: approved cutouts and modeled item images.
- `data/jobs/`: temporary original uploads, crops, generated images, and import progress; completed or rejected jobs are removed.
- `data/model-reference.png`: your reference photo, unless configured elsewhere.
- Browser local storage: edits made to saved pieces and hidden/deleted-item state.

Back up the entire `data/` folder separately. Browser edits are not written back to `library.json`, so a folder backup alone does not preserve subsequent name/color/tag edits made in the gallery. Keep a consistent browser and local URL; switching browser, port, or hostname can make those edits appear missing. Avoid clearing site storage if you want to retain them.

`.env`, `data/`, `node_modules/`, and `dist/` are ignored by Git. Pushing the source repository will not upload your wardrobe, reference photo, or API key. Avoid putting personal photos in `public/`, which is tracked and served directly.

## Build and hosting

```sh
npm run check
npm run preview -- --host 127.0.0.1
```

`check` builds the application into `dist/`; preview normally opens on `http://localhost:4173`. The preview server also attaches the local API middleware, so it can read the same `.env` and `data/` when run from this repository with dependencies installed.

This project needs its Node server for the wardrobe API and image serving. Uploading only `dist/` to GitHub Pages or another static host does **not** provide a working wardrobe importer or library. Vite preview is useful for local verification, not a production deployment architecture.

For a personal collection, running locally is sufficient. To make it available remotely, additional implementation is required: a production Node backend exposing the current API/image middleware, persistent private storage for `data/`, server-side environment secrets, authentication and authorization for the wardrobe and import endpoints, and HTTPS. The copied app has no user login or per-user storage. A shared public service would also need per-user data separation and upload/usage limits before exposing the API.

The files have been copied locally. To publish the source to your existing GitHub repository after reviewing it:

```sh
git add .
git commit -m "Import wardrobe app and personal setup guide"
git push origin main
```

Use your actual branch name if it differs from `main`.
