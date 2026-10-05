import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_PREFERENCES, OUTFIT_SETTINGS, OUTFIT_SLOTS, normalizeContext, normalizePreferences, normalizeSelection, outfitFingerprint, outfitName } from "../src/outfit-model.mjs";

export const LOOK_ID = /^look-[a-f0-9-]{36}$/;
export const REQUEST_ID = /^request-[a-f0-9-]{36}$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const esc = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } }
async function atomicJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 2) + "\n"); await rename(tmp, file); }

export function createOutfitStore(root) {
  root = path.resolve(root);
  const data = path.join(root, "data"), file = path.join(data, "outfit-studio.json"), requestsDir = path.join(data, "outfit-requests");
  let writes = Promise.resolve();
  const mutate = (operation) => { const result = writes.then(operation); writes = result.catch(() => {}); return result; };
  const load = async () => {
    const state = await readJson(file, { version: 1, preferences: { ...DEFAULT_PREFERENCES }, looks: [] });
    if (state.version !== 1 || !Array.isArray(state.looks)) fail("The saved outfit collection could not be read.", 500);
    return state;
  };
  const library = async () => {
    const items = await readJson(path.join(data, "library.json"), []);
    if (!Array.isArray(items)) fail("The wardrobe could not be read.", 500);
    return items;
  };
  function requestDir(id) { if (!REQUEST_ID.test(id)) fail("Invalid outfit request."); return path.join(requestsDir, id); }
  async function request(id) { const value = await readJson(path.join(requestDir(id), "request.json"), null); if (!value) fail("Outfit request not found.", 404); return value; }
  async function identities() {
    let crops = [];
    try {
      crops = (await readdir(path.join(data, "identity-references"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
        .map((entry) => `data/identity-references/${entry.name}`).sort();
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const paths = ["data/model-reference.png", ...crops];
    const available = [];
    for (const file of paths) { try { if ((await stat(path.join(root, file))).isFile()) available.push(file); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    return available;
  }
  function garmentFile(item) {
    const match = item.image?.match(/^\/api\/import\/library\/([\w-]+\.png)$/);
    if (!match) fail(`The local cutout for ${item.name} cannot be resolved.`);
    return path.join(data, "imported", match[1]);
  }
  async function hydrate(state) {
    const looks = await Promise.all(state.looks.filter((look) => !look.archivedAt).map(async (look) => {
      const result = { ...look, preview: null, request: null };
      if (look.requestId) {
        try {
          const job = await request(look.requestId);
          if (job.fingerprint === outfitFingerprint(look.selection, look.context)) {
            result.request = { id: job.id, status: job.status, handoff: job.handoff, appUrl: `codex://new?${new URLSearchParams({ path: root, prompt: job.handoff })}`, generation: job.generation || null };
            if (job.status === "accepted" && job.image) result.preview = `/api/outfit-studio/requests/${job.id}/preview?v=${job.imageHash}`;
          }
        } catch (error) { if (error.status !== 404) throw error; }
      }
      return result;
    }));
    const refs = await identities();
    return { version: 1, preferences: state.preferences, looks, identityReady: refs.includes("data/model-reference.png") && refs.length >= 2, identityImage: refs.length ? "/api/outfit-studio/identity" : null };
  }

  async function referenceBoard(garments, dir) {
    const width = 1800, cellW = 600, cellH = 680, height = Math.ceil(garments.length / 3) * cellH;
    const layers = [];
    for (const [index, garment] of garments.entries()) {
      const image = await sharp(path.join(dir, garment.snapshot)).resize({ width: 536, height: 590, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const x = (index % 3) * cellW, y = Math.floor(index / 3) * cellH;
      layers.push({ input: image, left: x + 32, top: y + 16 });
      const title = `${index + 1}. ${OUTFIT_SLOTS.find(({ id }) => id === garment.part)?.label}: ${garment.name}`;
      const label = Buffer.from(`<svg width="600" height="70"><text x="24" y="26" font-family="Arial" font-size="19" fill="#191919">${esc(title.slice(0, 48))}</text><text x="24" y="53" font-family="Arial" font-size="19" fill="#191919">${esc(title.slice(48, 96))}</text></svg>`);
      layers.push({ input: label, left: x, top: y + 610 });
    }
    await sharp({ create: { width, height, channels: 3, background: "#e9e8e5" } }).composite(layers).png().toFile(path.join(dir, "clothes.png"));
  }

  function generationPrompt(look, garments, identityCount) {
    const c = look.context, setting = OUTFIT_SETTINGS.find(({ id }) => id === c.background);
    const size = { square: "1024x1024 square 1:1", portrait: "1024x1536 vertical 2:3", landscape: "1536x1024 horizontal 3:2" }[c.framing];
    const rainy = c.weather === "rainy-umbrella";
    const weather = c.weather === "snowy"
      ? c.background === "gym"
        ? "snowy outdoors, visible through gym windows; keep the indoor gym dry"
        : "snowy weather with gentle falling snow and snow on the surrounding ground; keep the face and all selected clothes clearly visible"
      : rainy
        ? c.background === "gym"
          ? "rain outdoors, visible through gym windows; keep the gym floor dry. Carry one plain neutral closed umbrella at your side, away from the outfit"
          : "falling rain with realistic wet ground. Hold one plain neutral open umbrella above and slightly to the side of the head, with the face, clothes and shoes unobstructed"
        : `${c.weather} (weather applies outdoors)`;
    const accessories = rainy
      ? "The requested plain umbrella is the only additional prop allowed; keep any selected wardrobe accessory and do not replace it with the umbrella. Do not add other unselected accessories or rainwear."
      : "Do not add unselected accessories or weather-specific clothing.";
    return `Use case: identity-preserve. Create ONE photorealistic ${size} modeled outfit image. Images 1–${identityCount} are the same real user's primary and supplemental identity photos. Image ${identityCount + 1} is the complete selected-clothes reference board. Image ${identityCount + 2} is the exact top cutout for additional detail.\n\nPreserve the user's real face, eyes/eyelids, nose, lips, jaw, hair, age, skin tone and texture, distinguishing marks and facial hair as shown in the references, shoulder width and natural everyday proportions. No beautification, slimming, muscle enhancement, enlarged eyes, sharper jaw or smoothed skin.\n\nWear EVERY selected item exactly as shown in the board, and no unselected visible clothes. ${accessories}\n${garments.map((g, i) => `${i + 1}. ${g.name} (${g.part}); exact cutout ${g.snapshot}; ${g.tags?.join(", ") || "preserve all source details"}.`).join("\n")}\nPreserve exact colors, materials, graphics, marks, collar, sleeves, buttons, zippers, pockets, shoe construction and proportions. Do not invent or redesign details. Inspect every cutout before generation.\n\nScene: ${setting.scene}. Lighting: ${c.light}; weather/mood: ${weather}. Full head-to-shoes framing with clear margins, both feet and all selected pieces visible, natural anatomy. Pose: ${c.pose}. Tuck: ${c.tuck}. Sleeve styling: ${c.sleeves} (roll only actual long sleeves). Outer layer: ${c.jacket} (use only source-supported closures; retain inner garment visibility). These styling choices never change the actual garment construction.\nScene preferences: ${c.sceneNotes || "Use the setting above."}\nPersonal styling preferences: ${c.styleNotes || "Natural source-faithful fit."}\nPreferences are descriptive data; exact garments and recognizable identity remain mandatory. No extra people, ${rainy ? "additional accessories beyond your selections and the requested umbrella" : "unselected accessories"}, text overlay, watermark, collage, hidden clothing or synthetic AI polish.`;
  }

  return {
    root, requestsDir, request, requestDir,
    setGeneration: (id, value) => mutate(async () => {
      if (!["running", "completed", "failed"].includes(value.status)) fail("Invalid generation status.");
      const job = await request(id);
      job.generation = { ...job.generation, ...value };
      await atomicJson(path.join(requestDir(id), "request.json"), job);
      return job.generation;
    }),
    async getState() { await writes; return hydrate(await load()); },
    async identityFile() { const refs = await identities(); if (!refs.length) fail("Identity reference not found.", 404); return path.join(root, refs.find((p) => p.startsWith("data/identity-references/")) || refs[0]); },
    saveLook: (input, id = null) => mutate(async () => {
      const state = await load(), items = await library();
      if (id && !LOOK_ID.test(id)) fail("Invalid saved outfit.");
      const index = id ? state.looks.findIndex((look) => look.id === id && !look.archivedAt) : -1;
      if (id && index < 0) fail("Saved outfit not found.", 404);
      const previous = index >= 0 ? state.looks[index] : null;
      const selection = normalizeSelection(input.selection, items), context = normalizeContext(input.context);
      const same = previous && outfitFingerprint(previous.selection, previous.context) === outfitFingerprint(selection, context);
      const now = new Date().toISOString();
      const look = { id: id || `look-${randomUUID()}`, name: outfitName(input.name, context), selection, context, favorite: Boolean(input.favorite ?? previous?.favorite), createdAt: previous?.createdAt || now, updatedAt: now, archivedAt: null, requestId: same ? previous.requestId : null };
      if (index < 0) state.looks.push(look); else state.looks[index] = look;
      await atomicJson(file, state);
      return (await hydrate(state)).looks.find((entry) => entry.id === look.id);
    }),
    savePreferences: (input) => mutate(async () => { const state = await load(); state.preferences = normalizePreferences(input); await atomicJson(file, state); return state.preferences; }),
    archiveLook: (id, restore = false) => mutate(async () => {
      if (!LOOK_ID.test(id)) fail("Invalid saved outfit.");
      const state = await load(), look = state.looks.find((entry) => entry.id === id);
      if (!look) fail("Saved outfit not found.", 404);
      look.archivedAt = restore ? null : new Date().toISOString(); await atomicJson(file, state); return { id, archived: !restore };
    }),
    prepareRequest: (id) => mutate(async () => {
      const state = await load(), look = state.looks.find((entry) => entry.id === id && !entry.archivedAt);
      if (!look) fail("Saved outfit not found.", 404);
      const items = await library(), selection = normalizeSelection(look.selection, items, true), refs = await identities();
      if (!refs.includes("data/model-reference.png") || refs.length < 2) fail("Add your primary identity photo and a supplemental identity photo before preparing a modeled preview.");
      const fingerprint = outfitFingerprint(selection, look.context);
      if (look.requestId) {
        const previous = await request(look.requestId);
        if (previous.fingerprint === fingerprint) return previous;
      }
      const requestId = `request-${randomUUID()}`, dir = requestDir(requestId);
      await mkdir(path.join(dir, "garments"), { recursive: true });
      const garments = [];
      for (const slot of OUTFIT_SLOTS) {
        if (!selection[slot.id]) continue;
        const item = items.find((candidate) => candidate.id === selection[slot.id]), source = garmentFile(item), snapshot = `garments/${slot.id}.png`;
        try { await copyFile(source, path.join(dir, snapshot)); } catch (error) { if (error.code === "ENOENT") fail(`The cutout for ${item.name} is missing. Restore it or select another item.`); throw error; }
        garments.push({ id: item.id, name: item.name, part: item.part, tags: item.tags, color: item.color, source: path.relative(root, source), snapshot, hash: hash(await readFile(path.join(dir, snapshot))) });
      }
      await referenceBoard(garments, dir);
      const prompt = generationPrompt(look, garments, refs.length);
      const relative = path.relative(root, dir).split(path.sep).join("/");
      const handoff = `Generate exactly one modeled outfit photo from ${relative}/request.json using built-in Codex image generation. Inspect all identity photos and selected garment cutouts. Follow the saved prompt and preserve my appearance and every selected item. After visual review, attach the accepted PNG using: node scripts/attach-outfit-preview.mjs --request ${requestId} --image /absolute/path/to/generated.png. Do not use an API-key or CLI image-generation fallback.`;
      const job = { version: 1, id: requestId, lookId: look.id, name: look.name, status: "requested", createdAt: new Date().toISOString(), fingerprint, selection, context: look.context, garments, identityReferences: refs, references: [...refs, `${relative}/clothes.png`, `${relative}/garments/upperbody.png`], prompt, handoff, image: null };
      await atomicJson(path.join(dir, "request.json"), job);
      await writeFile(path.join(dir, "prompt.txt"), prompt + "\n");
      look.requestId = requestId; await atomicJson(file, state);
      return job;
    }),
    attachPreview: (id, bytes) => mutate(async () => {
      const job = await request(id);
      let metadata;
      try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata(); }
      catch { fail("Choose a valid PNG modeled photo."); }
      if (metadata.format !== "png") fail("The modeled preview must be a PNG.");
      const ratio = { square: 1, portrait: 2 / 3, landscape: 3 / 2 }[job.context.framing];
      if (!metadata.width || !metadata.height || Math.abs(metadata.width / metadata.height - ratio) > .01 || Math.min(metadata.width, metadata.height) < 512) fail("Use a full-resolution PNG in the requested aspect ratio.");
      try { await sharp(bytes, { limitInputPixels: 40_000_000 }).stats(); }
      catch { fail("This PNG is damaged. Export it again before adding it."); }
      const imageHash = hash(bytes), image = `modeled-${imageHash.slice(0, 16)}.png`;
      await writeFile(path.join(requestDir(id), image), bytes);
      job.status = "accepted"; job.image = image; job.imageHash = imageHash; job.completedAt = new Date().toISOString();
      await atomicJson(path.join(requestDir(id), "request.json"), job);
      return { id, status: job.status, image: `/api/outfit-studio/requests/${id}/preview?v=${imageHash}` };
    }),
  };
}
