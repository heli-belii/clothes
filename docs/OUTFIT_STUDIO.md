# Your outfit studio

Start the project with `npm run dev`, then open the **Outfits** tab or `http://localhost:5173/#outfits`.

1. Select one top, one pair of bottoms and one pair of shoes. A jacket and an accessory are optional, with one selection each. The layout updates immediately using your real wardrobe cutouts.
2. Choose **School**, **Hiking** or **Gym**. Adjust lighting, weather and optional background details.
3. Open **Personalize your photos** to choose framing, pose, shirt tuck, long sleeve styling and jacket styling. Add any preferences to the notes. **Remember these preferences** applies them to future new looks.
4. Name and **Save look** to keep it. Incomplete looks can be saved; all three required categories must be filled before preparing a try-on. Star favorites and select two saved looks to compare them. Removing a look offers Undo.
5. Click **Prepare try-on**, then **Copy Codex request**. Paste it into the Codex chat for this repository. The website prepares the request; generation happens in Codex using the built-in image generation route. It does not call a separately billed image API.

The request includes the primary photo and the available supplemental identity references, all exact selected cutouts, the setting and the styling choices. Codex should inspect the references, generate one image, review identity and garment accuracy, and attach the accepted PNG with the command included in the request. Source photos remain unchanged.

After attachment, the modeled photo appears automatically within about ten seconds while the Outfits tab is open and waiting for a photo. **Refresh** checks immediately. You can also use **Add a generated PNG** if Codex gave you the completed image without attaching it. Choose a full-resolution PNG in the requested aspect ratio: square 1:1, vertical 2:3 or wide 3:2. Check that it accurately shows you and the selected clothes before adding it.

Changing clothes, settings or photo preferences hides the previous modeled preview until a matching image is generated. Renaming or favoriting a look keeps its preview. Saved requests retain snapshots of the exact clothing cutouts used at preparation time.

## Local files

- `data/outfit-studio.json`: saved looks and remembered photo preferences.
- `data/outfit-requests/request-UUID/`: frozen garment references, `clothes.png` reference board, `prompt.txt`, `request.json` and accepted modeled PNGs.
- The current browser remembers the working draft; **Save look** writes it to the local collection so it survives changing browsers.
- All personal outfit files are covered by the existing `data/` Git ignore. Include that directory in your personal backups.
- `data/outfits.json` created by the separate outfit curation skill remains a separate collection.

To attach an accepted generated image from the project directory:

```sh
node scripts/attach-outfit-preview.mjs --request request-UUID --image /absolute/path/to/accepted.png
```

This helper only attaches an existing PNG. It does not generate images or require an API key.

## Development

- UI: `src/OutfitStudio.jsx` and `src/outfit-studio.css`.
- Categories, scene choices and styling controls: `src/outfit-model.mjs`.
- Storage, reference preparation and identity prompt: `scripts/outfit-store.mjs`.
- Local development and preview API: `scripts/outfit-api.mjs` at `/api/outfit-studio`.
- Checks: `npm run check` and `npm run test:outfits`.

Use the Vite development or preview server for this local application. A static-only deployment would need a backend that implements these local storage and image routes.
