# Clothes — my wardrobe

A local wardrobe app for organizing clothes, planning outfits, and discovering your style.

Based on [Wardrobe](https://github.com/tandpfun/wardrobe) by [Thijs Simonian (@tandpfun)](https://github.com/tandpfun), starting from commit [`f44006c`](https://github.com/tandpfun/wardrobe/tree/f44006cce7e4779e595a35b25fbbc8dabc68d7e4). Thank you, Thijs, for sharing the original project. Its MIT license and copyright are preserved in [LICENSE](LICENSE).

## Wardrobe

Browse your clothes, filter by category, and edit each piece.

![Current wardrobe gallery](docs/screenshots/gallery.png)

## Outfits

Combine owned pieces, save looks, and preview them on yourself. [Guide](docs/OUTFIT_STUDIO.md).

![Outfit studio with a saved modeled look](docs/screenshots/outfits.png)

## Taste

See your style overview, with evidence from the clothes you own.

![Taste overview and style influences](docs/screenshots/taste.png)

## Recommendations

Set your budget and preferences; the app refreshes your style, then finds matching products.

![Saved product recommendations and styling suggestions](docs/screenshots/recommendations.png)

## Color language

Explore your wardrobe palette and color combinations. [Guide](docs/TASTE.md).

![Wardrobe palette and color combinations](docs/screenshots/color-language.png)

## Run locally

Requires Node.js 22+ and npm.

```sh
git clone https://github.com/heli-belii/clothes.git
cd clothes
npm ci
cp .env.example .env
mkdir -p data
npm run dev -- --host 127.0.0.1
```

Open [localhost:5173](http://localhost:5173). Imports default to Codex; API imports are optional. [Setup and hosting](docs/PERSONAL_SETUP.md).

## Privacy and checks

Personal photos, wardrobe data, and generated assets stay in Git-ignored `data/`; credentials stay in `.env`. Only reviewed README screenshots are intentionally public.

Run `npm run check` for the privacy audit, tests, and build. [Contributing](CONTRIBUTING.md).
