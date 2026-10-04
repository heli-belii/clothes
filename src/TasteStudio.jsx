import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowUpRight, Palette, Sparkle } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { CURRENCIES, PRICE_PRESETS, TASTE_CATEGORIES, TASTE_DEFAULTS, normalizeTastePreferences, priceLabel, tastePreferenceKey, tasteViewKey, wardrobeView } from "./taste-model.mjs";
import "./taste.css";

async function api(route = "", options = {}) {
  const response = await fetch("/api/taste" + route, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Taste could not finish this request.");
  return value;
}
function Pieces({ ids, items }) {
  return <div className="taste-pieces">{ids.map((id) => {
    const item = items.find((entry) => entry.id === id);
    return item ? <div key={id}><OptimizedImage src={item.image} alt="" sizes="75px" /><span>{item.name}</span></div> : <p key={id}>A piece is no longer in your wardrobe.</p>;
  })}</div>;
}
function Swatches({ colors }) { return <div className="taste-swatches">{colors.map((color, i) => <span key={`${color}-${i}`} style={{ background: color }} title={color}><span className="sr-only">{color}</span></span>)}</div>; }

function ColorLanguage({ analysis, items, disabled, onAnalyze }) {
  if (!analysis) return <section className="taste-empty taste-panel"><Palette size={44} weight="light" /><h2>Discover the colors in your wardrobe</h2><p>Identify your style to see your palette and color combinations drawn from your own clothes.</p><button className="outfit-button is-primary" disabled={disabled} onClick={onAnalyze}><Sparkle size={17} />Identify my style</button></section>;
  return <div className="taste-main">
    <section className="taste-panel"><h2>Your wardrobe palette</h2><div className="taste-palette">{analysis.palette.map((color, i) => <div key={i}><span style={{ background: color.color }} /><strong>{color.name}</strong><small>{color.role} · {color.color.toUpperCase()}</small></div>)}</div></section>
    <section className="taste-panel"><h2>Color combinations</h2><div className="taste-combinations">{analysis.combinations.map((combo, i) => <article key={i}><Swatches colors={combo.colors} /><h3>{combo.name}</h3><p>{combo.reason}</p><p className="taste-fit">{combo.fitNote}</p><Pieces ids={combo.itemIds} items={items} /></article>)}</div></section>
  </div>;
}

export function TasteStudio({ items, active, page = "taste", refreshWardrobe }) {
  const [state, setState] = useState({ analysis: null, shopping: null, job: null, codex: null });
  const [preferences, setPreferences] = useState(TASTE_DEFAULTS);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const initialized = useRef(false);
  const load = useCallback(async (signal) => {
    const value = await api("", { signal }); setState(value); setReady(true);
    if (!initialized.current) { setPreferences(value.preferences); initialized.current = true; }
    return value;
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    Promise.all([load(controller.signal), refreshWardrobe()]).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [active, load, refreshWardrobe]);
  const working = ["pending", "running"].includes(state.job?.status);
  useEffect(() => {
    if (!active || !working) return undefined;
    const controller = new AbortController(), timer = setInterval(() => { load(controller.signal).catch((e) => { if (e.name !== "AbortError") setError(e.message); }); }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [active, working, load]);
  const validation = useMemo(() => { try { return { value: normalizeTastePreferences(preferences), error: "" }; } catch (e) { return { value: null, error: e.message }; } }, [preferences]);
  const analysis = state.analysis?.result, shopping = state.shopping?.result;
  const analysisStale = Boolean(state.analysis && (state.analysisStale || state.analysis.viewKey !== tasteViewKey(items)));
  const shoppingStale = state.shopping && (state.shoppingStale || analysisStale || !validation.value || tastePreferenceKey(state.shopping.preferences) !== tastePreferenceKey(validation.value));
  const disabled = Boolean(busy) || working || !ready || !state.codex?.available || !items.length;
  const change = (key, value) => setPreferences((p) => ({ ...p, [key]: value }));
  const run = async (kind) => {
    setBusy(kind); setError("");
    try {
      const wardrobe = await refreshWardrobe();
      const value = await api(kind === "analysis" ? "/analyze" : "/recommend", { method: "POST", body: JSON.stringify({ preferences: kind === "analysis" ? state.preferences || TASTE_DEFAULTS : validation.value, wardrobe: wardrobeView(wardrobe) }) });
      setState((previous) => ({ ...value, codex: previous.codex }));
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };
  const results = shopping?.recommendations.filter((item) => item.currency === preferences.currency && item.price >= preferences.minPrice && item.price <= preferences.maxPrice) || [];
  const colors = page === "color-language", recommendations = page === "recommendations";
  const recommendationJob = state.job?.kind === "shopping" || state.job?.recommendAfter;
  const relevantJob = recommendations ? recommendationJob : state.job?.kind === "analysis" && !state.job.recommendAfter;
  const content = <div className="taste-studio">
    <header className="taste-intro"><div><p className="taste-eyebrow">{colors ? "Your wardrobe, in color" : recommendations ? "New pieces, your taste" : "A wardrobe with a point of view"}</p><h1>{colors ? "Color language" : recommendations ? "Recommendations" : "Taste"}</h1><p>{colors ? "Explore your palette and find color combinations using the clothes you own." : recommendations ? "Find pieces that belong with what you already wear." : "An overview of the styles and influences in your wardrobe."}</p></div>{!recommendations && <button className="outfit-button" disabled={disabled} onClick={() => run("analysis")}><ArrowCounterClockwise size={17} />{busy === "analysis" || (working && state.job.kind === "analysis") ? "Identifying…" : analysis ? "Reload style" : "Identify my style"}</button>}</header>
    {error && <div className="taste-notice is-error" role="alert">{error}{!ready && <button className="outfit-text-button" onClick={() => load().then(() => setError("")).catch((e) => setError(e.message))}>Try again</button>}</div>}
    {working && relevantJob && <div className="taste-notice" role="status"><Sparkle size={20} /><span>{state.job.message}<small>You can leave this tab open; results appear automatically.</small></span></div>}
    {relevantJob && state.job?.status === "failed" && <div className="taste-notice is-error" role="alert">{state.job.message}<button className="outfit-button" disabled={disabled || (recommendationJob && Boolean(validation.error))} onClick={() => run(recommendationJob ? "shopping" : "analysis")}>Retry {recommendationJob ? "recommendations" : "style analysis"}</button></div>}
    {analysisStale && !recommendations && <div className="taste-notice">{colors ? "Your wardrobe has changed. Reload style to update your palette and color combinations." : "Your wardrobe has changed. Reload style to include your latest pieces before finding new recommendations."}</div>}
    {!ready ? <p className="taste-copy">Loading {colors ? "color language" : recommendations ? "recommendations" : "Taste"}…</p> : colors ? <ColorLanguage analysis={analysis} items={items} disabled={disabled} onAnalyze={() => run("analysis")} /> : <div className={recommendations ? "taste-workspace" : "taste-overview"}>
      <div className="taste-main" aria-busy={working}>
        {!recommendations && (!analysis ? <section className="taste-empty taste-panel"><Palette size={44} weight="light" /><h2>Your style starts with your clothes</h2><p>Codex will inspect a compilation of all {items.length} pieces, identify the styles and colors they share, and describe your wardrobe’s point of view.</p><button className="outfit-button is-primary" disabled={disabled} onClick={() => run("analysis")}><Sparkle size={17} />Identify my style</button></section> : <>
          <section className="taste-panel"><div className="taste-heading"><h2>Your style profile</h2><span>{state.analysis.wardrobe.length} pieces · {new Date(state.analysis.completedAt).toLocaleDateString()}</span></div><p className="taste-summary">{analysis.summary}</p><div className="taste-style-grid">{analysis.styles.map((style) => <article className="taste-style" key={style.name}><p className="taste-eyebrow">{style.strength} influence</p><h3>{style.name}</h3><p>{style.description}</p><Pieces ids={style.evidenceIds} items={items} /></article>)}</div>{analysis.notes.length > 0 && <ul className="taste-notes">{analysis.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}</section>
        </>)}
        {recommendations && <>
          {analysis?.gaps.length > 0 && <section className="taste-panel"><h2>What could round it out</h2><p className="taste-copy">Suggestions based on your imported collection.</p><div className="taste-gap-list">{analysis.gaps.map((gap, i) => <article key={i}><span>{String(i + 1).padStart(2, "0")}</span><div><h3>{gap.suggestion}</h3><p>{gap.reason}</p><small>{TASTE_CATEGORIES[gap.category]} · {gap.priority} priority</small></div></article>)}</div></section>}
        <section className="taste-panel taste-shopping"><div className="taste-heading"><h2>New pieces, your taste</h2>{state.shopping && <span>Prices checked {new Date(state.shopping.completedAt).toLocaleDateString()}</span>}</div>{shoppingStale && <p className="taste-inline-notice">These saved results use an earlier wardrobe or budget. {analysisStale ? "Find recommendations to refresh your style and results." : "Find recommendations to refresh them."}</p>}{shopping ? <><p className="taste-summary">{shopping.summary}</p><p className="taste-copy">Saved research: {priceLabel(state.shopping.preferences.minPrice, state.shopping.preferences.currency)}–{priceLabel(state.shopping.preferences.maxPrice, state.shopping.preferences.currency)} per item · {state.shopping.preferences.region}</p><div className="taste-products">{results.map((item) => <article className="taste-product" key={item.url}><div className="taste-heading"><p className="taste-eyebrow">{item.brand}</p><strong>{priceLabel(item.price, item.currency)}</strong></div><h3>{item.name}</h3><span className="taste-product-detail">{TASTE_CATEGORIES[item.category]} · {item.color} · {item.fit}</span><p>{item.reason}</p><p className="taste-fit">{item.styling}</p><Pieces ids={item.pairsWithIds} items={items} /><p className="taste-stock">{item.availability}{item.direction === "explore" ? " · A small style exploration" : ""}</p><a className="outfit-button" href={item.url} target="_blank" rel="noopener noreferrer">View at {item.brand}<ArrowUpRight size={15} /></a></article>)}</div>{!results.length && <p className="taste-copy">{shopping.recommendations.length ? "No saved recommendations match this price range. Find recommendations for your new budget." : "No products could be verified within these preferences. Adjust your budget or region and try again."}</p>}{shopping.notes.length > 0 && <ul className="taste-notes">{shopping.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}<p className="taste-copy">Prices exclude tax and shipping. Check your size and the current price on the product page.</p></> : <p className="taste-copy">Choose your price range and find specific pieces from brands that fit your taste. Your style will refresh automatically before research starts.</p>}</section>
        </>}
        {!recommendations && <details className="taste-panel taste-compilation"><summary>Your wardrobe, compiled <span>{items.length} pieces</span></summary><div className="taste-inventory">{items.map((item) => <article key={item.id}><OptimizedImage src={item.image} alt="" sizes="(max-width: 700px) 35vw, 160px" /><strong>{item.name}</strong><span>{TASTE_CATEGORIES[item.part]}</span></article>)}</div></details>}
      </div>
      {recommendations && <aside className="taste-panel taste-preferences" aria-label="Shopping preferences"><h2>Find your next piece</h2><fieldset disabled={Boolean(busy) || working}><legend className="sr-only">Shopping preferences</legend><div className="outfit-field"><span>Maximum per item</span><div className="taste-price-presets">{PRICE_PRESETS.map((price) => <button className="outfit-button" aria-pressed={preferences.maxPrice === price && preferences.minPrice === 0} key={price} onClick={() => setPreferences((p) => ({ ...p, minPrice: 0, maxPrice: price }))}>{priceLabel(price, preferences.currency)}</button>)}</div></div><div className="taste-price-fields"><label className="outfit-field"><span>Minimum</span><input type="number" min="0" max="10000" step="1" value={preferences.minPrice} onChange={(e) => change("minPrice", Number(e.target.value))} /></label><label className="outfit-field"><span>Maximum</span><input type="number" min="1" max="10000" step="1" value={preferences.maxPrice} onChange={(e) => change("maxPrice", Number(e.target.value))} /></label></div><label className="outfit-field"><span>Currency</span><select value={preferences.currency} onChange={(e) => change("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label><label className="outfit-field"><span>Shopping region</span><input value={preferences.region} maxLength={100} onChange={(e) => change("region", e.target.value)} placeholder="Country or region" /></label><label className="outfit-field"><span>How far to explore</span><select value={preferences.direction} onChange={(e) => change("direction", e.target.value)}><option value="balanced">My style, with a few new ideas</option><option value="close">Stay close to my current style</option><option value="explore">Explore more broadly</option></select></label><label className="outfit-field"><span>Favorite shops</span><input value={preferences.shops} maxLength={500} onChange={(e) => change("shops", e.target.value)} placeholder="Brands or stores you enjoy" /></label><label className="outfit-field"><span>Make it personal <small>Optional</small></span><textarea rows={4} maxLength={1500} value={preferences.notes} onChange={(e) => change("notes", e.target.value)} placeholder="Preferred fits, sizes, materials or brands to avoid…" /></label></fieldset>{validation.error && <p className="taste-copy is-error">{validation.error}</p>}<button className="outfit-button is-primary" disabled={disabled || Boolean(validation.error)} onClick={() => run("shopping")}><Sparkle size={17} />{busy === "shopping" || (working && recommendationJob) ? state.job?.recommendAfter ? "Refreshing style…" : "Researching…" : "Find recommendations"}</button><p className="taste-copy">AI actions use your signed-in ChatGPT Codex allowance. Find recommendations refreshes your style first, then researches pieces using your chosen preferences. Opening this tab or changing your budget does not start a new AI request.</p>{!state.codex?.available && state.codex?.reason && <p className="taste-copy is-error">{state.codex.reason}</p>}{!items.length && <p className="taste-copy">Import your first piece to get started.</p>}</aside>}
    </div>}
  </div>;
  return <>{["taste", "recommendations", "color-language"].map((tab) =>
    <div key={tab} id={`${tab}-panel`} role="tabpanel" aria-labelledby={`${tab}-tab`} hidden={page !== tab}>{page === tab && content}</div>
  )}</>;
}
