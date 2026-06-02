import React, { useEffect, useState } from "react";
import {
  JSON_URLS,
  loadCountryNames,
  loadRegionCatalog,
  readJson,
  writeJson,
} from "../../runtime/assets.js";
import { readWorldState, writeWorldState } from "../../runtime/gameState.js";
import { ensureLibraryCatalog } from "../../runtime/library.js";
import {
  registerAdminRegionHandler,
  setAdminActive,
} from "../Admin/adminBus.js";

// "Cartographer's Command Console" — amber/copper accent (#f59e0b) signals admin
// authority and sets it apart from the blue (#3b82f6) gameplay accent. Stays on
// the project's dark inline-style theme; React Compiler handles memoization.
const ACCENT = "#f59e0b";
const ACCENT_DIM = "#b45309";
const PANEL_BG = "rgba(15, 21, 33, 0.94)";

const TABS = [
  { id: "region", label: "Regione" },
  { id: "annex", label: "Annessione" },
  { id: "state", label: "Stato" },
  { id: "create", label: "Nuovo" },
];

const labelStyle = {
  display: "block",
  fontSize: "0.74rem",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  marginBottom: "0.4rem",
  color: "rgba(255,255,255,0.55)",
};

const inputStyle = {
  width: "100%",
  padding: "0.55rem 0.6rem",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.16)",
  backgroundColor: "rgba(0,0,0,0.28)",
  color: "white",
  fontSize: "0.85rem",
  outline: "none",
  boxSizing: "border-box",
};

const monoStyle = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.78rem",
  color: ACCENT,
};

const fieldStyle = { marginBottom: "0.85rem" };

const hexToRgb = (hex) => {
  const match = /^#?([a-f0-9]{6})$/i.exec(String(hex ?? "").trim());
  if (!match) return null;
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
};

const rgbToHex = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length < 3) return "#888888";
  const channel = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)))
    .toString(16)
    .padStart(2, "0");
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
};

const PrimaryButton = ({ children, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      width: "100%",
      padding: "0.6rem",
      borderRadius: "8px",
      border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: "0.85rem",
      fontWeight: 600,
      color: disabled ? "rgba(255,255,255,0.4)" : "#1a1206",
      background: disabled ? "rgba(255,255,255,0.08)" : ACCENT,
      transition: "background 0.2s, opacity 0.2s",
    }}
  >
    {children}
  </button>
);

const SectionNote = ({ children }) => (
  <p style={{ margin: "0.6rem 0 0", fontSize: "0.74rem", lineHeight: 1.45, color: "rgba(255,255,255,0.5)" }}>
    {children}
  </p>
);

const AdminPanel = ({ isAdminOpen, topOffset = "0.5rem" }) => {
  const [loaded, setLoaded] = useState(false);
  const [hasActiveGame, setHasActiveGame] = useState(true);
  const [regions, setRegions] = useState([]);
  const [baseStates, setBaseStates] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [polities, setPolities] = useState({});
  const [colors, setColors] = useState({});

  const [activeTab, setActiveTab] = useState("region");
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Form scratch state.
  const [regionTarget, setRegionTarget] = useState("");
  const [annexFrom, setAnnexFrom] = useState("");
  const [annexTo, setAnnexTo] = useState("");
  const [editState, setEditState] = useState("");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#888888");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#cc8844");

  // Admin mode mirrors the open state: the map routes region clicks to us only
  // while open.
  useEffect(() => {
    setAdminActive(isAdminOpen);
    return () => setAdminActive(false);
  }, [isAdminOpen]);

  // Receive region clicks coming from the map.
  useEffect(() => {
    const unsubscribe = registerAdminRegionHandler((payload) => {
      setSelectedRegion(payload);
      setActiveTab("region");
    });
    return unsubscribe;
  }, []);

  // Load catalogs and a fresh draft each time the panel opens.
  useEffect(() => {
    if (!isAdminOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const [regionCatalog, countryNames, world, colorMap, library] = await Promise.all([
          loadRegionCatalog(),
          loadCountryNames(),
          readWorldState({ force: true }),
          readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
          ensureLibraryCatalog().catch(() => null),
        ]);
        if (cancelled) return;

        setRegions(regionCatalog);
        setBaseStates(countryNames);
        setOverrides({ ...(world.regionOwnershipOverrides ?? {}) });
        setPolities({ ...(world.polityOverrides ?? {}) });
        setColors({ ...colorMap });
        setHasActiveGame(Boolean(library?.activeGame ?? library?.activeGameId));
        setDirty(false);
        setMessage(null);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          console.error("Admin panel failed to load:", error);
          setMessage({ kind: "error", text: "Caricamento dati fallito." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdminOpen]);

  if (!isAdminOpen) return null;

  // Derived: full list of selectable states (basemap + overrides), de-duplicated.
  const stateOptions = (() => {
    const byCode = new Map();
    for (const entry of baseStates) {
      if (entry.code) byCode.set(entry.code, { code: entry.code, name: entry.name || entry.code });
    }
    for (const [code, polity] of Object.entries(polities)) {
      byCode.set(code, { code, name: polity?.name || code });
    }
    return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const stateName = (code) => stateOptions.find((s) => s.code === code)?.name || code || "—";
  const effectiveOwner = (region) => overrides[region.id] ?? region.countryCode;
  const annexCount = annexFrom
    ? regions.filter((region) => effectiveOwner(region) === annexFrom).length
    : 0;

  const markDirty = (note) => {
    setDirty(true);
    setMessage(note ? { kind: "info", text: note } : null);
  };

  const handleMoveRegion = () => {
    if (!selectedRegion?.GID_1 || !regionTarget) return;
    setOverrides((prev) => ({ ...prev, [selectedRegion.GID_1]: regionTarget }));
    markDirty(`Regione ${selectedRegion.NAME_1} → ${stateName(regionTarget)} (in bozza).`);
  };

  const handleAnnex = () => {
    if (!annexFrom || !annexTo || annexFrom === annexTo) return;
    setOverrides((prev) => {
      const next = { ...prev };
      for (const region of regions) {
        if (effectiveOwner(region) === annexFrom) next[region.id] = annexTo;
      }
      return next;
    });
    markDirty(`${annexCount} regioni: ${stateName(annexFrom)} → ${stateName(annexTo)} (in bozza).`);
  };

  const handleEditState = () => {
    if (!editState) return;
    const rgb = hexToRgb(editColor);
    setPolities((prev) => ({
      ...prev,
      [editState]: {
        ...(prev[editState] ?? {}),
        code: editState,
        name: editName.trim() || stateName(editState),
        color: editColor,
      },
    }));
    if (rgb) setColors((prev) => ({ ...prev, [editState]: rgb }));
    markDirty(`Stato ${stateName(editState)} aggiornato (in bozza).`);
  };

  const handleCreateState = () => {
    const code = newCode.trim().toUpperCase();
    if (!code || !newName.trim()) {
      setMessage({ kind: "error", text: "Codice e nome sono obbligatori." });
      return;
    }
    const rgb = hexToRgb(newColor);
    setPolities((prev) => ({
      ...prev,
      [code]: { code, name: newName.trim(), color: newColor },
    }));
    if (rgb) setColors((prev) => ({ ...prev, [code]: rgb }));
    setNewCode("");
    setNewName("");
    markDirty(`Stato ${newName.trim()} (${code}) creato (in bozza).`);
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const world = await readWorldState({ force: true });
      await writeWorldState({
        ...world,
        polityOverrides: polities,
        regionOwnershipOverrides: overrides,
      });
      await writeJson(JSON_URLS.colors, colors, { pretty: true });
      setDirty(false);
      setMessage({ kind: "success", text: "Modifiche salvate. La mappa si aggiorna entro ~5s." });
    } catch (error) {
      console.error("Admin save failed:", error);
      setMessage({ kind: "error", text: "Salvataggio fallito. Serve una partita attiva." });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    setLoaded(false); // forces reload on next open
    setDirty(false);
    setMessage(null);
    // Re-pull the persisted state immediately.
    Promise.all([
      readWorldState({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]).then(([world, colorMap]) => {
      setOverrides({ ...(world.regionOwnershipOverrides ?? {}) });
      setPolities({ ...(world.polityOverrides ?? {}) });
      setColors({ ...colorMap });
      setLoaded(true);
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: `calc(${topOffset} + 4.5rem)`,
        left: "0.5rem",
        bottom: "5rem",
        width: "23rem",
        maxWidth: "calc(100vw - 1rem)",
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        borderRadius: "14px",
        border: `1px solid ${ACCENT_DIM}66`,
        boxShadow: `0 10px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.08)`,
        color: "white",
        fontFamily: "sans-serif",
        overflow: "hidden",
        animation: "adminPanelIn 0.28s cubic-bezier(0.22,1,0.36,1) both",
      }}
    >
      <style>{`@keyframes adminPanelIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}`}</style>

      {/* Header */}
      <div
        style={{
          padding: "0.8rem 0.9rem",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: `linear-gradient(180deg, rgba(245,158,11,0.12), transparent)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: ACCENT,
              boxShadow: `0 0 8px ${ACCENT}`,
            }}
          />
          <span style={{ fontSize: "0.7rem", letterSpacing: "0.18em", color: ACCENT, fontWeight: 700 }}>
            ADMIN MODE
          </span>
        </div>
        <div style={{ marginTop: "0.3rem", fontSize: "0.96rem", fontWeight: 600 }}>
          Editor mappa
        </div>
        <div style={{ fontSize: "0.74rem", color: "rgba(255,255,255,0.55)", marginTop: "0.15rem" }}>
          Clicca una regione sulla mappa per selezionarla.
        </div>
      </div>

      {!hasActiveGame && (
        <div style={{ padding: "0.7rem 0.9rem", background: "rgba(220,80,40,0.18)", fontSize: "0.78rem", color: "#ffd9c2" }}>
          Nessuna partita attiva: avvia una partita per salvare le modifiche.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", padding: "0.5rem 0.6rem 0", gap: "0.25rem" }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "0.45rem 0.2rem",
                borderRadius: "8px 8px 0 0",
                border: "none",
                borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                cursor: "pointer",
                fontSize: "0.78rem",
                fontWeight: active ? 600 : 400,
                color: active ? "white" : "rgba(255,255,255,0.55)",
                background: active ? "rgba(245,158,11,0.1)" : "transparent",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.9rem" }}>
        {!loaded ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.82rem" }}>Caricamento…</div>
        ) : activeTab === "region" ? (
          <>
            <div style={fieldStyle}>
              <span style={labelStyle}>Regione selezionata</span>
              {selectedRegion ? (
                <div
                  style={{
                    padding: "0.55rem 0.6rem",
                    borderRadius: "8px",
                    border: `1px solid ${ACCENT_DIM}55`,
                    background: "rgba(245,158,11,0.08)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{selectedRegion.NAME_1}</div>
                  <div style={monoStyle}>
                    {selectedRegion.GID_1} · proprietario: {stateName(overrides[selectedRegion.GID_1] ?? selectedRegion.GID_0)}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.45)" }}>
                  Clicca una regione sulla mappa.
                </div>
              )}
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Assegna allo Stato</span>
              <select style={inputStyle} value={regionTarget} onChange={(e) => setRegionTarget(e.target.value)}>
                <option value="">— scegli Stato —</option>
                {stateOptions.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <PrimaryButton onClick={handleMoveRegion} disabled={!selectedRegion || !regionTarget}>
              Sposta regione
            </PrimaryButton>
            <SectionNote>Le modifiche sono in bozza finché non premi “Salva”.</SectionNote>
          </>
        ) : activeTab === "annex" ? (
          <>
            <div style={fieldStyle}>
              <span style={labelStyle}>Stato da annettere</span>
              <select style={inputStyle} value={annexFrom} onChange={(e) => setAnnexFrom(e.target.value)}>
                <option value="">— scegli Stato —</option>
                {stateOptions.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Nuovo proprietario</span>
              <select style={inputStyle} value={annexTo} onChange={(e) => setAnnexTo(e.target.value)}>
                <option value="">— scegli Stato —</option>
                {stateOptions.filter((s) => s.code !== annexFrom).map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            {annexFrom && (
              <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.6)", marginBottom: "0.6rem" }}>
                {annexCount} region{annexCount === 1 ? "e" : "i"} verrà trasferit{annexCount === 1 ? "a" : "e"}.
              </div>
            )}
            <PrimaryButton onClick={handleAnnex} disabled={!annexFrom || !annexTo || annexFrom === annexTo}>
              Annetti {annexCount > 0 ? `(${annexCount})` : ""}
            </PrimaryButton>
            <SectionNote>Tutte le regioni il cui proprietario effettivo è lo Stato scelto passano al nuovo proprietario.</SectionNote>
          </>
        ) : activeTab === "state" ? (
          <>
            <div style={fieldStyle}>
              <span style={labelStyle}>Stato</span>
              <select
                style={inputStyle}
                value={editState}
                onChange={(e) => {
                  const code = e.target.value;
                  setEditState(code);
                  setEditName(stateName(code) === code ? "" : stateName(code));
                  setEditColor(rgbToHex(colors[code]));
                }}
              >
                <option value="">— scegli Stato —</option>
                {stateOptions.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Nome</span>
              <input style={inputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome visualizzato" />
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Colore</span>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ width: "2.6rem", height: "2.2rem", border: "none", background: "none", cursor: "pointer" }} />
                <input style={inputStyle} value={editColor} onChange={(e) => setEditColor(e.target.value)} />
              </div>
            </div>
            <PrimaryButton onClick={handleEditState} disabled={!editState}>Applica modifiche</PrimaryButton>
            <SectionNote>Salva nome e colore in <span style={monoStyle}>polityOverrides</span> + <span style={monoStyle}>colors</span>.</SectionNote>
          </>
        ) : (
          <>
            <div style={fieldStyle}>
              <span style={labelStyle}>Codice (es. UKR, ZZ1)</span>
              <input style={{ ...inputStyle, ...monoStyle }} value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="CODICE" maxLength={8} />
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Nome</span>
              <input style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome dello Stato" />
            </div>
            <div style={fieldStyle}>
              <span style={labelStyle}>Colore</span>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ width: "2.6rem", height: "2.2rem", border: "none", background: "none", cursor: "pointer" }} />
                <input style={inputStyle} value={newColor} onChange={(e) => setNewColor(e.target.value)} />
              </div>
            </div>
            <PrimaryButton onClick={handleCreateState} disabled={!newCode.trim() || !newName.trim()}>Crea Stato</PrimaryButton>
            <SectionNote>Il nuovo Stato diventa selezionabile come destinatario di annessioni e riassegnazioni.</SectionNote>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "0.7rem 0.9rem" }}>
        {message && (
          <div
            style={{
              marginBottom: "0.6rem",
              fontSize: "0.76rem",
              lineHeight: 1.4,
              color:
                message.kind === "error" ? "#ff9b80"
                : message.kind === "success" ? "#8ce0a0"
                : "rgba(255,255,255,0.7)",
            }}
          >
            {message.text}
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={handleRevert}
            disabled={!dirty || saving}
            style={{
              flex: "0 0 auto",
              padding: "0.55rem 0.8rem",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: dirty ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.35)",
              cursor: dirty && !saving ? "pointer" : "not-allowed",
              fontSize: "0.82rem",
            }}
          >
            Annulla
          </button>
          <div style={{ flex: 1 }}>
            <PrimaryButton onClick={handleSave} disabled={!dirty || saving || !hasActiveGame}>
              {saving ? "Salvataggio…" : dirty ? "Salva modifiche" : "Nessuna modifica"}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export { AdminPanel };
