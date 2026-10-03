export const PRICE_PRESETS = [50, 100, 200, 400];
export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"];
export const TASTE_DEFAULTS = { minPrice: 0, maxPrice: 100, currency: "USD", region: "United States", direction: "balanced", shops: "FILA, Abercrombie & Fitch, lululemon, Nike", notes: "" };
export const TASTE_CATEGORIES = { upperbody: "Tops", lowerbody: "Bottoms", wholebody_up: "Jackets", shoes: "Shoes", accessories_up: "Accessories" };
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

export function normalizeTastePreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Choose valid shopping preferences.");
  const value = { ...TASTE_DEFAULTS, ...input };
  if (!Number.isFinite(value.minPrice) || !Number.isFinite(value.maxPrice) || value.minPrice < 0 || value.maxPrice < 1 || value.maxPrice > 10000 || value.minPrice > value.maxPrice) fail("Choose a price range between 0 and 10,000, with the minimum below the maximum.");
  if (!CURRENCIES.includes(value.currency)) fail("Choose a supported currency.");
  if (!["balanced", "close", "explore"].includes(value.direction)) fail("Choose how far to explore from your style.");
  if (typeof value.region !== "string" || !value.region.trim() || value.region.length > 100 || typeof value.shops !== "string" || value.shops.length > 500 || typeof value.notes !== "string" || value.notes.length > 1500) fail("Enter a shopping region, keep shops under 500 characters and personal preferences under 1,500 characters.");
  return { minPrice: value.minPrice, maxPrice: value.maxPrice, currency: value.currency, region: value.region.trim(), direction: value.direction, shops: value.shops.trim(), notes: value.notes.trim() };
}

export function wardrobeView(items) {
  return items.map((item) => ({ id: item.id, name: item.name, part: item.part, color: item.color || null, secondaryColor: item.secondaryColor || null, tags: item.tags || [] })).sort((a, b) => a.id.localeCompare(b.id));
}
export const tasteViewKey = (items) => JSON.stringify(wardrobeView(items));
export const tastePreferenceKey = (preferences) => JSON.stringify(normalizeTastePreferences(preferences));
export function priceLabel(value, currency) { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
