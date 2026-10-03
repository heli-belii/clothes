import { readFile } from "node:fs/promises";
import path from "node:path";
import { createOutfitStore, REQUEST_ID } from "./outfit-store.mjs";

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--request", "--image", "--repo"].includes(args[i]) || !args[i + 1]) throw new Error("Usage: node scripts/attach-outfit-preview.mjs --request request-ID --image /path/to/accepted.png [--repo /path/to/clothes]");
  options[args[i].slice(2)] = args[i + 1];
}
if (!REQUEST_ID.test(options.request || "") || !options.image) throw new Error("A valid request ID and accepted PNG image are required.");
const store = createOutfitStore(path.resolve(options.repo || process.cwd()));
console.log(JSON.stringify(await store.attachPreview(options.request, await readFile(path.resolve(options.image))), null, 2));
