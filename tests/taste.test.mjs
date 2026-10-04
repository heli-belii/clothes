import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { TASTE_DEFAULTS, normalizeTastePreferences, wardrobeView } from "../src/taste-model.mjs";
import { createTasteStore, validateTasteResult } from "../scripts/taste-store.mjs";
import { createCodexTasteRunner } from "../scripts/codex-taste-runner.mjs";
import { createTasteHandler } from "../scripts/taste-api.mjs";

async function fixture(t, count = 3) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-taste-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data/imported"), { recursive: true });
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#587282" } }).png().toBuffer();
  const items = Array.from({ length: count }, (_, i) => ({ id: `piece-${i}`, name: `Owned piece ${i}`, part: ["upperbody", "lowerbody", "shoes"][i % 3], color: "#587282", tags: ["relaxed"], image: `/api/import/library/piece-${i}.png` }));
  for (const item of items) await writeFile(path.join(root, "data/imported", `${item.id}.png`), bytes);
  await writeFile(path.join(root, "data/library.json"), JSON.stringify(items));
  return { root, items, bytes, store: createTasteStore(root) };
}
function profile(job) {
  return { summary: "Relaxed neutrals with sporty influences.", styles: [{ name: "Casual sportswear", strength: "primary", description: "Observed relaxed shapes; taste is inferred.", evidenceIds: [job.wardrobe[0].id] }], palette: [{ name: "Blue", color: "#587282", role: "base", itemIds: [job.wardrobe[0].id] }], combinations: job.wardrobe.length > 1 ? [{ name: "Tonal blue", colors: ["#587282", "#ffffff"], itemIds: job.wardrobe.slice(0, 2).map(i=>i.id), reason: "Light/dark contrast.", fitNote: "Relaxed proportions." }] : [], gaps: [{ category: "lowerbody", suggestion: "Chinos", reason: "More combinations with existing tops.", priority: "high" }], notes: ["Only imported clothing is represented."] };
}
function products(job) {
  return { summary: "A useful addition to your sporty wardrobe.", recommendations: [{ brand: "Example", name: "Relaxed chinos", category: "lowerbody", color: "Stone", fit: "Relaxed", price: 65, currency: job.preferences.currency, url: "https://example.com/products/chinos", sourceTitle: "Example chinos product page", availability: "Check your size", reason: "The neutral color matches your blue tops.", pairsWithIds: [job.wardrobe[0].id], styling: "Wear with your existing top and shoes.", direction: "match" }], notes: [] };
}
function fakeCodex(auth = "Logged in using ChatGPT") {
  const children = [];
  return { children, execute: async () => ({ stdout: auth, stderr: "" }), spawn(command, args, options) {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 40000 + children.length, prompt: "" });
    child.stdin.on("data", bytes => { child.prompt += bytes; });
    child.kill = () => { queueMicrotask(() => child.emit("close", 143)); return true; };
    children.push({ child, command, args, options }); return child;
  } };
}
async function finish(runner, fake, result, searched = false) {
  const { child, args } = fake.children.at(-1);
  await writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(result));
  if (searched) child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "web_search" } }) + "\n");
  child.emit("close", 0); await runner.idle();
}
async function call(handler, method, url, payload, metadata = {}) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))]);
  Object.assign(req, { method, url, ...metadata }); const result = { status: 200, headers: {} };
  await handler(req, { set statusCode(status) { result.status = status; }, setHeader(key,value) { result.headers[key] = value; }, end(value) { result.body = JSON.parse(value); } }, () => { result.next = true; });
  return result;
}

test("shopping preferences validate price bounds and retain the user's favorite shops", () => {
  assert.match(TASTE_DEFAULTS.shops, /FILA.*Abercrombie.*lululemon.*Nike/);
  assert.equal(normalizeTastePreferences().direction, "balanced");
  for (const prefs of [{ minPrice: 200, maxPrice: 100 }, { maxPrice: NaN }, { maxPrice: "50" }, { currency: "UNKNOWN" }, { direction: "anything" }, { region: "" }]) assert.throws(() => normalizeTastePreferences(prefs));
  assert.equal(normalizeTastePreferences({ minPrice: 25, maxPrice: 200 }).minPrice, 25);
});

test("analysis compiles every garment, honors browser edits and freezes source cutouts", async (t) => {
  const { store, items, bytes, root } = await fixture(t, 13), view = wardrobeView(items);
  view[0].name = "My corrected shirt"; view[0].part = "wholebody_up";
  const job = await store.prepare("analysis", TASTE_DEFAULTS, view);
  assert.equal(job.references.length, 2); assert.equal(job.wardrobe.length, 13);
  assert.equal(job.wardrobe.find(i=>i.id===view[0].id).name, "My corrected shirt");
  assert.equal(job.wardrobe.find(i=>i.id===view[0].id).part, "wholebody_up");
  for (const item of job.wardrobe) assert.deepEqual(await readFile(path.join(store.jobDir(job.id), item.snapshot)), bytes);
  await store.accept(job.id, profile(job));
  const changed = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ff0000" } }).png().toBuffer();
  await writeFile(path.join(root, "data/imported/piece-0.png"), changed);
  assert.equal((await store.getState()).analysisStale, true);
  assert.deepEqual(await readFile(path.join(store.jobDir(job.id), job.wardrobe.find(i=>i.id==='piece-0').snapshot)), bytes);
  assert.equal(JSON.parse(await readFile(path.join(root, "data/library.json"))).find(i=>i.id===view[0].id).name, "Owned piece 0");
});

test("new or changed garments require re-identification; saved recommendations become stale", async (t) => {
  const { store, items, root, bytes } = await fixture(t);
  await assert.rejects(store.prepare("shopping", TASTE_DEFAULTS), /Identify your latest/);
  const analysis = await store.prepare("analysis", TASTE_DEFAULTS); await store.accept(analysis.id, profile(analysis));
  const shopping = await store.prepare("shopping", TASTE_DEFAULTS); await store.accept(shopping.id, products(shopping));
  assert.equal((await store.getState()).shoppingStale, false);
  const reidentified = await store.prepare("analysis", { ...TASTE_DEFAULTS, maxPrice: 200 }); await store.accept(reidentified.id, profile(reidentified));
  assert.equal((await store.getState()).shoppingStale, true);
  items.push({ ...items[0], id: "new-piece", image: "/api/import/library/new-piece.png" });
  await writeFile(path.join(root, "data/imported/new-piece.png"), bytes); await writeFile(path.join(root, "data/library.json"), JSON.stringify(items));
  assert.equal((await store.getState()).analysisStale, true);
  await assert.rejects(store.prepare("shopping", TASTE_DEFAULTS), /Identify your latest/);
  await assert.rejects(store.prepare("analysis", TASTE_DEFAULTS, wardrobeView(items.slice(0,-1))), /wardrobe changed/);
});

test("invalid AI evidence, URLs, currencies and over-budget products never replace accepted results", async (t) => {
  const { store } = await fixture(t);
  const analysis = await store.prepare("analysis", TASTE_DEFAULTS), invalidProfile = profile(analysis);
  invalidProfile.styles[0].evidenceIds = ["unowned-gray-sweater"];
  await assert.rejects(store.accept(analysis.id, invalidProfile), /outside this wardrobe/);
  assert.equal((await store.getState()).analysis, null);
  await store.accept(analysis.id, profile(analysis));
  const job = await store.prepare("shopping", TASTE_DEFAULTS);
  for (const patch of [{ price: 101 }, { currency: "EUR" }, { pairsWithIds: ["not-owned"] }, { url: "javascript:alert(1)" }, { url: "https://127.0.0.1/product" }, { url: "https://user:password@example.com/product" }]) {
    const result = products(job); Object.assign(result.recommendations[0], patch);
    assert.throws(() => validateTasteResult(result, job));
  }
  await store.accept(job.id, products(job));
  const invalid = products(job); invalid.recommendations[0].price = 1000;
  await assert.rejects(store.accept(job.id, invalid), /price range/);
  assert.equal((await store.getState()).shopping.result.recommendations[0].price, 65);
});

test("Taste uses ChatGPT sign-in, compatible CLI options, frozen images and deduplicated launches", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex(), runner = createCodexTasteRunner(store, { ...fake, env: { PATH: "/bin", OPENAI_API_KEY: "fake", CODEX_API_KEY: "fake", CODEX_THREAD_ID: "parent" } }); t.after(() => runner.close());
  const job = await store.prepare("analysis", TASTE_DEFAULTS);
  await Promise.all([runner.start(job.id), runner.start(job.id), runner.start(job.id)]);
  assert.equal(fake.children.length, 1);
  const { args, options, child } = fake.children[0];
  assert.ok(args.includes("--approve-for-me")); assert.ok(!args.includes("--sandbox"));
  assert.ok(args.includes('forced_login_method="chatgpt"')); assert.ok(args.includes('web_search="disabled"'));
  assert.equal(args.filter(a=>a==='--image').length, 1); assert.ok(args.includes("--output-schema"));
  assert.equal(options.shell, false); assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.CODEX_API_KEY, undefined); assert.equal(options.env.CODEX_THREAD_ID, undefined);
  assert.match(child.prompt, /Do not generate images/);
  await finish(runner, fake, profile(job)); assert.equal((await store.getState()).job.status, "completed");
  await runner.start(job.id); assert.equal(fake.children.length, 1);
});

test("shopping requires live source verification and explicit retries", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex(), runner = createCodexTasteRunner(store, fake); t.after(() => runner.close());
  const analysis = await store.prepare("analysis", TASTE_DEFAULTS); await store.accept(analysis.id, profile(analysis));
  const shopping = await store.prepare("shopping", TASTE_DEFAULTS); await runner.start(shopping.id);
  assert.ok(fake.children[0].args.includes('web_search="live"'));
  assert.match(fake.children[0].child.prompt, /Web search is mandatory/);
  await finish(runner, fake, products(shopping));
  assert.equal((await store.getState()).shopping, null); assert.match((await store.getState()).job.message, /did not verify live/);
  const retry = await store.prepare("shopping", TASTE_DEFAULTS); await runner.start(retry.id); await finish(runner, fake, products(retry), true);
  assert.equal((await store.getState()).shopping.result.recommendations.length, 1);
});

test("API-key sign-in is refused and interrupted Taste jobs can be retried", async (t) => {
  const { store } = await fixture(t), fake = fakeCodex("Logged in using an API key"), runner = createCodexTasteRunner(store, fake);
  const job = await store.prepare("analysis", TASTE_DEFAULTS);
  await assert.rejects(runner.start(job.id), /ChatGPT/); assert.equal(fake.children.length, 0); await runner.close();
  await store.updateJob(job.id, { status: "running", pid: 999999 });
  const restarted = createCodexTasteRunner(store, { ...fakeCodex(), alive: () => false });
  await restarted.reconcile(); assert.equal((await store.getState()).job.status, "failed");
  const retry = await store.prepare("analysis", TASTE_DEFAULTS); assert.notEqual(retry.id, job.id); await restarted.close();
});

test("Taste HTTP routes do not launch on read and reject remote, cross-origin or malformed requests", async (t) => {
  const { store, items } = await fixture(t), fake = fakeCodex(), runner = createCodexTasteRunner(store, fake), handler = createTasteHandler(store, runner); t.after(() => runner.close());
  assert.equal((await call(handler, "GET", "/api/taste")).status, 200); assert.equal(fake.children.length, 0);
  assert.equal((await call(handler, "POST", "/api/taste/analyze", {}, { socket: { remoteAddress: "192.168.1.2" } })).status, 403);
  assert.equal((await call(handler, "POST", "/api/taste/analyze", {}, { headers: { origin: "https://other.example", host: "localhost:5173" } })).status, 403);
  assert.equal((await call(handler, "POST", "/api/taste/analyze", "[1]")).status, 400);
  assert.equal((await call(handler, "POST", "/api/taste/analyze", { wardrobe: [null] })).status, 409);
  const result = await call(handler, "POST", "/api/taste/analyze", { preferences: TASTE_DEFAULTS, wardrobe: wardrobeView(items) });
  assert.equal(result.status, 202); assert.equal(result.body.job.status, "running");
  assert.equal((await call(handler, "POST", "/api/taste/analyze", { preferences: TASTE_DEFAULTS, wardrobe: wardrobeView(items) })).body.job.id, result.body.job.id);
  assert.equal(fake.children.length, 1);
  const job = await store.job(result.body.job.id); await finish(runner, fake, profile(job));
  assert.equal((await call(handler, "GET", "/api/taste")).body.analysis.result.styles[0].name, "Casual sportswear");
});


test("Find recommendations refreshes style first, then automatically researches with the new profile", async (t) => {
  const { store, items } = await fixture(t), fake = fakeCodex(), runner = createCodexTasteRunner(store, fake);
  const handler = createTasteHandler(store, runner); t.after(() => runner.close());
  const previous = await store.prepare("analysis", TASTE_DEFAULTS);
  await store.accept(previous.id, profile(previous));
  const input = { preferences: { ...TASTE_DEFAULTS, maxPrice: 200 }, wardrobe: wardrobeView(items) };
  const requested = await call(handler, "POST", "/api/taste/recommend", input);
  assert.equal(requested.status, 202);
  assert.equal(requested.body.job.kind, "analysis");
  assert.equal(requested.body.job.recommendAfter, true);
  assert.notEqual(requested.body.job.id, previous.id);
  assert.equal(requested.body.analysis.id, previous.id);
  assert.equal(fake.children.length, 1);
  assert.equal((await call(handler, "POST", "/api/taste/recommend", input)).body.job.id, requested.body.job.id);
  const analysis = await store.job(requested.body.job.id);
  const refreshed = { ...profile(analysis), summary: "A freshly identified style." };
  await finish(runner, fake, refreshed);

  const researching = await store.getState();
  assert.equal(researching.job.kind, "shopping");
  assert.equal(researching.job.status, "running");
  assert.equal(fake.children.length, 2);
  const shopping = await store.job(researching.job.id);
  assert.equal(shopping.analysisId, analysis.id);
  assert.deepEqual(shopping.preferences, input.preferences);
  assert.deepEqual(shopping.references, []);
  const brief = JSON.parse(await readFile(path.join(store.jobDir(shopping.id), "brief.json")));
  assert.deepEqual(brief.analysis, refreshed);
  await finish(runner, fake, products(shopping), true);

  const after = (await call(handler, "GET", "/api/taste")).body;
  assert.equal(after.analysis.id, analysis.id);
  assert.equal(after.shopping.result.recommendations.length, 1);
  assert.equal(fake.children.length, 2);
});

test("a failed automatic style refresh does not start recommendation research", async (t) => {
  const { store, items } = await fixture(t), fake = fakeCodex(), runner = createCodexTasteRunner(store, fake);
  const handler = createTasteHandler(store, runner); t.after(() => runner.close());
  const response = await call(handler, "POST", "/api/taste/recommend", { preferences: TASTE_DEFAULTS, wardrobe: wardrobeView(items) });
  fake.children[0].child.emit("close", 1); await runner.idle();
  const state = await store.getState();
  assert.equal(state.job.id, response.body.job.id);
  assert.equal(state.job.status, "failed");
  assert.equal(state.job.recommendAfter, true);
  assert.equal(state.shopping, null);
  assert.equal(fake.children.length, 1);
});
