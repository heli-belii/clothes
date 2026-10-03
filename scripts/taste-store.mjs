import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { TASTE_DEFAULTS, TASTE_CATEGORIES, normalizeTastePreferences, tastePreferenceKey, tasteViewKey, wardrobeView } from "../src/taste-model.mjs";

export const TASTE_JOB_ID = /^taste-[a-f0-9-]{36}$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const str = { type: "string" }, strings = { type: "array", items: str };
const array = (items) => ({ type: "array", items });
const record = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const category = { type: "string", enum: Object.keys(TASTE_CATEGORIES) };
export const ANALYSIS_SCHEMA = record({ summary: str, styles: array(record({ name: str, strength: { type: "string", enum: ["primary", "secondary", "accent"] }, description: str, evidenceIds: strings })), palette: array(record({ name: str, color: str, role: { type: "string", enum: ["base", "accent"] }, itemIds: strings })), combinations: array(record({ name: str, colors: strings, itemIds: strings, reason: str, fitNote: str })), gaps: array(record({ category, suggestion: str, reason: str, priority: { type: "string", enum: ["high", "medium", "low"] } })), notes: strings });
export const SHOPPING_SCHEMA = record({ summary: str, recommendations: array(record({ brand: str, name: str, category, color: str, fit: str, price: { type: "number" }, currency: str, url: str, sourceTitle: str, availability: str, reason: str, pairsWithIds: strings, styling: str, direction: { type: "string", enum: ["match", "explore"] } })), notes: strings });

function validateSchema(value, schema) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) fail("Codex returned an invalid Taste result.");
    for (const key of schema.required) validateSchema(value[key], schema.properties[key]);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 50) fail("Codex returned an invalid Taste list.");
    for (const entry of value) validateSchema(entry, schema.items);
  } else if (typeof value !== schema.type || (schema.type === "number" && !Number.isFinite(value)) || (schema.type === "string" && value.length > 6000) || (schema.enum && !schema.enum.includes(value))) fail("Codex returned an invalid Taste field.");
}
function owned(ids, job, minimum = 1) {
  if (ids.length < minimum || ids.length > 8 || new Set(ids).size !== ids.length || ids.some((id) => !job.wardrobe.some((item) => item.id === id))) fail("Codex referenced clothes outside this wardrobe. Retry the request.");
}
function safeProductUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hostname.includes(":") && !/^(?:localhost|\d+(?:\.\d+){3})$/.test(u.hostname) && !/\.(?:local|test|invalid)$/.test(u.hostname);
  } catch { return false; }
}
export function validateTasteResult(value, job) {
  validateSchema(value, job.kind === "analysis" ? ANALYSIS_SCHEMA : SHOPPING_SCHEMA);
  if (!value.summary.trim()) fail("Codex returned an empty Taste summary.");
  if (job.kind === "analysis") {
    if (!value.styles.length || value.styles.length > 5 || !value.palette.length || value.palette.length > 8 || value.combinations.length > 6 || value.gaps.length > 6) fail("Codex returned an incomplete style profile.");
    for (const style of value.styles) owned(style.evidenceIds, job);
    for (const color of value.palette) { if (!/^#[a-f0-9]{6}$/i.test(color.color)) fail("Codex returned an invalid palette color."); owned(color.itemIds, job); }
    for (const combo of value.combinations) { owned(combo.itemIds, job, 2); if (combo.colors.length < 2 || combo.colors.length > 5 || combo.colors.some((c) => !/^#[a-f0-9]{6}$/i.test(c))) fail("Codex returned an invalid color combination."); }
  } else {
    if (value.recommendations.length > 8) fail("Codex returned too many recommendations.");
    const urls = new Set();
    for (const item of value.recommendations) {
      if (!item.brand.trim() || !item.name.trim() || !item.sourceTitle.trim() || !safeProductUrl(item.url) || urls.has(item.url)) fail("Codex returned an invalid or duplicate product link.");
      urls.add(item.url);
      if (item.currency !== job.preferences.currency || item.price < job.preferences.minPrice || item.price > job.preferences.maxPrice) fail("Codex returned a product outside your chosen price range. Retry with this budget.");
      owned(item.pairsWithIds, job);
    }
  }
  return value;
}

async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; } }
async function atomicJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + "\n"); await rename(temporary, file); }
const escapeXml = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));

export function createTasteStore(root) {
  root = path.resolve(root);
  const data = path.join(root, "data"), directory = path.join(data, "taste"), file = path.join(directory, "state.json");
  let writes = Promise.resolve();
  const cache = new Map();
  const mutate = (operation) => { const result = writes.then(operation); writes = result.catch(() => {}); return result; };
  const load = async () => {
    const state = await readJson(file, { version: 1, preferences: TASTE_DEFAULTS, analysisId: null, shoppingId: null, latestJobId: null });
    if (state.version !== 1) fail("The saved Taste collection could not be read.", 500);
    return state;
  };
  function jobDir(id) { if (!TASTE_JOB_ID.test(id)) fail("Invalid Taste request."); return path.join(directory, id); }
  async function job(id) { const value = await readJson(path.join(jobDir(id), "request.json"), null); if (!value) fail("Taste request not found.", 404); return value; }
  function cutout(item) {
    const match = item.image?.match(/^\/api\/import\/library\/([\w-]+\.png)$/);
    if (!match) fail(`The local clothing photo for ${item.name} is missing.`);
    return path.join(data, "imported", match[1]);
  }
  async function inventory() {
    const items = await readJson(path.join(data, "library.json"), []);
    if (!Array.isArray(items)) fail("The wardrobe could not be read.", 500);
    const entries = await Promise.all(items.map(async (item) => {
      if (typeof item.id !== "string" || typeof item.name !== "string" || !TASTE_CATEGORIES[item.part]) fail("A wardrobe item could not be read.");
      const image = cutout(item);
      let metadata;
      try { metadata = await stat(image); } catch (e) { if (e.code === "ENOENT") fail(`The clothing photo for ${item.name} is missing. Restore it before analyzing Taste.`); throw e; }
      const signature = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
      let cached = cache.get(image);
      if (cached?.signature !== signature) { cached = { signature, hash: hash(await readFile(image)) }; cache.set(image, cached); }
      return { ...wardrobeView([item])[0], image: item.image, imageHash: cached.hash };
    }));
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return { items: entries, fingerprint: hash(JSON.stringify(entries)) };
  }
  async function getState() {
    await writes;
    const state = await load(), current = await inventory();
    const [analysis, shopping, latest] = await Promise.all([state.analysisId, state.shoppingId, state.latestJobId].map((id) => id ? job(id) : null));
    return { preferences: state.preferences, wardrobe: current.items, analysis: analysis ? { id: analysis.id, completedAt: analysis.finishedAt, wardrobe: analysis.wardrobe, viewKey: analysis.viewKey, result: analysis.result } : null, shopping: shopping ? { id: shopping.id, completedAt: shopping.finishedAt, preferences: shopping.preferences, result: shopping.result } : null, analysisStale: Boolean(analysis && analysis.fingerprint !== current.fingerprint), shoppingStale: Boolean(shopping && (shopping.fingerprint !== current.fingerprint || shopping.analysisId !== state.analysisId || tastePreferenceKey(shopping.preferences) !== tastePreferenceKey(state.preferences))), job: latest ? { id: latest.id, kind: latest.kind, status: latest.status, message: latest.message, pid: latest.pid, startedAt: latest.startedAt } : null };
  }
  async function boards(items, dir) {
    const pages = [];
    for (let start = 0; start < items.length; start += 12) {
      const page = items.slice(start, start + 12), layers = [], height = Math.ceil(page.length / 3) * 440;
      for (const [index, item] of page.entries()) {
        const snapshot = `garments/piece-${String(start + index + 1).padStart(3, "0")}.png`;
        await copyFile(cutout(item), path.join(dir, snapshot));
        item.snapshot = snapshot;
        if (hash(await readFile(path.join(dir, snapshot))) !== item.imageHash) fail("The wardrobe changed while compiling it. Reload and try again.", 409);
        const input = await sharp(path.join(dir, snapshot)).resize({ width: 330, height: 350, fit: "contain", background: "#eae6dd" }).png().toBuffer();
        const x = index % 3 * 360, y = Math.floor(index / 3) * 440;
        layers.push({ input, left: x + 15, top: y + 10 });
        const text = `${start + index + 1}. ${item.name}`;
        const label = Buffer.from(`<svg width="360" height="80"><text x="12" y="25" font-family="Arial" font-size="14" fill="#191919">${escapeXml(text.slice(0, 43))}</text><text x="12" y="47" font-family="Arial" font-size="14" fill="#191919">${escapeXml(text.slice(43, 86))}</text></svg>`);
        layers.push({ input: label, left: x, top: y + 363 });
      }
      const name = `wardrobe-${pages.length + 1}.png`;
      await sharp({ create: { width: 1080, height, channels: 3, background: "#eae6dd" } }).composite(layers).png().toFile(path.join(dir, name));
      pages.push(name);
    }
    return pages;
  }
  return {
    root, job, jobDir, getState,
    prepare: (kind, preferences, view = null) => mutate(async () => {
      if (!["analysis", "shopping"].includes(kind)) fail("Choose analysis or recommendations.");
      const prefs = normalizeTastePreferences(preferences), state = await load(), current = await inventory();
      if (!current.items.length) fail("Add clothes to your wardrobe before identifying your taste.");
      if (state.latestJobId) {
        const latest = await job(state.latestJobId);
        if (["pending", "running"].includes(latest.status)) {
          if (latest.kind === kind && tastePreferenceKey(latest.preferences) === tastePreferenceKey(prefs)) return latest;
          fail("Taste is already working on a request. Wait for it to finish.", 409);
        }
      }
      let analysis = state.analysisId ? await job(state.analysisId) : null;
      if (kind === "shopping" && (!analysis || analysis.fingerprint !== current.fingerprint)) fail("Identify your latest wardrobe style before requesting recommendations.", 409);
      const items = current.items.map((item) => ({ ...item }));
      if (view !== null) {
        if (!Array.isArray(view) || view.some((entry) => !entry || typeof entry.id !== "string") || JSON.stringify(view.map((i) => i.id).sort()) !== JSON.stringify(items.map((i) => i.id).sort())) fail("Your wardrobe changed. Reload it before identifying your style.", 409);
        for (const item of items) {
          const edit = view.find((entry) => entry.id === item.id);
          if (typeof edit.name !== "string" || !edit.name.trim() || edit.name.length > 160 || !TASTE_CATEGORIES[edit.part] || !Array.isArray(edit.tags) || edit.tags.length > 30 || edit.tags.some((tag) => typeof tag !== "string" || tag.length > 100) || [edit.color, edit.secondaryColor].some((color) => color && !/^#[a-f0-9]{6}$/i.test(color))) fail("A clothing description or color is invalid.");
          Object.assign(item, { name: edit.name, part: edit.part, tags: edit.tags, color: edit.color || null, secondaryColor: edit.secondaryColor || null });
        }
      }
      if (kind === "shopping" && tasteViewKey(items) !== analysis.viewKey) fail("Your clothing descriptions changed. Identify your style again before shopping.", 409);
      const id = `taste-${randomUUID()}`, dir = jobDir(id);
      await mkdir(path.join(dir, "garments"), { recursive: true });
      const references = kind === "analysis" ? await boards(items, dir) : [];
      const brief = { kind, preferences: prefs, wardrobe: items, analysis: kind === "shopping" ? analysis.result : null, requestedAt: new Date().toISOString() };
      await atomicJson(path.join(dir, "brief.json"), brief);
      await atomicJson(path.join(dir, "schema.json"), kind === "analysis" ? ANALYSIS_SCHEMA : SHOPPING_SCHEMA);
      const value = { version: 1, id, kind, status: "pending", message: "Preparing your request…", createdAt: brief.requestedAt, fingerprint: current.fingerprint, viewKey: tasteViewKey(items), wardrobe: items, preferences: prefs, references, analysisId: kind === "shopping" ? analysis.id : null, pid: null, result: null };
      await atomicJson(path.join(dir, "request.json"), value);
      state.preferences = prefs; state.latestJobId = id;
      await atomicJson(file, state);
      return value;
    }),
    updateJob: (id, update) => mutate(async () => { const value = await job(id); Object.assign(value, update); await atomicJson(path.join(jobDir(id), "request.json"), value); return value; }),
    accept: (id, result) => mutate(async () => {
      const value = await job(id), state = await load();
      validateTasteResult(result, value);
      Object.assign(value, { result, status: "completed", message: value.kind === "analysis" ? "Your style profile is ready." : "Your recommendations are ready.", finishedAt: new Date().toISOString(), pid: null });
      await atomicJson(path.join(jobDir(id), "request.json"), value);
      state[value.kind === "analysis" ? "analysisId" : "shoppingId"] = id;
      await atomicJson(file, state);
      return value;
    }),
  };
}
