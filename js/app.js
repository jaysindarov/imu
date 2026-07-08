/* ============================================================
 * IMU — Interactive World Globe
 * Data sources:
 *  - Country borders: Natural Earth (via globe.gl datasets)
 *  - Crime: World Bank API, indicator VC.IHR.PSRC.P5
 *    (UNODC intentional homicides per 100,000 people)
 *  - Living cost: World Bank API, indicator PA.NUS.PPPC.RF
 *    (price level ratio of PPP conversion factor to market exchange rate)
 *  - City salaries: Numbeo 2024 published averages (js/cities-data.js)
 * ============================================================ */

// bundled locally — external raw.githubusercontent.com is blocked on some networks
const COUNTRIES_URL = "data/countries.geojson";
const WB = (indicator) =>
  `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&date=2014:2025&per_page=20000`;
const WB_CRIME = "VC.IHR.PSRC.P5"; // UNODC intentional homicides per 100k
const WB_PPP = "PA.NUS.PPP"; // PPP conversion factor (LCU per intl $)
const WB_FX = "PA.NUS.FCRF"; // official exchange rate (LCU per US$)

const TEXTURES = {
  countries: "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
  salaries: "https://unpkg.com/three-globe/example/img/earth-night.jpg",
  crime: "https://unpkg.com/three-globe/example/img/earth-dark.jpg",
  cost: "https://unpkg.com/three-globe/example/img/earth-dark.jpg",
};

// ---------- state ----------
let globe;
let countries = [];            // geojson features
let crimeData = new Map();     // iso3 -> { value, year }
let costData = new Map();      // iso3 -> { value, year }
let currentMode = "countries";
let currentTexture = "";
let hoveredPolygon = null;
let countryLabels = [];        // precomputed name labels for countries mode

// per-mode polygon colors; re-applied on hover so accessors re-evaluate
let capColorFn = () => "rgba(255,255,255,0.06)";
let strokeColorFn = () => "rgba(255,255,255,0.35)";
function applyPolyColors() {
  globe
    .polygonCapColor((d) => capColorFn(d))
    .polygonStrokeColor((d) => strokeColorFn(d));
}

const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
const iso3 = (f) => {
  const p = f.properties;
  return p.ISO_A3 && p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3;
};
const cname = (f) => f.properties.ADMIN || f.properties.NAME;

function fmt(n, digits = 1) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtPop(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " K";
  return String(n);
}

// linear-interpolated color scale over [0,1]
function makeScale(stops) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const pts = stops.map(([t, c]) => [t, parse(c)]);
  return (t) => {
    t = Math.max(0, Math.min(1, t));
    let i = 0;
    while (i < pts.length - 2 && t > pts[i + 1][0]) i++;
    const [t0, c0] = pts[i];
    const [t1, c1] = pts[i + 1];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const rgb = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
}

// green (safe) -> yellow -> red (dangerous)
const crimeScale = makeScale([
  [0, "#22c55e"],
  [0.35, "#eab308"],
  [0.65, "#f97316"],
  [1, "#dc2626"],
]);
// teal (cheap) -> yellow -> magenta (expensive)
const costScale = makeScale([
  [0, "#14b8a6"],
  [0.5, "#facc15"],
  [1, "#e11d48"],
]);
// salary tower gradient: cool low -> hot high
const salaryScale = makeScale([
  [0, "#38bdf8"],
  [0.5, "#a78bfa"],
  [1, "#fb7185"],
]);

// crime normalized on sqrt scale, capped at 30 per 100k
const crimeT = (v) => Math.sqrt(Math.min(v, 30) / 30);
// cost price-level normalized between 0.3 and 1.3
const costT = (v) => (Math.min(Math.max(v, 0.3), 1.3) - 0.3) / 1.0;

const MAX_SALARY = Math.max(...CITY_SALARIES.map((c) => c.salary));

// rough centroid of a country feature (bbox center of its largest ring)
function centroid(f) {
  const polys =
    f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly[0];
    let minX = 180, maxX = -180, minY = 90, maxY = -90;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) {
      bestArea = area;
      best = { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2, area };
    }
  }
  return best;
}

function buildCountryLabels() {
  countryLabels = countries.map((f) => {
    const c = centroid(f);
    return {
      lat: c.lat,
      lng: c.lng,
      text: cname(f),
      alt: 0.012,
      // bigger countries get bigger labels so the map reads at a glance
      size: Math.min(2.0, Math.max(0.45, Math.sqrt(c.area) / 35)),
      color: "rgba(255,255,255,0.8)",
    };
  });
}

function tooltip(title, rows) {
  const body = rows
    .map(([k, v]) => `<div><span class="tt-dim">${k}</span> <b>${v}</b></div>`)
    .join("");
  return `<div class="globe-tooltip"><div class="tt-title">${title}</div>${body}</div>`;
}

// ---------- World Bank fetch ----------
// returns Map iso3 -> { year(number) -> value } over the requested range
async function fetchWBSeries(indicator) {
  const res = await fetch(WB(indicator));
  if (!res.ok) throw new Error(`World Bank API ${res.status}`);
  const json = await res.json();
  const rows = json[1] || [];
  const map = new Map();
  for (const r of rows) {
    if (r.value == null || !r.countryiso3code) continue;
    if (!map.has(r.countryiso3code)) map.set(r.countryiso3code, {});
    map.get(r.countryiso3code)[+r.date] = r.value;
  }
  return map;
}

// most recent non-null value per country
function latestOf(series) {
  const map = new Map();
  for (const [code, byYear] of series) {
    const year = Math.max(...Object.keys(byYear).map(Number));
    map.set(code, { value: byYear[year], year });
  }
  return map;
}

// price level = PPP factor / market exchange rate, latest year where both exist
function priceLevels(pppSeries, fxSeries) {
  const map = new Map();
  for (const [code, ppp] of pppSeries) {
    const fx = fxSeries.get(code);
    if (!fx) continue;
    const years = Object.keys(ppp).map(Number).filter((y) => fx[y] != null);
    if (!years.length) continue;
    const year = Math.max(...years);
    map.set(code, { value: ppp[year] / fx[year], year });
  }
  // USA is the reference: PPP factor = 1, but FCRF may be absent — pin it
  if (!map.has("USA")) map.set("USA", { value: 1, year: 2024 });
  return map;
}

// ---------- globe setup ----------
function initGlobe() {
  globe = Globe()($("globe"))
    .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
    .atmosphereColor("#4da3ff")
    .atmosphereAltitude(0.18)
    .polygonAltitude(0.008)
    .polygonsTransitionDuration(250)
    .labelLat("lat")
    .labelLng("lng")
    .labelText("text")
    .labelAltitude((d) => d.alt || 0.01)
    .labelSize((d) => d.size || 0.8)
    .labelColor((d) => d.color || "rgba(255,255,255,0.75)")
    .labelDotRadius(0)
    .labelResolution(2)
    .onPolygonHover((p) => {
      hoveredPolygon = p;
      globe.polygonAltitude((d) => (d === p ? 0.045 : 0.008));
      applyPolyColors();
      document.body.style.cursor = p ? "pointer" : "default";
    })
    .onPolygonClick((p) => {
      const c = centroid(p);
      if (c) globe.pointOfView({ ...c, altitude: 1.3 }, 900);
    })
    .onPointClick((d) =>
      globe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.9 }, 900)
    );

  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.1;
  globe.pointOfView({ lat: 25, lng: 10, altitude: 2.2 });

  window.addEventListener("resize", () =>
    globe.width(window.innerWidth).height(window.innerHeight)
  );
}

function setTexture(mode) {
  if (TEXTURES[mode] !== currentTexture) {
    currentTexture = TEXTURES[mode];
    globe.globeImageUrl(currentTexture);
  }
}

function clearLayers() {
  globe.polygonsData([]).pointsData([]).labelsData([]);
}

// ---------- modes ----------
function showCountries() {
  setTexture("countries");
  clearLayers();

  // hovered country: fully transparent cap so its real (satellite) map shows
  // through the raised chunk — no blue overlay; bright outline as the cue
  capColorFn = (f) =>
    f === hoveredPolygon ? "rgba(0,0,0,0)" : "rgba(255,255,255,0.06)";
  strokeColorFn = (f) =>
    f === hoveredPolygon ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.35)";
  applyPolyColors();

  globe
    .polygonsData(countries)
    .labelsData(countryLabels)
    .polygonSideColor(() => "rgba(77,163,255,0.12)")
    .polygonLabel((f) => {
      const p = f.properties;
      return tooltip(cname(f), [
        ["Continent", p.CONTINENT || "—"],
        ["Population", fmtPop(p.POP_EST || 0)],
        ["GDP", "$" + fmt((p.GDP_MD ?? p.GDP_MD_EST ?? 0) / 1000, 0) + " B"],
      ]);
    });

  $("legend").innerHTML = `
    <div class="legend-title">Countries &amp; Borders</div>
    <p class="legend-note">Hover a country for details. Click to zoom in.
    Drag to spin, scroll to zoom.</p>`;
  $("ranking").innerHTML = `
    <h3>About</h3>
    <p class="legend-note">${countries.length} countries and territories rendered
    from Natural Earth boundary data. Switch modes above to explore salaries,
    safety and living costs.</p>`;
  $("source").innerHTML =
    'Borders: <a href="https://www.naturalearthdata.com" target="_blank">Natural Earth</a>';
}

function showSalaries() {
  setTexture("salaries");
  clearLayers();

  const sorted = [...CITY_SALARIES].sort((a, b) => b.salary - a.salary);
  const towerTop = (d) => 0.02 + (d.salary / MAX_SALARY) * 0.55;

  // salary figure floats on top of every tower; top 12 cities also get a name
  const labels = CITY_SALARIES.map((d) => ({
    lat: d.lat,
    lng: d.lng,
    text: "$" + fmt(d.salary, 0),
    alt: towerTop(d) + 0.012,
    size: 0.55 + (d.salary / MAX_SALARY) * 0.35,
    color: "rgba(255,224,130,0.95)",
  }));
  for (const d of sorted.slice(0, 12)) {
    labels.push({
      lat: d.lat,
      lng: d.lng,
      text: d.city,
      alt: towerTop(d) + 0.05,
      size: 0.85,
      color: "rgba(255,255,255,0.8)",
    });
  }

  globe
    .pointsData(CITY_SALARIES)
    .pointLat("lat")
    .pointLng("lng")
    .pointAltitude(towerTop)
    .pointRadius(0.42)
    .pointColor((d) => salaryScale(d.salary / MAX_SALARY))
    .pointsTransitionDuration(600)
    .pointLabel((d) =>
      tooltip(`${d.city}, ${d.country}`, [
        ["Avg net salary", `<span class="tt-value">$${fmt(d.salary, 0)}</span>/mo`],
        ["World rank", "#" + (sorted.indexOf(d) + 1) + " of " + sorted.length],
      ])
    )
    .labelsData(labels);

  $("legend").innerHTML = `
    <div class="legend-title">Average net salary (USD / month)</div>
    <div class="legend-bar" style="background:linear-gradient(to right,#38bdf8,#a78bfa,#fb7185)"></div>
    <div class="legend-labels"><span>$200</span><span>$${fmt(MAX_SALARY, 0)}</span></div>
    <p class="legend-note">Tower height &amp; color = average monthly net (after-tax)
    salary. Click a tower to fly to it.</p>`;

  renderRanking(
    "Top salaries",
    sorted.slice(0, 15).map((d) => ({
      name: `${d.city}`,
      value: "$" + fmt(d.salary, 0),
      color: salaryScale(d.salary / MAX_SALARY),
      goto: { lat: d.lat, lng: d.lng, altitude: 0.9 },
    }))
  );

  $("source").innerHTML =
    'Salaries: <a href="https://www.numbeo.com/cost-of-living/" target="_blank">Numbeo</a> 2024 averages';
}

function choropleth(dataMap, scaleT, colorScale, opts) {
  clearLayers();
  capColorFn = (f) => {
    const d = dataMap.get(iso3(f));
    if (!d) return "rgba(120,120,130,0.25)";
    const c = colorScale(scaleT(d.value));
    return f === hoveredPolygon ? c : c.replace("rgb", "rgba").replace(")", ",0.85)");
  };
  strokeColorFn = () => "rgba(255,255,255,0.35)";
  applyPolyColors();
  globe
    .polygonsData(countries)
    .polygonSideColor(() => "rgba(255,255,255,0.06)")
    .polygonLabel((f) => {
      const d = dataMap.get(iso3(f));
      if (!d) return tooltip(cname(f), [["Data", "not available"]]);
      return tooltip(cname(f), [
        [opts.metric, `<span class="tt-value">${opts.fmtVal(d.value)}</span>`],
        ["Year", d.year],
        [opts.rankLabel, opts.rankOf(iso3(f))],
      ]);
    });
}

function showCrime() {
  setTexture("crime");

  const joined = countries
    .map((f) => ({ f, d: crimeData.get(iso3(f)) }))
    .filter((x) => x.d);
  const safest = [...joined].sort((a, b) => a.d.value - b.d.value);
  const rankMap = new Map(safest.map((x, i) => [iso3(x.f), i + 1]));

  choropleth(crimeData, crimeT, crimeScale, {
    metric: "Homicide rate",
    fmtVal: (v) => `${fmt(v, 1)} <span class="tt-dim">per 100k</span>`,
    rankLabel: "Safety rank",
    rankOf: (code) =>
      rankMap.has(code) ? `#${rankMap.get(code)} of ${safest.length}` : "—",
  });

  $("legend").innerHTML = `
    <div class="legend-title">Intentional homicides per 100,000</div>
    <div class="legend-bar" style="background:linear-gradient(to right,#22c55e,#eab308,#f97316,#dc2626)"></div>
    <div class="legend-labels"><span>0 · safest</span><span>30+</span></div>
    <p class="legend-note">Official UNODC homicide statistics, most recent year
    per country. Grey = no data.</p>`;

  renderRanking(
    "Safest countries",
    safest.slice(0, 15).map((x) => ({
      name: cname(x.f),
      value: fmt(x.d.value, 2),
      color: crimeScale(crimeT(x.d.value)),
      goto: { ...centroid(x.f), altitude: 1.4 },
    }))
  );

  $("source").innerHTML =
    'Crime: <a href="https://data.worldbank.org/indicator/VC.IHR.PSRC.P5" target="_blank">World Bank / UNODC</a> (live)';
}

function showCost() {
  setTexture("cost");

  const joined = countries
    .map((f) => ({ f, d: costData.get(iso3(f)) }))
    .filter((x) => x.d);
  const cheapest = [...joined].sort((a, b) => a.d.value - b.d.value);
  const rankMap = new Map(cheapest.map((x, i) => [iso3(x.f), i + 1]));

  choropleth(costData, costT, costScale, {
    metric: "Price level",
    fmtVal: (v) =>
      `${fmt(v * 100, 0)} <span class="tt-dim">(US = 100)</span>`,
    rankLabel: "Affordability rank",
    rankOf: (code) =>
      rankMap.has(code) ? `#${rankMap.get(code)} of ${cheapest.length}` : "—",
  });

  $("legend").innerHTML = `
    <div class="legend-title">Price level index (United States = 100)</div>
    <div class="legend-bar" style="background:linear-gradient(to right,#14b8a6,#facc15,#e11d48)"></div>
    <div class="legend-labels"><span>30 · cheapest</span><span>130+</span></div>
    <p class="legend-note">Ratio of PPP conversion factor to market exchange
    rate — how expensive everyday goods are vs the US. Grey = no data.</p>`;

  renderRanking(
    "Most affordable",
    cheapest.slice(0, 15).map((x) => ({
      name: cname(x.f),
      value: fmt(x.d.value * 100, 0),
      color: costScale(costT(x.d.value)),
      goto: { ...centroid(x.f), altitude: 1.4 },
    }))
  );

  $("source").innerHTML =
    'Cost: <a href="https://data.worldbank.org/indicator/PA.NUS.PPPC.RF" target="_blank">World Bank ICP</a> (live)';
}

// ---------- ranking panel ----------
function renderRanking(title, rows) {
  $("ranking").innerHTML =
    `<h3>${title}</h3>` +
    rows
      .map(
        (r, i) => `
      <div class="rank-row" data-i="${i}">
        <span class="rank-num">${i + 1}</span>
        <span class="rank-dot" style="background:${r.color}"></span>
        <span class="rank-name">${r.name}</span>
        <span class="rank-val">${r.value}</span>
      </div>`
      )
      .join("");

  $("ranking").querySelectorAll(".rank-row").forEach((el) => {
    el.addEventListener("click", () => {
      const r = rows[+el.dataset.i];
      if (r.goto && r.goto.lat != null) globe.pointOfView(r.goto, 900);
    });
  });
}

// ---------- mode switching ----------
const MODES = {
  countries: showCountries,
  salaries: showSalaries,
  crime: showCrime,
  cost: showCost,
};

function setMode(mode) {
  currentMode = mode;
  hoveredPolygon = null;
  document
    .querySelectorAll(".mode-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  MODES[mode]();
}

// ---------- boot ----------
async function boot() {
  initGlobe();

  $("loaderText").textContent = "Loading country borders…";
  try {
    const geo = await fetch(COUNTRIES_URL).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    countries = geo.features.filter((f) => f.properties.ISO_A2 !== "AQ"); // skip Antarctica
    buildCountryLabels();
  } catch (e) {
    console.error("Border data failed:", e);
    $("loaderText").innerHTML =
      "Could not load country borders.<br>Check your connection and " +
      '<a href="javascript:location.reload()" style="color:#4da3ff">reload</a>.';
    return; // keep loader visible with the error message
  }

  $("loaderText").textContent = "Fetching live World Bank data…";
  try {
    const [crimeSeries, pppSeries, fxSeries] = await Promise.all([
      fetchWBSeries(WB_CRIME),
      fetchWBSeries(WB_PPP),
      fetchWBSeries(WB_FX),
    ]);
    crimeData = latestOf(crimeSeries);
    costData = priceLevels(pppSeries, fxSeries);
  } catch (e) {
    console.error("World Bank fetch failed:", e);
    document.querySelectorAll('[data-mode="crime"],[data-mode="cost"]').forEach((b) => {
      b.disabled = true;
      b.style.opacity = 0.4;
      b.title = "Live World Bank data unavailable (network error)";
    });
  }

  setMode("countries");
  $("loader").classList.add("hidden");

  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.addEventListener("click", () => !b.disabled && setMode(b.dataset.mode))
  );

  $("rotateToggle").addEventListener("change", (e) => {
    globe.controls().autoRotate = e.target.checked;
  });
}

boot();
