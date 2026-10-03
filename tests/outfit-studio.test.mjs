import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { createOutfitStore } from "../scripts/outfit-store.mjs";
import { createOutfitHandler } from "../scripts/outfit-api.mjs";
import { DEFAULT_CONTEXT, emptySelection, missingRequired, normalizeSelection } from "../src/outfit-model.mjs";

const parts = ["upperbody", "lowerbody", "shoes", "wholebody_up", "accessories_up"];
const selection = () => ({ ...emptySelection(), upperbody: "item-upperbody", lowerbody: "item-lowerbody", shoes: "item-shoes" });
async function png(width = 512, height = width, background = "#738275") { return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer(); }
async function fixture(t, supplementalCount = 2) {
  const root = await mkdtemp(path.join(tmpdir(), "wardrobe-outfit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data/imported"), { recursive: true });
  await mkdir(path.join(root, "data/identity-references"), { recursive: true });
  const bytes = await png(64);
  const items = parts.map((part) => ({ id: `item-${part}`, name: `My ${part}`, part, image: `/api/import/library/${part}.png`, tags: ["source-confirmed"], color: "#738275" }));
  await writeFile(path.join(root, "data/library.json"), JSON.stringify(items));
  await writeFile(path.join(root, "data/model-reference.png"), bytes);
  for (const name of ["front-user.png", "side-user.png"].slice(0, supplementalCount)) await writeFile(path.join(root, "data/identity-references", name), bytes);
  for (const item of items) await writeFile(path.join(root, "data/imported", `${item.part}.png`), bytes);
  return { root, items, bytes, store: createOutfitStore(root) };
}
const draft = (overrides = {}) => ({ name: "My campus look", selection: selection(), context: { ...DEFAULT_CONTEXT }, ...overrides });
async function rejected(promise, message, status = 400) { await assert.rejects(promise, (error) => error.status === status && message.test(error.message)); }

test("requires precisely top, bottoms and shoes; optional slots accept one item", () => {
  const items = parts.map((part) => ({ id: `item-${part}`, part }));
  assert.equal(missingRequired(emptySelection(), items).length, 3);
  assert.deepEqual(normalizeSelection(selection(), items, true), selection());
  for (const part of ["upperbody", "lowerbody", "shoes"]) assert.throws(() => normalizeSelection({ ...selection(), [part]: null }, items, true), /before preparing/);
  assert.throws(() => normalizeSelection({ ...selection(), shoes: ["item-shoes"] }, items), /Choose one shoes/);
  assert.throws(() => normalizeSelection({ ...selection(), shoes: "item-upperbody" }, items), /does not belong/);
  const all = Object.fromEntries(parts.map((part) => [part, `item-${part}`]));
  assert.deepEqual(normalizeSelection(all, items, true), all);
});

test("saved drafts, preferences, favorites and archive undo persist across reloads", async (t) => {
  const { root, store } = await fixture(t);
  const look = await store.saveLook(draft({ selection: { ...emptySelection(), upperbody: "item-upperbody" } }));
  assert.equal(look.preview, null);
  await rejected(store.prepareRequest(look.id), /Choose bottoms/);
  await store.saveLook({ ...look, favorite: true }, look.id);
  const preferences = await store.savePreferences({ framing: "portrait", sleeves: "down", styleNotes: "Keep the natural fit." });
  assert.equal(preferences.framing, "portrait");
  const reloaded = createOutfitStore(root);
  assert.equal((await reloaded.getState()).looks[0].favorite, true);
  assert.equal((await reloaded.getState()).preferences.sleeves, "down");
  await reloaded.archiveLook(look.id);
  assert.equal((await reloaded.getState()).looks.length, 0);
  await reloaded.archiveLook(look.id, true);
  assert.equal((await reloaded.getState()).looks[0].name, "My campus look");
});

test("requests freeze exact cutouts, preserve all identity references and reuse unchanged outfits", async (t) => {
  const { root, store, bytes } = await fixture(t);
  const all = Object.fromEntries(parts.map((part) => [part, `item-${part}`]));
  const look = await store.saveLook(draft({ selection: all, context: { ...DEFAULT_CONTEXT, background: "hiking", sleeves: "rolled" } }));
  const request = await store.prepareRequest(look.id);
  assert.equal(request.garments.length, 5);
  assert.equal(request.identityReferences.length, 3);
  assert.equal(request.references.length, 5);
  assert.match(request.prompt, /Image 4 is the complete selected-clothes/);
  assert.match(request.prompt, /outdoor hiking trail/);
  assert.match(request.prompt, /No beautification, slimming/);
  assert.match(request.handoff, /built-in Codex image generation/);
  assert.equal((await store.prepareRequest(look.id)).id, request.id);
  await writeFile(path.join(root, "data/imported/upperbody.png"), await png(64, 64, "#ff3333"));
  assert.deepEqual(await readFile(path.join(store.requestDir(request.id), "garments/upperbody.png")), bytes);
  const board = await sharp(path.join(store.requestDir(request.id), "clothes.png")).metadata();
  assert.equal(board.width, 1800);
  assert.equal(board.height, 1360);
  assert.equal(JSON.parse(await readFile(path.join(store.requestDir(request.id), "request.json"), "utf8")).status, "requested");
});

test("reference roles remain correct when only one supplemental identity is available", async (t) => {
  const { store } = await fixture(t, 1);
  const look = await store.saveLook(draft());
  const request = await store.prepareRequest(look.id);
  assert.equal(request.identityReferences.length, 2);
  assert.match(request.prompt, /Images 1–2 are/);
  assert.match(request.prompt, /Image 3 is the complete selected-clothes/);
  assert.match(request.prompt, /Image 4 is the exact top/);
});

test("changing garments or the setting invalidates an accepted modeled preview", async (t) => {
  const { root, store } = await fixture(t);
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id);
  await store.attachPreview(request.id, await png());
  let saved = (await createOutfitStore(root).getState()).looks[0];
  assert.match(saved.preview, /\/preview\?v=[a-f0-9]{64}$/);
  saved = await store.saveLook({ ...saved, name: "Renamed look", favorite: true }, saved.id);
  assert.equal(saved.request.id, request.id);
  assert.ok(saved.preview);
  saved = await store.saveLook({ ...saved, context: { ...saved.context, background: "gym" } }, saved.id);
  assert.equal(saved.request, null);
  assert.equal(saved.preview, null);
  const next = await store.prepareRequest(saved.id);
  assert.notEqual(next.id, request.id);
  saved = await store.saveLook({ ...saved, selection: { ...saved.selection, wholebody_up: "item-wholebody_up" } }, saved.id);
  assert.equal(saved.request, null);
  assert.equal(saved.preview, null);
});

test("rejects missing identities, removed items and missing cutouts without accepting a request", async (t) => {
  const { root, store, items } = await fixture(t, 0);
  let look = await store.saveLook(draft());
  assert.equal((await store.getState()).identityReady, false);
  await rejected(store.prepareRequest(look.id), /supplemental identity/);
  await writeFile(path.join(root, "data/identity-references/front-user.png"), await png(64));
  await writeFile(path.join(root, "data/library.json"), JSON.stringify(items.filter(({ part }) => part !== "shoes")));
  await rejected(store.prepareRequest(look.id), /no longer in your wardrobe/);
  await writeFile(path.join(root, "data/library.json"), JSON.stringify(items));
  await rm(path.join(root, "data/imported/shoes.png"));
  await rejected(store.prepareRequest(look.id), /cutout.*missing/);
  look = (await store.getState()).looks[0];
  assert.equal(look.request, null);
});

test("preview attachment validates PNG pixels, resolution and selected framing", async (t) => {
  const { store } = await fixture(t);
  const look = await store.saveLook(draft({ context: { ...DEFAULT_CONTEXT, framing: "portrait" } }));
  const request = await store.prepareRequest(look.id);
  await rejected(store.attachPreview(request.id, Buffer.from("not an image")), /valid PNG/);
  await rejected(store.attachPreview(request.id, await png(256, 384)), /full-resolution/);
  await rejected(store.attachPreview(request.id, await png()), /aspect ratio/);
  const valid = await png(512, 768);
  await rejected(store.attachPreview(request.id, valid.subarray(0, 48)), /damaged|valid PNG/);
  assert.equal((await store.request(request.id)).status, "requested");
  const accepted = await store.attachPreview(request.id, valid);
  assert.equal(accepted.status, "accepted");
  assert.ok((await store.getState()).looks[0].preview);
});

test("concurrent saves retain every look and invalid mutations leave saved data intact", async (t) => {
  const { store } = await fixture(t);
  const looks = await Promise.all(Array.from({ length: 12 }, (_, i) => store.saveLook(draft({ name: `Look ${i}` }))));
  assert.equal(new Set(looks.map(({ id }) => id)).size, 12);
  await rejected(store.saveLook(draft({ context: { background: "unknown" } })), /school, hiking or gym/);
  await rejected(store.saveLook(draft(), "../../library.json"), /Invalid saved outfit/);
  await rejected(store.attachPreview("../../library.json", await png()), /Invalid outfit request/);
  assert.equal((await store.getState()).looks.length, 12);
});

// Exercise the real middleware without binding a port or touching personal data.
async function call(handler, method, url, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))]);
  req.method = method; req.url = url;
  const headers = {}, result = { status: 200, headers };
  const res = { set statusCode(value) { result.status = value; }, setHeader(name, value) { headers[name] = value; }, end(value) { result.bytes = Buffer.from(value || ""); } };
  await handler(req, res, () => { result.next = true; });
  if (headers["Content-Type"]?.startsWith("application/json")) result.value = JSON.parse(result.bytes);
  return result;
}

test("API saves, prepares, attaches, serves and restores a look; rejects malformed input", async (t) => {
  const { store } = await fixture(t), handler = createOutfitHandler(store), base = "/api/outfit-studio";
  assert.equal((await call(handler, "GET", "/unrelated")).next, true);
  assert.equal((await call(handler, "POST", `${base}/looks`, "{")).status, 400);
  assert.equal((await call(handler, "POST", `${base}/looks`, [])).status, 400);
  assert.equal((await call(handler, "POST", `${base}/looks`, " ".repeat(256 * 1024 + 1))).status, 413);
  const saved = await call(handler, "POST", `${base}/looks`, draft());
  assert.equal(saved.status, 201);
  const id = saved.value.id;
  const prepared = await call(handler, "POST", `${base}/looks/${id}/request`);
  assert.equal(prepared.status, 201);
  const route = `${base}/requests/${prepared.value.id}/preview`;
  assert.equal((await call(handler, "GET", route)).status, 404);
  assert.equal((await call(handler, "POST", route, { imageDataUrl: 7 })).status, 400);
  const accepted = await call(handler, "POST", route, { imageDataUrl: `data:image/png;base64,${(await png()).toString("base64")}` });
  assert.equal(accepted.status, 200);
  const image = await call(handler, "GET", route);
  assert.equal(image.headers["Content-Type"], "image/png");
  assert.equal((await sharp(image.bytes).metadata()).width, 512);
  assert.equal((await call(handler, "DELETE", `${base}/looks/${id}`)).status, 200);
  assert.equal((await call(handler, "GET", base)).value.looks.length, 0);
  assert.equal((await call(handler, "POST", `${base}/looks/${id}/restore`)).status, 200);
  assert.equal((await call(handler, "GET", base)).value.looks[0].preview, accepted.value.image);
});
