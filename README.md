# IMU — Interactive World Globe

Google Earth-style interactive 3D globe with four data views. No build step, no framework — plain HTML/CSS/JS + [globe.gl](https://globe.gl) (three.js) from CDN.

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
