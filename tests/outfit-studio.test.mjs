import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import sharp from "sharp";
import { createOutfitStore } from "../scripts/outfit-store.mjs";
import { createOutfitHandler } from "../scripts/outfit-api.mjs";
import { codexEnvironment, createCodexOutfitGenerator } from "../scripts/codex-outfit-generator.mjs";
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
  assert.deepEqual(request.identityReferences, ["data/model-reference.png", "data/identity-references/front-user.png", "data/identity-references/side-user.png"]);
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
  await rejected(store.saveLook(draft({ context: { background: "unknown" } })), /school, hiking, gym or beach/);
  await rejected(store.saveLook(draft(), "../../library.json"), /Invalid saved outfit/);
  await rejected(store.attachPreview("../../library.json", await png()), /Invalid outfit request/);
  assert.equal((await store.getState()).looks.length, 12);
});

// Exercise the real middleware without binding a port or touching personal data.
async function call(handler, method, url, payload, metadata = {}) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))]);
  req.method = method; req.url = url; Object.assign(req, metadata);
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

function fakeCodex({ auth = "Logged in using ChatGPT", imageGeneration = true } = {}) {
  const children = [], checks = [];
  return {
    children, checks,
    async execute(command, args, options) { checks.push({ command, args, options }); return { stdout: args.includes("login") ? auth : `image_generation stable ${imageGeneration}\n`, stderr: "" }; },
    spawn(command, args, options) {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 50000 + children.length, prompt: "" });
      child.stdin.on("data", (bytes) => { child.prompt += bytes.toString(); });
      child.kill = () => { queueMicrotask(() => child.emit("close", 143)); return true; };
      children.push({ child, command, args, options }); return child;
    },
  };
}

test("Codex runner uses ChatGPT authentication, removes API keys and deduplicates clicks", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex();
  const runner = createCodexOutfitGenerator(store, { ...fake, env: { PATH: "/bin", OPENAI_API_KEY: "not-a-real-key", CODEX_API_KEY: "not-a-real-key", CODEX_THREAD_ID: "parent" } });
  t.after(() => runner.close());
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id);
  const jobs = await Promise.all([runner.start(request.id), runner.start(request.id), runner.start(request.id)]);
  assert.equal(fake.children.length, 1);
  assert.ok(jobs.every((job) => job.generation.status === "running"));
  const { child, args, options } = fake.children[0];
  assert.equal(options.shell, false);
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.env.CODEX_API_KEY, undefined);
  assert.equal(options.env.CODEX_THREAD_ID, undefined);
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(args.includes("--approve-for-me"));
  assert.ok(!args.includes("--sandbox"), "--approve-for-me already selects workspace-write and rejects an explicit --sandbox.");
  assert.equal(args.filter((argument) => argument === "--image").length, 5);
  assert.match(child.prompt, /Use only the built-in image generation tool/);
  assert.match(child.prompt, /Do not use an API-key/);
  assert.equal((await store.getState()).looks[0].request.generation.status, "running");
  await store.attachPreview(request.id, await png());
  child.emit("close", 0); await runner.idle();
  assert.equal((await store.getState()).looks[0].request.generation.status, "completed");
  assert.ok((await store.getState()).looks[0].preview);
  await runner.start(request.id);
  assert.equal(fake.children.length, 1, "A matching accepted photo must not consume another generation.");
  assert.deepEqual(codexEnvironment({ OPENAI_API_KEY: "fake", PATH: "/bin" }), { PATH: "/bin" });
});

test("Codex runner refuses API-key sign-in or disabled built-in image generation", async (t) => {
  const { store } = await fixture(t);
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id);
  for (const fake of [fakeCodex({ auth: "Logged in using an API key" }), fakeCodex({ imageGeneration: false })]) {
    const runner = createCodexOutfitGenerator(store, fake);
    assert.equal((await runner.configuration()).available, false);
    await rejected(runner.start(request.id), /ChatGPT|Built-in image generation/, 503);
    assert.equal(fake.children.length, 0);
    await runner.close();
  }
});

test("CLI startup errors explain the actual failure and clear on retry", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex(), runner = createCodexOutfitGenerator(store, fake);
  t.after(() => runner.close());
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id);
  await runner.start(request.id);
  fake.children[0].child.stderr.write("error: the argument '--sandbox <SANDBOX_MODE>' cannot be used with '");
  fake.children[0].child.stderr.write("--approve-for-me'\nUsage: codex exec [OPTIONS]\n");
  fake.children[0].child.emit("close", 2); await runner.idle();
  const failure = (await store.request(request.id)).generation;
  assert.equal(failure.errorCode, "launch-options");
  assert.equal(failure.exitCode, 2);
  assert.match(failure.message, /--sandbox.*conflicts with --approve-for-me/);
  assert.doesNotMatch(failure.message, /sign-in|usage limits|Usage:/);
  await runner.start(request.id);
  const retry = (await store.request(request.id)).generation;
  assert.equal(retry.status, "running");
  assert.equal(retry.errorCode, null);
  assert.equal(retry.exitCode, null);
});

test("runner failures require explicit retry and stale processes become actionable errors", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex(), runner = createCodexOutfitGenerator(store, { ...fake, alive: () => false });
  t.after(() => runner.close());
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id);
  await runner.start(request.id);
  const secondLook = await store.saveLook(draft({ name: "Second look" })), secondRequest = await store.prepareRequest(secondLook.id);
  await rejected(runner.start(secondRequest.id), /Another outfit/, 409);
  const otherConnection = createCodexOutfitGenerator(store, { ...fake, alive: () => true });
  await rejected(otherConnection.start(secondRequest.id), /Another outfit/, 409);
  await otherConnection.close();
  fake.children[0].child.emit("close", 0); await runner.idle();
  let job = await store.request(request.id);
  assert.equal(job.generation.status, "failed");
  assert.match(job.generation.message, /without attaching/);
  assert.equal(fake.children.length, 1);
  await runner.start(request.id);
  assert.equal(fake.children.length, 2);
  await runner.close();
  assert.equal((await store.request(request.id)).generation.status, "failed");
  await store.setGeneration(secondRequest.id, { status: "running", pid: 99999 });
  const restarted = createCodexOutfitGenerator(store, { ...fake, alive: () => false });
  await restarted.reconcile();
  job = await store.request(secondRequest.id);
  assert.equal(job.generation.status, "failed");
  assert.match(job.generation.message, /interrupted/);
  await restarted.close();
});

test("generation API rejects remote or cross-origin callers and exposes progress to polling", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex(), runner = createCodexOutfitGenerator(store, fake);
  t.after(() => runner.close());
  const handler = createOutfitHandler(store, runner), base = "/api/outfit-studio";
  const look = await store.saveLook(draft()), request = await store.prepareRequest(look.id), route = `${base}/requests/${request.id}/generate`;
  assert.equal((await call(handler, "POST", route, undefined, { headers: { origin: "https://unrelated.example", host: "localhost:5173" } })).status, 403);
  assert.equal((await call(handler, "POST", route, undefined, { headers: { origin: "null", host: "localhost:5173" } })).status, 403);
  assert.equal((await call(handler, "POST", route, undefined, { socket: { remoteAddress: "192.168.1.20" } })).status, 403);
  assert.equal(fake.children.length, 0);
  const started = await call(handler, "POST", route, undefined, { headers: { origin: "http://localhost:5173", host: "localhost:5173" }, socket: { remoteAddress: "127.0.0.1" } });
  assert.equal(started.status, 202);
  const state = (await call(handler, "GET", base)).value;
  assert.equal(state.codex.billing, "chatgpt");
  assert.equal(state.looks[0].request.generation.status, "running");
  assert.ok(state.looks[0].request.appUrl.startsWith("codex://new?"));
  await store.attachPreview(request.id, await png());
  fake.children[0].child.emit("close", 0); await runner.idle();
  assert.ok((await call(handler, "GET", base)).value.looks[0].preview);
});
