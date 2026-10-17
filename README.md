# Time Tracker

A web app for tracking how much time you spend on daily activities — built for the
long haul, where the interesting thing isn't today's number but what a year or
five of them look like.

Everything lives in your browser's `localStorage`. No account, no server, no
network calls. It installs as a PWA and works fully offline.

## Run it

```bash
npm start           # http://localhost:8080
```

Any static server works; the included one just avoids a dependency. Opening
`index.html` from the file system will *not* work — ES modules and service
workers need `http://` or `https://`.

```bash
npm test            # store logic, app boot/render, chart geometry
npm run icons       # regenerate icons/ after changing the artwork
```

## Install as an app

Serve it over HTTPS (or `localhost`) and:

- **Chrome / Edge / Android** — the install icon in the address bar, or the
  "Install app" button in Settings.
- **iOS Safari** — Share → Add to Home Screen.

Installed, it opens in its own window, keeps working offline, and the icon is
there to tap. It's still the same browser profile underneath, so the data is
shared with the tab you installed it from.

## Deploy

Live at **https://nis057489.github.io/tracker/**

Pushing to `main` deploys it. `.github/workflows/pages.yml` runs the test suite,
assembles just the app files into `_site` (tests and tooling are not published),
and uploads them to GitHub Pages; the first run enables Pages on the repository
itself, so there is no manual step. If it ever needs setting by hand:
Settings → Pages → Source → **GitHub Actions**.

Every path in the app is relative, so serving from `/<repo>/` works as-is — and
so does any other static host (Netlify, Cloudflare Pages, S3) if you move it.

Two things worth knowing when you deploy:

- **Each URL has its own data.** `localStorage` is scoped to origin + path, so
  what you logged on `localhost:8080` is not what you see on the Pages URL, and a
  custom domain later would start empty again. Move data with Settings → Export
  JSON, then Import on the other URL. Pick the URL you intend to live on before
  you start tracking in earnest.
- **Bump `CACHE` in `sw.js`** whenever you change app files. That changes the
  service worker's own bytes, which is what makes installed copies notice the
  update and show the "new version is ready" reload prompt.

## Using it

**Track** — one row per activity for the chosen day. Log time three ways:

- the **timer** (Start/Stop) — it survives reloads, keeps running while the app
  is closed, and splits correctly across midnight;
- **quick taps** — `+15m`, `+30m`, `+1h`, `−15m`;
- **typing an exact amount** — tap the number and enter `90`, `1h30`, `1:30` or
  `1.5h`.

Step back with the arrows to fill in a day you missed. Optional daily goals show
as a progress meter.

**History** — a year of days as a heatmap (click any day to edit it), each month
of that year, and the last 30 days broken down by activity. Filter the heatmap to
a single activity to see that habit on its own.

**Insights** — pick a range (7 days to all time) for totals per activity, the
trend per day/week/month, your weekday rhythm, streaks and coverage.

**Settings** — add, rename, recolour, reorder, archive or delete activities;
theme and week start; export/import; install.

### If you leave a timer running

Closing the app with a timer on would otherwise log hours you weren't doing
anything. The app records when it was last open, and on return — if the timer has
been going more than 8 hours — offers to stop it at that moment instead, keep it
running, or discard it.

## Your data

Stored under the `localStorage` key `timetracker.v1`, as per-day totals:

```json
{
  "schema": 1,
  "activities": [{ "id": "a1", "name": "Sleep", "color": 6, "goal": 480 }],
  "log": { "2026-10-17": { "a1": 27000 } },
  "running": null,
  "settings": { "weekStart": 1, "theme": "system", "textures": false }
}
```

Seconds per activity per day — not individual sessions. That's the deliberate
trade for the long term: a day costs ~70 bytes, so ten years of tracking is under
a megabyte, comfortably inside the browser's ~5 MB budget (there's a test holding
this to account). The cost is that "when during the day" isn't recorded.

**Back it up.** Clearing site data, "reset browser", or some privacy modes will
delete it, and it does not sync between devices or browsers. Settings → Export
JSON is a complete backup; importing offers *merge* (keeps both, matching
activities by name) or *replace*. CSV export is one tidy row per day per activity
for spreadsheets.

Storage failures (quota, blocked storage) raise a banner rather than silently
dropping writes.

## Layout

```
index.html           shell
app.css              design tokens + components (light/dark)
manifest.webmanifest PWA manifest
sw.js                offline shell cache — bump CACHE when files change
js/store.js          data model, persistence, date maths, queries
js/charts.js         SVG charts (heatmap, columns, bars, trend)
js/views/            track · history · insights · settings
js/{app,dom,format,icons}.js
tools/               static server, icon generator
tests/               node --test suites + a small DOM stub
```

No build step, no dependencies, no framework — plain ES modules the browser loads
directly. Editing a file and reloading is the whole development loop.

## Design notes

- **Colour** is a validated categorical palette: eight hues whose order clears
  colourblind-separation and contrast gates in both light and dark mode. Each
  activity keeps its hue no matter how a chart is filtered or sorted. The heatmap
  uses a single-hue sequential ramp, stepped separately for each theme.
- **Charts** follow one spec: thin marks, 4px rounded data-ends, a 2px gap in the
  surface colour between touching fills, hairline gridlines, sparse direct
  labels, hover and keyboard tooltips, and a "Data table" fallback under every
  chart so no value is locked inside a picture.
- **Accessibility** — every chart mark is focusable and labelled, charts have
  table equivalents, the optional patterned fills carry identity without colour,
  and `prefers-reduced-motion` is respected.

## Known limits

- Per-day totals only — no session log, no categories/sub-activities, no notes.
- One browser profile: no sync, no multi-device, no sharing.
- Eight distinct colours; a ninth activity reuses one. Fewer, broader activities
  tend to survive years of tracking better anyway.
