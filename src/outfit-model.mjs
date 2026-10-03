export const OUTFIT_SLOTS = [
  { id: "upperbody", label: "Top", plural: "Tops", required: true },
  { id: "lowerbody", label: "Bottoms", plural: "Bottoms", required: true },
  { id: "shoes", label: "Shoes", plural: "Shoes", required: true },
  { id: "wholebody_up", label: "Jacket", plural: "Jackets", required: false },
  { id: "accessories_up", label: "Accessory", plural: "Accessories", required: false },
];

export const OUTFIT_SETTINGS = [
  { id: "school", name: "School", description: "A quiet campus courtyard", scene: "a quiet school campus courtyard with warm stone buildings and restrained greenery" },
  { id: "hiking", name: "Hiking", description: "An open trail and natural scenery", scene: "an outdoor hiking trail with natural trees, low hills and an unobstructed foreground" },
  { id: "gym", name: "Gym", description: "A clean, understated training space", scene: "a clean indoor gym with unobtrusive equipment in the distance and open floor space" },
];

export const STYLE_OPTIONS = {
  framing: [["square", "Square"], ["portrait", "Vertical"], ["landscape", "Wide"]],
  pose: [["relaxed", "Relaxed standing"], ["front", "Facing the camera"], ["walking", "A natural walking pose"]],
  tuck: [["natural", "As photographed"], ["untucked", "Untucked"], ["tucked", "Tucked in"]],
  sleeves: [["natural", "As photographed"], ["down", "Sleeves down"], ["rolled", "Long sleeves rolled up"]],
  jacket: [["natural", "As photographed"], ["open", "Open"], ["closed", "Closed"]],
  light: [["daylight", "Soft daylight"], ["golden-hour", "Golden hour"], ["evening", "Evening light"]],
  weather: [["mild", "Mild"], ["warm", "Warm"], ["cool", "Cool"], ["overcast", "Overcast"]],
};

export const DEFAULT_PREFERENCES = { framing: "square", pose: "relaxed", tuck: "natural", sleeves: "natural", jacket: "natural", styleNotes: "" };
export const DEFAULT_CONTEXT = { background: "school", light: "daylight", weather: "mild", sceneNotes: "", ...DEFAULT_PREFERENCES };
export const emptySelection = () => Object.fromEntries(OUTFIT_SLOTS.map(({ id }) => [id, null]));

const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function normalizeContext(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Choose an outfit setting.");
  const context = { ...DEFAULT_CONTEXT };
  if (value.background !== undefined) {
    if (!OUTFIT_SETTINGS.some(({ id }) => id === value.background)) invalid("Choose school, hiking or gym.");
    context.background = value.background;
  }
  for (const [key, choices] of Object.entries(STYLE_OPTIONS)) {
    if (value[key] === undefined) continue;
    if (!choices.some(([id]) => id === value[key])) invalid(`Invalid ${key} choice.`);
    context[key] = value[key];
  }
  context.sceneNotes = text(value.sceneNotes, 1000);
  context.styleNotes = text(value.styleNotes, 1000);
  return context;
}

export function normalizePreferences(value = {}) {
  const context = normalizeContext(value);
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((key) => [key, context[key]]));
}

export function normalizeSelection(value, items, requireComplete = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Choose clothes for your outfit.");
  const selection = emptySelection(), seen = new Set();
  for (const slot of OUTFIT_SLOTS) {
    const id = value[slot.id];
    if (id === undefined || id === null || id === "") {
      if (requireComplete && slot.required) invalid(`Choose ${slot.label.toLowerCase()} before preparing a modeled preview.`);
      continue;
    }
    if (typeof id !== "string") invalid(`Choose one ${slot.label.toLowerCase()}.`);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) invalid(`A selected ${slot.label.toLowerCase()} is no longer in your wardrobe. Choose a replacement.`);
    if (item.part !== slot.id || seen.has(id)) invalid(`That item does not belong in the ${slot.label.toLowerCase()} slot.`);
    seen.add(id);
    selection[slot.id] = id;
  }
  return selection;
}

export function outfitFingerprint(selection, context) {
  return JSON.stringify({ selection: OUTFIT_SLOTS.map(({ id }) => selection[id] || null), context: normalizeContext(context) });
}

export function missingRequired(selection, items) {
  return OUTFIT_SLOTS.filter((slot) => slot.required && !items.some((item) => item.id === selection[slot.id] && item.part === slot.id));
}

export function outfitName(value, context) {
  return text(value, 120) || `${OUTFIT_SETTINGS.find(({ id }) => id === context.background)?.name || "My"} look`;
}
