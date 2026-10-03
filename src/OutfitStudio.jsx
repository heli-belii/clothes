import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, BookmarkSimple, Check, Copy, GraduationCap, Mountains, Barbell, Plus, Sparkle, Star, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { DEFAULT_CONTEXT, DEFAULT_PREFERENCES, OUTFIT_SETTINGS, OUTFIT_SLOTS, STYLE_OPTIONS, emptySelection, missingRequired, normalizeContext, outfitFingerprint } from "./outfit-model.mjs";
import "./outfit-studio.css";

const API = "/api/outfit-studio", DRAFT_KEY = "open-wardrobe-outfit-draft-v1";
const SCENE_ICONS = { school: GraduationCap, hiking: Mountains, gym: Barbell };
const newDraft = (preferences = {}) => ({ lookId: null, name: "", selection: emptySelection(), context: { ...DEFAULT_CONTEXT, ...preferences }, favorite: false });
function readDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!value?.selection || typeof value.selection !== "object" || Array.isArray(value.selection)) return null;
    const selection = Object.fromEntries(OUTFIT_SLOTS.map(({ id }) => [id, typeof value.selection[id] === "string" ? value.selection[id] : null]));
    return { lookId: typeof value.lookId === "string" ? value.lookId : null, name: typeof value.name === "string" ? value.name.slice(0, 120) : "", selection, context: normalizeContext(value.context), favorite: value.favorite === true };
  } catch { return null; }
}
async function api(route = "", options = {}) {
  const response = await fetch(API + route, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Your outfit could not be saved. Please try again.");
  return value;
}
const fileDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read this photo.")); reader.readAsDataURL(file); });

function ClothingLayout({ selection, items, compact = false }) {
  return <div className={`outfit-layout${compact ? " is-compact" : ""}`} aria-label="Selected clothing layout">
    {OUTFIT_SLOTS.map((slot) => {
      const item = items.find((candidate) => candidate.id === selection[slot.id]);
      return <div className={`outfit-layout-piece piece-${slot.id}${item ? " is-filled" : ""}`} key={slot.id}>
        {item ? <OptimizedImage src={item.image} alt={item.name} sizes={compact ? "90px" : "(max-width: 680px) 40vw, 240px"} /> : <span>{slot.label}<small>{slot.required ? "Choose a piece" : "Optional"}</small></span>}
      </div>;
    })}
  </div>;
}

function Choice({ label, field, context, onChange }) {
  return <label className="outfit-field"><span>{label}</span><select value={context[field]} onChange={(event) => onChange(field, event.target.value)}>{STYLE_OPTIONS[field].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>;
}

export function OutfitStudio({ items, active }) {
  const initialDraft = useRef(readDraft());
  const [draft, setDraft] = useState(() => initialDraft.current || newDraft());
  const [studio, setStudio] = useState({ looks: [], preferences: DEFAULT_PREFERENCES, identityReady: false, identityImage: null, codex: { available: false, reason: null } });
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(""), [activeSlot, setActiveSlot] = useState("upperbody"), [search, setSearch] = useState("");
  const [previewMode, setPreviewMode] = useState("layout"), [handoff, setHandoff] = useState(""), [copied, setCopied] = useState(false);
  const [compared, setCompared] = useState([]), [favoritesOnly, setFavoritesOnly] = useState(false), [undoId, setUndoId] = useState(null);
  const handoffRef = useRef(null), uploadRef = useRef(null), previewRef = useRef(null);

  const reload = useCallback(async (signal) => { const value = await api("", { signal }); setStudio(value); return value; }, []);
  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal).then((value) => {
      if (!initialDraft.current) setDraft(newDraft(value.preferences));
      else if (!value.looks.some(({ id }) => id === initialDraft.current.lookId)) setDraft((previous) => ({ ...previous, lookId: null }));
      setReady(true);
    }).catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { setNotice("Your draft could not be remembered in this browser. Save the look to keep it."); } }, [draft]);

  const waiting = studio.looks.some((look) => look.request?.status === "requested");
  useEffect(() => {
    if (!active || !waiting) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => { reload(controller.signal).catch((e) => { if (e.name !== "AbortError") setError(e.message); }); }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [active, waiting, reload]);
  useEffect(() => { setCompared((ids) => ids.filter((id) => studio.looks.some((look) => look.id === id))); }, [studio.looks]);

  const missing = missingRequired(draft.selection, items);
  const missingItems = OUTFIT_SLOTS.filter((slot) => draft.selection[slot.id] && !items.some((item) => item.id === draft.selection[slot.id] && item.part === slot.id));
  const selected = OUTFIT_SLOTS.map(({ id }) => items.find((item) => item.id === draft.selection[id])).filter(Boolean);
  const currentLook = studio.looks.find((look) => look.id === draft.lookId && outfitFingerprint(look.selection, look.context) === outfitFingerprint(draft.selection, draft.context));
  const currentRequest = currentLook?.request;
  const generating = currentRequest?.status !== "accepted" && currentRequest?.generation?.status === "running";
  const generationFailed = currentRequest?.status !== "accepted" && currentRequest?.generation?.status === "failed";
  useEffect(() => { if (currentRequest?.status === "accepted") { setHandoff(""); setCopied(false); } }, [currentRequest?.status]);
  const slot = OUTFIT_SLOTS.find(({ id }) => id === activeSlot);
  const choices = useMemo(() => items.filter((item) => item.part === activeSlot && `${item.name} ${(item.tags || []).join(" ")}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [items, activeSlot, search]);

  const change = (field, value) => { setHandoff(""); setCopied(false); setDraft((previous) => ({ ...previous, context: { ...previous.context, [field]: value } })); };
  const chooseItem = (id) => { setHandoff(""); setCopied(false); setDraft((previous) => ({ ...previous, selection: { ...previous.selection, [activeSlot]: previous.selection[activeSlot] === id ? null : id } })); };
  const startNew = () => { setDraft(newDraft(studio.preferences)); setPreviewMode("layout"); setHandoff(""); setError(""); setNotice(""); setActiveSlot("upperbody"); setSearch(""); };
  const loadLook = (look) => {
    setDraft({ lookId: look.id, name: look.name, selection: look.selection, context: look.context, favorite: look.favorite });
    setPreviewMode(look.preview ? "modeled" : "layout"); setHandoff(""); setNotice(""); setError("");
    previewRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const mergeLook = (look) => setStudio((previous) => ({ ...previous, looks: previous.looks.some(({ id }) => id === look.id) ? previous.looks.map((entry) => entry.id === look.id ? look : entry) : [...previous.looks, look] }));
  const saveDraft = async () => {
    const look = await api(draft.lookId ? `/looks/${draft.lookId}` : "/looks", { method: draft.lookId ? "PUT" : "POST", body: JSON.stringify(draft) });
    mergeLook(look); setDraft((previous) => ({ ...previous, lookId: look.id, name: look.name })); return look;
  };
  const perform = async (kind, action) => { setBusy(kind); setError(""); setNotice(""); if (kind !== "undo") setUndoId(null); try { return await action(); } catch (requestError) { setError(requestError.message); return null; } finally { setBusy(""); } };
  const prepare = () => perform("request", async () => {
    const look = await saveDraft(), job = await api(`/looks/${look.id}/request`, { method: "POST" });
    setHandoff(job.status === "accepted" ? "" : job.handoff); setCopied(false); setPreviewMode("modeled");
    await reload(); setNotice(job.status === "accepted" ? "Your modeled photo is ready." : "Your request is ready. Copy it into the Codex chat for this project.");
  });
  const generate = () => perform("generate", async () => {
    const look = await saveDraft(), job = await api(`/looks/${look.id}/request`, { method: "POST" });
    if (job.status !== "accepted") await api(`/requests/${job.id}/generate`, { method: "POST" });
    setHandoff(""); setCopied(false); setPreviewMode("modeled"); await reload();
    setNotice(job.status === "accepted" ? "Your modeled photo is ready." : "Codex is generating your photo. It will appear here automatically.");
  });
  const save = () => perform("save", async () => { await saveDraft(); setNotice("Look saved. You can come back to it anytime."); });
  const saveDefaults = () => perform("preferences", async () => { const preferences = await api("/preferences", { method: "PUT", body: JSON.stringify(draft.context) }); setStudio((previous) => ({ ...previous, preferences })); setNotice("Photo preferences saved for new looks."); });
  const favorite = (look) => perform("favorite", async () => {
    const saved = await api(`/looks/${look.id}`, { method: "PUT", body: JSON.stringify({ ...look, favorite: !look.favorite }) });
    mergeLook(saved); if (draft.lookId === look.id) setDraft((previous) => ({ ...previous, favorite: saved.favorite }));
  });
  const archive = (look) => perform("archive", async () => { await api(`/looks/${look.id}`, { method: "DELETE" }); setUndoId(look.id); setStudio((previous) => ({ ...previous, looks: previous.looks.filter(({ id }) => id !== look.id) })); if (draft.lookId === look.id) setDraft((previous) => ({ ...previous, lookId: null })); setNotice("Saved look removed. You can undo this."); });
  const undo = () => perform("undo", async () => { await api(`/looks/${undoId}/restore`, { method: "POST" }); await reload(); setUndoId(null); setNotice("Look restored."); });
  const copyRequest = async () => {
    try { await navigator.clipboard.writeText(handoff || currentRequest?.handoff); setCopied(true); }
    catch { handoffRef.current?.focus(); handoffRef.current?.select(); setNotice("Select and copy the request below, then paste it into Codex."); }
  };
  const upload = (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !currentRequest) return;
    perform("upload", async () => { if (file.size > 20 * 1024 * 1024) throw new Error("Choose a PNG smaller than 20 MB."); await api(`/requests/${currentRequest.id}/preview`, { method: "POST", body: JSON.stringify({ imageDataUrl: await fileDataUrl(file) }) }); await reload(); setPreviewMode("modeled"); setHandoff(""); setNotice("Modeled photo added to this look."); });
  };
  const compare = (id) => { setCompared((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : previous.length < 2 ? [...previous, id] : previous); };

  return <div className="outfit-studio">
    <div className="outfit-intro"><div><p className="outfit-eyebrow">Your clothes, together</p><h1>Outfit studio</h1><p>Pick a top, bottoms and shoes. Add a jacket or accessory when you want one.</p></div><button className="outfit-button" onClick={startNew} disabled={Boolean(busy)}><Plus size={17} /> New look</button></div>
    {error && <div className="outfit-message is-error" role="alert">{error}{!ready && <button className="outfit-text-button" onClick={() => perform("load", async () => { const value = await reload(); if (!initialDraft.current) setDraft(newDraft(value.preferences)); setReady(true); })}>Try again</button>}</div>}
    {notice && <div className="outfit-message" role="status">{notice}{undoId && <button className="outfit-text-button" disabled={Boolean(busy)} onClick={undo}>Undo</button>}</div>}
    {!ready ? <p className="outfit-loading">Loading your saved looks…</p> : <>
      <div className="outfit-workspace">
        <section className="outfit-preview" aria-label="Outfit preview" ref={previewRef}>
          <div className="outfit-preview-top"><div><p className="outfit-eyebrow">{draft.name || "A new combination"}</p><h2>Your outfit</h2></div><div className="outfit-preview-tabs" aria-label="Preview type"><button className={previewMode === "layout" ? "active" : ""} aria-pressed={previewMode === "layout"} onClick={() => setPreviewMode("layout")}>Layout</button><button className={previewMode === "modeled" ? "active" : ""} aria-pressed={previewMode === "modeled"} onClick={() => setPreviewMode("modeled")}>On me</button></div></div>
          {previewMode === "layout" ? <ClothingLayout selection={draft.selection} items={items} /> : currentLook?.preview ? <img className={`outfit-modeled format-${draft.context.framing}`} src={currentLook.preview} alt={`${currentLook.name}, modeled on you in a ${draft.context.background} setting`} /> : <div className="outfit-preview-empty"><Sparkle size={36} weight="light" /><h3>{generating ? "Creating your photo…" : generationFailed ? "Generation needs attention" : currentRequest ? "Your outfit is ready" : "See this look on you"}</h3><p>{generating ? "Codex is generating and reviewing your outfit. Your photo will appear here automatically." : generationFailed ? currentRequest.generation.message : "Generate a photo with your selected clothes, setting and personal reference photos."}</p>{studio.identityImage && <div className="outfit-identity"><img src={studio.identityImage} alt="Your identity reference" /><span>Your own reference photos<br /><small>Your appearance stays faithful to you.</small></span></div>}</div>}
          <div className="outfit-selected-list">{selected.map((item) => <span key={item.id}><i style={{ background: item.color || "#aaa" }} />{item.name}</span>)}{!selected.length && <span>Select clothes on the right to start.</span>}</div>
          {missingItems.length > 0 && <p className="outfit-helper is-error">A saved piece is no longer available. Replace your {missingItems.map(({ label }) => label.toLowerCase()).join(", ")}.</p>}
          <div className="outfit-actions"><button className="outfit-button is-primary" disabled={Boolean(busy) || generating || missing.length > 0 || missingItems.length > 0 || !studio.identityReady || !studio.codex?.available} onClick={generate}><Sparkle size={17} />{busy === "generate" ? "Starting…" : generating ? "Generating…" : currentLook?.preview ? "View modeled photo" : generationFailed ? "Retry with Codex" : "Generate with Codex"}</button><button className="outfit-button" disabled={Boolean(busy) || !selected.length || missingItems.length > 0} onClick={save}><BookmarkSimple size={17} />{busy === "save" ? "Saving…" : "Save look"}</button></div>
          <p className="outfit-helper">{missing.length ? `Still needed: ${missing.map(({ label }) => label.toLowerCase()).join(", ")}.` : !studio.identityReady ? "Add your identity reference photos before creating a try-on." : studio.codex?.available ? "Uses your ChatGPT Codex allowance. Your modeled photo appears here automatically." : studio.codex?.reason || "Checking your local Codex connection…"}</p>
          {(handoff || (currentRequest?.status === "requested" && !generating && !studio.codex?.available)) && <section className="outfit-handoff" aria-label="Codex try-on request"><h3>Create your modeled photo</h3><p>Copy this request, then paste it into the Codex chat for this project. Your exact outfit and background choices are saved.</p><textarea ref={handoffRef} readOnly rows={4} aria-label="Request to paste in Codex" value={handoff || currentRequest?.handoff || ""} /><div className="outfit-actions">{currentRequest?.appUrl && <a className="outfit-button" href={currentRequest.appUrl}>Open in Codex app</a>}<button className="outfit-button" onClick={copyRequest}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy Codex request"}</button><button className="outfit-text-button" disabled={Boolean(busy)} onClick={() => perform("refresh", async () => { await reload(); setNotice("Preview status refreshed."); })}><ArrowCounterClockwise size={15} /> Refresh</button></div></section>}
          {currentRequest && !generating && <><button className="outfit-text-button outfit-upload" disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}><UploadSimple size={15} /> Add a generated PNG</button><input ref={uploadRef} type="file" accept="image/png" onChange={upload} hidden /></>}
          {!generating && <button className="outfit-text-button" disabled={Boolean(busy) || missing.length > 0 || missingItems.length > 0 || !studio.identityReady} onClick={prepare}>Prepare request for the Codex app</button>}
        </section>

        <fieldset className="outfit-controls" disabled={Boolean(busy) || generating}>
          <section className="outfit-panel"><div className="outfit-section-heading"><h2>Choose your pieces</h2><span>{selected.length} / 5</span></div><div className="outfit-slot-list">{OUTFIT_SLOTS.map((entry) => { const item = items.find((candidate) => candidate.id === draft.selection[entry.id]); return <button key={entry.id} className={`outfit-slot${activeSlot === entry.id ? " active" : ""}`} aria-pressed={activeSlot === entry.id} onClick={() => { setActiveSlot(entry.id); setSearch(""); }}><span>{entry.label}<small>{entry.required ? "Required" : "Optional"}</small></span><strong>{item?.name || "Choose a piece"}</strong>{item ? <img src={item.thumbnail || item.image} alt="" /> : <Plus size={16} />}</button>; })}</div><div className="outfit-picker-heading"><h3>{slot.plural}</h3><button className="outfit-text-button" disabled={!draft.selection[activeSlot]} onClick={() => chooseItem(draft.selection[activeSlot])}>Clear selection</button></div><label className="outfit-search"><span className="sr-only">Search {slot.plural.toLowerCase()}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search your ${slot.plural.toLowerCase()}`} /></label><div className="outfit-item-grid">{choices.map((item) => <button className={`outfit-item${draft.selection[activeSlot] === item.id ? " selected" : ""}`} key={item.id} aria-pressed={draft.selection[activeSlot] === item.id} onClick={() => chooseItem(item.id)}><OptimizedImage src={item.thumbnail || item.image} alt="" sizes="(max-width: 680px) 27vw, 150px" /><span>{item.name}</span>{draft.selection[activeSlot] === item.id && <Check size={16} className="outfit-item-check" />}</button>)}</div>{!choices.length && <p className="outfit-helper">{items.some(({ part }) => part === activeSlot) ? "No pieces match your search." : `No ${slot.plural.toLowerCase()} imported yet.`}</p>}</section>
          <section className="outfit-panel"><h2>Picture the setting</h2><div className="outfit-scenes">{OUTFIT_SETTINGS.map((setting) => { const Icon = SCENE_ICONS[setting.id]; return <button className={`outfit-scene scene-${setting.id}${draft.context.background === setting.id ? " selected" : ""}`} aria-pressed={draft.context.background === setting.id} key={setting.id} onClick={() => change("background", setting.id)}><Icon size={28} weight="light" /><strong>{setting.name}</strong><span>{setting.description}</span></button>; })}</div><div className="outfit-fields"><Choice label="Lighting" field="light" context={draft.context} onChange={change} /><Choice label="Weather" field="weather" context={draft.context} onChange={change} /></div><label className="outfit-field"><span>Background details <small>Optional</small></span><textarea rows={2} value={draft.context.sceneNotes} maxLength={1000} onChange={(event) => change("sceneNotes", event.target.value)} placeholder="For example: a shady campus walkway, or a trail in the foothills" /></label></section>
          <section className="outfit-panel"><details className="outfit-personalize"><summary>Personalize your photos</summary><p className="outfit-helper">Your real appearance and the exact clothes stay faithful to the references.</p><div className="outfit-fields"><Choice label="Framing" field="framing" context={draft.context} onChange={change} /><Choice label="Pose" field="pose" context={draft.context} onChange={change} /><Choice label="Shirt styling" field="tuck" context={draft.context} onChange={change} /><Choice label="Long sleeves" field="sleeves" context={draft.context} onChange={change} /><Choice label="Jacket styling" field="jacket" context={draft.context} onChange={change} /></div><label className="outfit-field"><span>Personal styling notes</span><textarea rows={3} value={draft.context.styleNotes} maxLength={1000} onChange={(event) => change("styleNotes", event.target.value)} placeholder="What feels like you? Add preferred styling, colors, settings or things to avoid." /></label><button className="outfit-button" disabled={Boolean(busy)} onClick={saveDefaults}><Check size={16} /> Remember these preferences</button></details></section>
          <label className="outfit-field outfit-name"><span>Name this look</span><input value={draft.name} maxLength={120} onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))} placeholder="For example: Friday on campus" /></label>
        </fieldset>
      </div>

      <section className="outfit-saved" aria-label="Saved outfits"><div className="outfit-saved-heading"><div><p className="outfit-eyebrow">Keep the combinations you like</p><h2>Saved looks</h2></div><button className={`outfit-button${favoritesOnly ? " is-active" : ""}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}><Star size={16} weight={favoritesOnly ? "fill" : "regular"} /> Favorites</button></div>{!studio.looks.length ? <p className="outfit-helper">Save a look to build your personal outfit collection.</p> : <><p className="outfit-helper">Select two looks to compare them side by side.</p><div className="outfit-saved-grid">{studio.looks.filter((look) => !favoritesOnly || look.favorite).map((look) => <article className="outfit-saved-card" key={look.id}><button className="outfit-saved-open" disabled={Boolean(busy)} onClick={() => loadLook(look)} aria-label={`Open ${look.name}`}>{look.preview ? <img className="outfit-saved-photo" src={look.preview} alt={`${look.name} modeled on you`} /> : <ClothingLayout compact selection={look.selection} items={items} />}<span className="outfit-saved-title">{look.name}</span><span className="outfit-saved-setting">{OUTFIT_SETTINGS.find(({ id }) => id === look.context.background)?.name}{look.request?.status === "requested" ? look.request.generation?.status === "running" ? " · Generating photo…" : look.request.generation?.status === "failed" ? " · Generation needs attention" : " · Awaiting modeled photo" : ""}</span></button><div className="outfit-saved-actions"><label><input type="checkbox" checked={compared.includes(look.id)} disabled={!compared.includes(look.id) && compared.length >= 2} onChange={() => compare(look.id)} /> Compare</label><button className="outfit-icon-button" aria-label={`${look.favorite ? "Unfavorite" : "Favorite"} ${look.name}`} aria-pressed={look.favorite} disabled={Boolean(busy)} onClick={() => favorite(look)}><Star size={17} weight={look.favorite ? "fill" : "regular"} /></button><button className="outfit-icon-button" aria-label={`Remove ${look.name}`} disabled={Boolean(busy)} onClick={() => archive(look)}><Trash size={16} /></button></div></article>)}</div>{favoritesOnly && !studio.looks.some(({ favorite }) => favorite) && <p className="outfit-helper">Star a saved look to see it here.</p>}</>}</section>
      {compared.length > 0 && <section className="outfit-comparison" aria-label="Compare saved outfits"><div className="outfit-section-heading"><h2>Side by side</h2><button className="outfit-text-button" onClick={() => setCompared([])}><X size={15} /> Clear</button></div><div className="outfit-comparison-grid">{compared.map((id) => studio.looks.find((look) => look.id === id)).filter(Boolean).map((look) => <article key={look.id}>{look.preview ? <img className="outfit-compare-photo" src={look.preview} alt={look.name} /> : <ClothingLayout selection={look.selection} items={items} />}<h3>{look.name}</h3><p className="outfit-helper">{OUTFIT_SETTINGS.find(({ id }) => id === look.context.background)?.name}</p><button className="outfit-button" disabled={Boolean(busy)} onClick={() => loadLook(look)}>Edit this look</button></article>)}{compared.length === 1 && <div className="outfit-compare-empty">Choose a second saved look to compare.</div>}</div></section>}
    </>}
  </div>;
}
