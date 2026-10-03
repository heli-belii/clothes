# Taste

Open the Taste tab, or visit `http://127.0.0.1:5173/#taste` while `npm run dev` is running.

1. Click **Identify my style**. Codex inspects numbered compilation pages containing every current clothing cutout. The profile includes supported style influences, a color palette, combinations of owned pieces, and suggested gaps in the imported collection.
2. Set a per-item budget. The USD presets are $50, $100, $200 and $400; custom minimum and maximum prices and other currencies are available. Choose the shopping region, favorite shops, exploration preference and personal fit/material/size notes.
3. Click **Find recommendations**. Codex researches live product pages, checks prices and availability, and explains the color and fit relationship to specific clothes you own. Results appear automatically and stay saved locally. Opening the tab and changing controls do not start AI requests.
4. Click **Reload style** when clothes are added, removed, recategorized or edited. Taste checks the current wardrobe and cutouts, marks older results as outdated, and requires an updated profile before new recommendations. Existing results remain available during a refresh or if a request fails.

Default favorites are FILA, Abercrombie & Fitch, lululemon and Nike. Suggestions mostly follow the existing style with a few new ideas. These fields are editable. The default shopping region is the United States; change it if needed.

AI requests run through the local Codex CLI signed in with ChatGPT, using the same allowance route as modeled outfits. This connection is local to this Mac, requires the wardrobe server to stay running, and is not a hosted website integration. The runner explicitly selects ChatGPT authentication and removes API-key environment variables. It does not read or expose tokens. `WARDROBE_CODEX_COMMAND` can specify the installed Codex executable if it is not on PATH.

Results and immutable wardrobe snapshots are in Git-ignored `data/taste/`. Each request has `brief.json`, `schema.json`, `request.json`, `result.json` and a diagnostic `generation.log`. Shopping results are accepted only after live web-search activity is observed; invalid IDs, unsafe links, wrong currencies and prices outside the requested range are rejected. Price and source verification are performed by Codex, not by an independent retailer feed. Prices exclude tax/shipping and may change after research; verify your size and final price on the linked product page. Unverified or unavailable matches may produce fewer recommendations.

Run `npm run test:taste` for the Taste checks and `npm run test:outfits` for existing outfit behavior.
