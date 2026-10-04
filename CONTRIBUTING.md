# Contributing

Fork the repo, create a focused branch, and open a pull request. Use Node.js 22 or newer.

```sh
npm ci
npm run check
```

`check` runs the repository privacy audit, Taste and outfit tests, and production build. CI uses the full Git history for the same audit.

Keep `.env`, credentials, personal photos, wardrobe records, and generated assets out of Git. Store all personal assets under the ignored `data/` directory. Do not force-add ignored files. Common photo/video formats are ignored throughout the repository; only the two unchanged original project screenshots are approved for tracking. To add a public visual asset, review its provenance and privacy before updating the ignore rules and privacy check.

Before committing, inspect `git status --short` and the staged diff, then run `npm run check:privacy`. The audit checks tracked working files, staged contents, and available history, and reports possible secrets without printing their values. It uses recognized patterns and is not a complete secret scanner. If a private file was already committed, ignoring or deleting it does not remove it from history; resolve that before publishing.

Retain the original project's attribution in [README.md](README.md) and its copyright and MIT terms in [LICENSE](LICENSE).
