# IMU — Interactive World Globe

**Live demo: https://earthglobe.site/**

## About

IMU is a Google Earth-style web application for exploring how the world lives. It renders an interactive 3D globe you can spin, zoom and click, and overlays it with real, officially sourced socio-economic data in four switchable views: country borders with names, average city salaries visualized as 3D towers (with the salary figure floating on top of each tower), country safety based on official UNODC homicide statistics, and the cost of living across the globe as a price-level choropleth.

The goal is a simple but highly interactive way to answer questions like *"Where are salaries highest?"*, *"Which countries are the safest?"* and *"Where is life cheapest relative to the US?"* — all on one globe, with no fake or made-up numbers. Crime and cost data are fetched **live from the official World Bank API** on every page load, so the figures always reflect the most recent published year per country. City salary data is bundled from Numbeo's 2024 published averages, with the source attributed in the UI.

Everything is intentionally lightweight: no build step, no framework, no backend — plain HTML/CSS/JS with [globe.gl](https://globe.gl) (three.js) loaded from a CDN. The whole app is four small files and deploys as a static site anywhere.

### Features

- 🌍 Fully interactive globe — drag to spin, scroll to zoom, slow auto-rotation (toggleable)
- 🗺️ Country mode — names on the map, hover lifts the country as a 3D chunk showing its real satellite imagery, click to fly in
- 💰 Salary towers — height, color and on-top label per city, top-15 clickable ranking
- 🛡️ Safety choropleth — green (safest) to red, safety rank per country in the tooltip
- 🛒 Living-cost choropleth — price level vs the US, affordability ranking
- 📊 Side panel with legends, top-15 lists (click to fly there) and data source links
- 📱 Responsive layout — panel docks to the bottom on mobile

## Run

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

(Any static file server works. A server is required — the app fetches data over HTTP.)

## Views

| Mode | What it shows | Data source |
|------|---------------|-------------|
| Countries | Borders, population, GDP; hover highlight, click to zoom | Natural Earth |
| City Salaries | 3D towers per city, height = avg monthly net salary | Numbeo 2024 averages (bundled, `js/cities-data.js`) |
| Safety / Crime | Choropleth of intentional homicides per 100k (green = safest) | World Bank API `VC.IHR.PSRC.P5` (UNODC), fetched live |
| Living Cost | Choropleth of price level index (US = 100), computed as PPP conversion factor ÷ official exchange rate | World Bank API `PA.NUS.PPP` / `PA.NUS.FCRF`, fetched live |

Crime and cost data are fetched live from the official World Bank API on page load (most recent available year per country). Side panel shows a clickable top-15 ranking per mode.

## Files

```
index.html          markup + panel UI
css/style.css       dark glassmorphism styling
js/app.js           globe setup, modes, World Bank fetch/join
js/cities-data.js   city salary dataset (Numbeo 2024)
```
