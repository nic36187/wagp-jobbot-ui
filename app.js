// Datei: app.js
// ============================================================
// Chat UI -> ruft dein API Gateway (Lambda) auf
// WICHTIG: OpenAI Key bleibt im Lambda. Hier ist KEIN Secret!
// ============================================================

// 1) HIER eintragen:
const API_URL = "https://adosh0qgoa.execute-api.eu-central-1.amazonaws.com/prod/recommend";

// Optional: wenn du später einen eigenen "site key" als Header willst:
// const SITE_KEY = "DEIN_SITE_KEY";

const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");

const chipBtns = Array.from(document.querySelectorAll(".chip"));

const state = {
  slots: {
    suche: null,
    ort: null,
    radius_km: 30,
    keywords: null,
    stunden_pro_woche: null,
    studiengang: "Wirtschaftsingenieurwesen",
    semester: 5,
    interessen: ["Wirtschaftsingenieur"]
  },
  pending: null
};

// ----------------------------
// Helpers UI
// ----------------------------
function addMessage(role, text, extraNode = null) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  bubble.textContent = text;

  wrap.appendChild(bubble);

  if (extraNode) {
    bubble.appendChild(extraNode);
  }

  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addJobs(matches) {
  const cards = document.createElement("div");
  cards.className = "cards";

  matches.forEach((m) => {
    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h4");
    h.textContent = `${m.rank ?? "?"}. ${m.title ?? "—"}`;
    card.appendChild(h);

    const row = document.createElement("div");
    row.className = "row2";
    row.innerHTML = `
      <span>🏢 ${escapeHtml(m.company ?? "—")}</span>
      <span>📍 ${escapeHtml(m.location ?? "—")}</span>
      <span class="badge">📏 ${escapeHtml(m.distance_km != null ? (m.distance_km + " km") : "unbekannt")}</span>
    `;
    card.appendChild(row);

    const reasons = Array.isArray(m.reasons) ? m.reasons : [];
    const ul = document.createElement("ul");
    ul.style.margin = "10px 0 0 18px";
    ul.style.color = "var(--text)";
    reasons.slice(0, 4).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
    card.appendChild(ul);

    const a = document.createElement("a");
    a.href = m.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = m.url ? "Link zur Ausschreibung" : "Kein Link vorhanden";
    a.style.display = "inline-block";
    a.style.marginTop = "10px";
    card.appendChild(a);

    cards.appendChild(card);
  });

  return cards;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ----------------------------
// Parsing / Slots (einfach & robust)
// ----------------------------
const RE_ONLY_NUM = /^\s*(\d{1,3})\s*$/;
const RE_KM = /(\d{1,3})\s*km\b/i;
const RE_HOURS = /(\d{1,2})\s*(stunden|std|h)\b/i;

function cleanPlaceText(p) {
  if (!p) return p;
  p = p.trim();
  p = p.replace(/\bals\b.*$/i, "").trim();
  p = p.replace(/\bim\s+bereich\b.*$/i, "").trim();
  p = p.replace(/\bbereich\b.*$/i, "").trim();
  p = p.replace(/\bfür\b.*$/i, "").trim();
  p = p.replace(/\b(keyword|keywords)\b.*$/i, "").trim();
  p = p.replace(/\bwerkstudent\b.*$/i, "").trim();
  p = p.replace(/\bpraktikum\b.*$/i, "").trim();
  p = p.split(",")[0].trim();
  p = p.replace(/\s{2,}/g, " ").trim();
  return p;
}

function normalizePlace(p) {
  p = cleanPlaceText(p || "");
  if (!p) return null;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function cleanKeywords(k) {
  if (!k) return null;
  k = k.trim();
  k = k.replace(/\b(oder\s+sowas|oder\s+so|usw\.?)\b/ig, "").trim();
  k = k.replace(/\s{2,}/g, " ").trim();
  return k || null;
}

function extractSlotsFromText(text) {
  const t = text.trim();
  const tl = t.toLowerCase();

  // pending answer handling
  if (state.pending === "ort") {
    const cand = normalizePlace(t);
    if (cand) state.slots.ort = cand;
    state.pending = null;
    return;
  }
  if (state.pending === "keywords") {
    const kw = cleanKeywords(tl);
    if (kw) state.slots.keywords = kw;
    state.pending = null;
    return;
  }
  if (state.pending === "stunden") {
    const m = t.match(RE_ONLY_NUM);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 1 && v <= 40) state.slots.stunden_pro_woche = v;
      state.pending = null;
      return;
    }
  }

  // suche type
  if (tl.includes("werkstudent")) state.slots.suche = "werkstudent";
  if (tl.includes("praktikum")) state.slots.suche = "praktikum";
  if (tl.includes("beides")) state.slots.suche = "beides";

  // radius
  const km = tl.match(RE_KM);
  if (km) {
    const v = parseInt(km[1], 10);
    if (v >= 5 && v <= 200) state.slots.radius_km = v;
  }

  // hours
  const hh = tl.match(RE_HOURS);
  if (hh) {
    const v = parseInt(hh[1], 10);
    if (v >= 1 && v <= 40) state.slots.stunden_pro_woche = v;
  }

  // ort heuristics
  const m1 = t.match(/\bumkreis\b.*?\b(?:um|von)\s+([A-Za-zÄÖÜäöüß\-]+(?:\s+[A-Za-zÄÖÜäöüß\-]+){0,2})\b/i);
  if (m1) state.slots.ort = normalizePlace(m1[1]) || state.slots.ort;

  const m2 = t.match(/\bnähe\s+von\s+([A-Za-zÄÖÜäöüß\-]+(?:\s+[A-Za-zÄÖÜäöüß\-]+){0,2})\b/i);
  if (m2) state.slots.ort = normalizePlace(m2[1]) || state.slots.ort;

  const m3 = t.match(/\b(in|bei|um|von)\s+([A-Za-zÄÖÜäöüß\-]+(?:\s+[A-Za-zÄÖÜäöüß\-]+){0,2})\b/i);
  if (m3) state.slots.ort = normalizePlace(m3[2]) || state.slots.ort;

  // keywords: simple
  if (!state.slots.keywords) {
    const topics = ["projektmanagement","logistik","supply chain","produktion","qualitätsmanagement","lean","sap"];
    const found = topics.filter(tp => tl.includes(tp));
    if (found.length) state.slots.keywords = cleanKeywords(found.join(" "));
  }

  if (state.slots.keywords) state.slots.keywords = cleanKeywords(state.slots.keywords);
}

function askForMissing() {
  if (!state.slots.suche) {
    state.pending = null;
    return "Suchst du Werkstudent, Praktikum oder beides?";
  }
  if (!state.slots.ort) {
    state.pending = "ort";
    return "In welcher Stadt suchst du? (z.B. Gummersbach)";
  }
  if (state.slots.stunden_pro_woche == null) {
    state.pending = "stunden";
    return "Wie viele Stunden pro Woche? (z.B. 18)";
  }
  if (!state.slots.keywords) {
    state.pending = "keywords";
    return "Welche Keywords? (z.B. projektmanagement qualitätsmanagement)";
  }
  state.pending = null;
  return null;
}

function buildPayload() {
  return {
    profil: {
      studiengang: state.slots.studiengang,
      semester: state.slots.semester,
      standort: state.slots.ort || "Gummersbach",
      stunden_pro_woche: state.slots.stunden_pro_woche || 20,
      interessen: state.slots.interessen
    },
    filter: {
      suche: state.slots.suche || "beides",
      radius_km: state.slots.radius_km || 30,
      ort: state.slots.ort || "Gummersbach",
      keywords: state.slots.keywords || "projektmanagement"
    }
  };
}

// ----------------------------
// Geocoding / Distance (Frontend)
// ----------------------------
const geoCache = new Map();

async function geocodeCityNRW(city) {
  if (!city) return null;
  const key = (city + "|nrw").toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key);

  const q = encodeURIComponent(`${city}, Nordrhein-Westfalen, Deutschland`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&addressdetails=1&countrycodes=de`;
  const resp = await fetch(url, { headers: { "User-Agent": "WAGP-JobBot-UI/1.0" } });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!Array.isArray(data) || !data.length) {
    geoCache.set(key, null);
    return null;
  }

  let chosen = null;
  for (const item of data) {
    const addr = item.address || {};
    const state = String(addr.state || "").toLowerCase();
    const dn = String(item.display_name || "").toLowerCase();
    if (state.includes("nordrhein-westfalen") || dn.includes("nordrhein-westfalen") || dn.includes("north rhine-westphalia")) {
      chosen = item;
      break;
    }
  }
  if (!chosen) {
    geoCache.set(key, null);
    return null;
  }
  const out = { lat: parseFloat(chosen.lat), lon: parseFloat(chosen.lon) };
  geoCache.set(key, out);
  return out;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (x) => (x * Math.PI) / 180;
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dphi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function attachDistancesAndFilter(matches, center, radiusKm) {
  const centerGeo = await geocodeCityNRW(center);
  if (!centerGeo) {
    return matches.map(m => ({...m, distance_km: null}));
  }

  const out = [];
  for (const m of matches) {
    const loc = m.location ? String(m.location) : "";
    const locCity = loc.split(",")[0].replace(/\(.*?\)/g, "").trim();
    const locGeo = await geocodeCityNRW(locCity);
    if (!locGeo) {
      out.push({...m, distance_km: null});
      continue;
    }
    const d = haversineKm(centerGeo.lat, centerGeo.lon, locGeo.lat, locGeo.lon);
    out.push({...m, distance_km: Math.round(d * 10) / 10});
  }

  // within radius preferred, unknown after
  const within = out.filter(m => m.distance_km != null && m.distance_km <= radiusKm);
  const unknown = out.filter(m => m.distance_km == null);

  // Sort by rank (1..n)
  const rankKey = (m) => {
    const r = parseInt(m.rank, 10);
    return Number.isFinite(r) ? r : 9999;
  };
  within.sort((a,b) => rankKey(a) - rankKey(b));
  unknown.sort((a,b) => rankKey(a) - rankKey(b));

  const finalList = [...within, ...unknown];

  return finalList;
}

// ----------------------------
// Backend call
// ----------------------------
async function callBackend(payload) {
  const headers = { "Content-Type": "application/json" };
  // headers["X-Site-Key"] = SITE_KEY;

  const resp = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);

  // API gateway might wrap { body: "..." }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Response ist kein JSON"); }

  if (data && typeof data === "object" && typeof data.body === "string") {
    return JSON.parse(data.body);
  }
  return data;
}

// ----------------------------
// Flow
// ----------------------------
async function handleSend(msg) {
  addMessage("user", msg);
  extractSlotsFromText(msg);

  const q = askForMissing();
  if (q) {
    addMessage("bot", q);
    return;
  }

  sendBtn.disabled = true;
  addMessage("bot", "Okay, ich suche passende Stellen…");

  try {
    const payload = buildPayload();
    const data = await callBackend(payload);

    const matches = Array.isArray(data.matches) ? data.matches : [];
    if (!matches.length) {
      addMessage("bot", "Keine Treffer. Versuch andere Keywords oder größeren Radius.");
      return;
    }

    // Filter + dist + sort
    const center = state.slots.ort;
    const radiusKm = state.slots.radius_km || 30;
    const withDist = await attachDistancesAndFilter(matches, center, radiusKm);

    // Show up to 5, in rank order
    const rankKey = (m) => {
      const r = parseInt(m.rank, 10);
      return Number.isFinite(r) ? r : 9999;
    };
    withDist.sort((a,b) => rankKey(a) - rankKey(b));

    const show = withDist.slice(0, 5);

    const cards = addJobs(show);
    addMessage("bot", `Gefundene Empfehlungen (bis zu 5) für ≤ ${radiusKm} km um ${center}:`, cards);

  } catch (e) {
    addMessage("bot", `Fehler beim Suchen: ${String(e.message || e)}`);
  } finally {
    sendBtn.disabled = false;
  }
}

function resetAll() {
  state.slots = {
    suche: null,
    ort: null,
    radius_km: 30,
    keywords: null,
    stunden_pro_woche: null,
    studiengang: "Wirtschaftsingenieurwesen",
    semester: 5,
    interessen: ["Wirtschaftsingenieur"]
  };
  state.pending = null;
  chatEl.innerHTML = "";
  addMessage("bot", "Hi! Beispiel: „Werkstudent um Gummersbach, Umkreis 50 km, 18 Stunden, keywords projektmanagement“");
}

// ----------------------------
// Events
// ----------------------------
sendBtn.addEventListener("click", () => {
  const msg = inputEl.value.trim();
  if (!msg) return;
  inputEl.value = "";
  handleSend(msg);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

resetBtn.addEventListener("click", resetAll);

chipBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = btn.getAttribute("data-prompt");
    inputEl.value = p;
    sendBtn.click();
  });
});

// init
resetAll();
