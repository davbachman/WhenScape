# WhenScape

A native macOS calendar companion for exploring a place at a particular time. SwiftUI and EventKit provide a read-only week calendar, MapKit selects the observer’s location, and a bundled CesiumJS scene displays real terrain, simplified buildings, astronomy and illustrative weather.

WhenScape also runs in a web browser, on computers and phones: see [The browser app](#the-browser-app). It has no calendar panel; instead you paste an event copied from your calendar, or open a WhenScape link saved in one.

The next version is a sundial screen saver. See [the sundial handoff](docs/sundial-handoff.md) for the design, reference photos and acceptance checks. The instructions below describe the existing calendar app.

## Build and run on a Mac

Requirements: **macOS 14 or later**, **Xcode 15 or later** with its command-line tools selected, and **Node.js 22.17 or later**. An internet connection is required for place search, map tiles, terrain, buildings and weather.

From the repository root:

```sh
bash scripts/build-macos.sh
open build/WhenScape.app
```

The script installs the locked web dependencies, bundles all Cesium code/assets, runs JavaScript and Swift tests, builds the native executable, and packages a signed `.app` with the required calendar, contacts and location permission descriptions and icon. It verifies the finished code signature. Launch the packaged application for EventKit permission testing; a bare `swift run` executable lacks the application’s privacy metadata.

Build caches stay under `.build/`. The signed app is stored in `~/Library/Developer/WhenScape/WhenScape.app`; `build/WhenScape.app` is a symlink to it. This avoids cloud file providers continually adding Finder metadata to app/resource bundles in a synced Documents folder, which invalidates code signing. Set `WHENSCAPE_PRODUCT_DIR` to override the product directory; choose an unsynced local folder. A managed execution environment must allow SwiftPM’s build sandbox and Apple’s icon conversion service to run; run the build outside its nested execution restrictions when needed. No system protections or calendar permissions are changed by the script.

You can open `Package.swift` in Xcode to edit the native code after `npm ci && npm run build`. The GitHub Actions workflow builds, tests and packages the app on a macOS 26 runner when pushed. The local build targets the Mac’s current architecture. It signs with your Apple Development certificate when one is in the keychain, so macOS keeps calendar access across rebuilds, and otherwise signs ad hoc (set `WHENSCAPE_SIGN_IDENTITY` to choose an identity, or `-` for ad hoc).

## First launch

1. The initial exploration is explicitly set to Claremont, California, at the current instant. No sample calendar appointments are inserted.
2. Choose **Connect 3D Data** and enter your [Cesium ion access token](https://ion.cesium.com/tokens). It needs read access to Cesium World Terrain and Cesium OSM Buildings. Keep its scope limited to the assets this app uses. The token is stored in Keychain and is never committed or included in logs. Cesium’s default terrain and OSM asset IDs are used by its library helpers. To see a textured mesh of the real buildings, trees and ground, also add **Google Photorealistic 3D Tiles** (asset `2275207`) to your ion account from the Asset Depot and include it in the token. The scene uses that mesh when the token can read it and otherwise falls back to terrain with OSM building boxes. The mesh was photographed in daylight and cannot be relit, so its look is approximated: it is tinted by the time of day, lifted to a cool tone by moonlight, kept a readable deep blue at night with a warm lamp glow mostly on grey paving, faded into the horizon with distance and in fog, darkened when it rains with a sheen of the sky on wet paving, whitened evenly for snow cover, and crossed by drifting cloud shadows that match the clouds’ pattern but not real cloud positions. By default it casts no computed shadows; the **Computed shadows on the 3D mesh** setting adds shadows that follow the calculated Sun, drawn alongside the photographed ones, which cannot be removed. On a clear night with a bright Moon above the horizon, the flag’s shadow is cast by the Moon instead, more faintly, and notable gusts show as occasional surges of the flag.
3. Choose **Connect calendars** in the week pane if desired. Apple requires full EventKit access to read events; WhenScape implements no event creation, editing or deletion. Manual exploration works without permission.
4. Select an event, search for a place, or click the map to set the exact observer point. Ambiguous text locations show search results for the user to choose. Missing locations obscure the scene until a point is selected.

Without a token, the app provides a clearly labeled astronomical sky preview. It does not substitute invented buildings. A token/network error is also shown explicitly.

## Workspace and controls

- The left third contains an Apple Calendar-style week grid above a mini map. Drag either divider to resize; the calendar’s expansion button widens it temporarily.
- Calendar features include week navigation (the arrows, or a two-finger sideways scroll on a trackpad, which slides the days along and turns to the next or previous week), all-day events, overlapping appointments, calendar colors/filtering and full event detail popovers. The calendar displays the Mac’s time zone, labeled in its header.
- Search the map with Return or the arrow button. Click the map to move the observer, then drag inside the 3D pane, or use ⌥← ⌥→ and ↑ ↓, to look around. The compass resets north. With terrain and OSM buildings the view is from the ground, with no camera translation or elevated view; scrolling or the plus and minus keys zoom the lens. With the photorealistic mesh the view is aerial, because that mesh is captured from the air and breaks down at street level: the camera orbits the pin, dragging, ⌥← ⌥→ and ↑ ↓ orbit and tilt it (a sideways drag below the pin turns the other way, like spinning a turntable from its near edge), and scrolling or the plus and minus keys zoom. Tilting up past the flattest orbit keeps the camera where it is and raises its gaze into the sky, up to 85° above the horizon; tilting back lowers the gaze to the pin before the orbit steepens. While looking up, scrolling or plus and minus zoom the lens instead, down to a 6° field of view. Under the compass, **Look at the Sun** and **Look at the Moon** turn the view to that body, the Moon through a 12° lens so its phase shows; each is dimmed while its body is below the horizon. Below them, **Constellations** draws the figures and names of the 88 constellations among the stars, turning with the sky; like the stars they fade behind cloud and haze and stay behind buildings and the ground, and the choice is remembered. Choosing a new place brings the gaze back to the pin. The camera stays at least 40 m above the pin, so zooming in close steepens the view rather than dropping into the trees. Choosing a new place flies the camera there; any drag, scroll or key cancels the flight. Left alone for 30 seconds while the app is in front, the aerial view slowly circles the pin (about 2° a second) until the next touch; the **Turntable** switch beside Weather (also in Settings and the Explore menu) turns this off, and switching it back on starts the circling at once, and Reduce motion turns off both the flight and the circling. The place's time zone and the Weather and Turntable switches sit with the time controls below the scene.
- **Here** (first of the buttons under the search field) moves the observer to this Mac’s own location; macOS asks for permission the first time, and a rough fix comes with a note to fine-tune it on the map. The crosshair in the Location header centres the map on the observer. Beside the date and time, **Now** jumps to the present moment (it also clears a selected event, as choosing any time does).
- Places you return to can be saved: the star in the Location header saves the current place under a name (Home and Work are one click), or renames or removes it once saved. Saved places sit as buttons under the search field, Home and Work first, followed by the last five places chosen by search, contact or event (map clicks are not kept); right-click a button to remove it. They stay on the Mac. With **Contacts** allowed (the Contacts button under the search field asks once), typing a name also lists people who have an address, above Apple’s place results, and the Home and Work addresses on your own card appear as buttons until you save them. WhenScape only reads names and postal addresses; matching happens on the Mac, and only an address you choose is sent to Apple’s geocoder.
- The observer is placed 1.7 metres above sampled terrain. Choose an outdoor pin; no automatic building-interior detection or street snapping is claimed.
- The native controls below the scene edit an instant or a range, including overnight and multi-day intervals. They display the location’s time zone and UTC offset at the selected instant. Reverse geocoding resolves the zone; if it fails, UTC is explicitly labeled as the fallback.
- ← and → step the time by 15 minutes, landing on the quarter hour, and ⇧← ⇧→ by an hour; Space plays or pauses. These keys work anywhere in the window except while typing in a field or using a date picker. Like the slider, they explore within a selected event rather than deselecting it.
- The slider explores the selected interval, or the selected local day in instant mode. Playback loops at the selected speed. Local days follow DST and can be 23 or 25 hours. All-day events initially use noon on their civil date in the destination time zone. **Reset to event** restores its original selection. The calendar button beside each date field opens a calendar and clock for choosing a day and time. Choosing a date or time there or in the field deselects the event and keeps the place; the slider and playback explore within it.
- The conditions panel over the bottom of the scene folds to a single line (temperature, condition, and the wind and daylight) and opens when hovered or focused; a click keeps it open, and that choice is remembered. Open, it leads with the temperature and condition, a one-sentence summary (including whether sunset or sunrise falls inside a selected range), the wind with notable gusts, the chance of rain, and the Moon’s phase with its next rise or set. Temperatures and speeds use the Mac’s regional units. A strip below charts the selected interval: daylight and darkness, cloud, chance of rain, temperature, sunrise and sunset, and a cursor at the selected instant; hours beyond the forecast window are left blank.
- **Weather** switches between visual weather and a labeled clear-sky astronomical preview. **Data details** exposes the weather category, valid/retrieved times, source, and available precipitation probabilities/rates. **Refresh weather** retries a failed request.
- Scene settings, the weather switch, the playback speed, hidden calendars and the last place are remembered between launches; reduced motion follows the system setting. Scene settings offer low/balanced/high detail, reduced motion, and an explicitly illustrative white-surface treatment, and optional computed shadows on the photorealistic mesh (off by default, since the mesh’s photographed shadows remain). Surface whitening can also reflect an available snow-depth estimate; no accumulation, drifts, melting, frost or puddles are simulated.

## Astronomy, geometry and weather

The Sun, Moon and stars are driven by the selected absolute instant and geographic location. Cesium places the clock-driven Moon and the sidereally rotated star sky, which show through the painted sky. The Moon is lit from the Sun's direction at a fixed strength, so its phase is right and it stays bright after dark, when the rest of the scene is dimmed; by day it shows as a pale disc against the blue. Astronomy Engine independently computes topocentric Sun/Moon positions, lunar illumination and twilight categories. Stars appear once the Sun is 9° below the horizon. Sun lighting and building shadows change with time. Buildings use neutral colors rather than photographic textures with captured shadows.

OSM building heights may be estimated, and roofs, trees, walls and entire buildings may be missing. Terrain/height sampling failures are shown. The geometry is the provider’s available snapshot: choosing a historical date does not reconstruct past buildings. A rendered shadow is only as accurate as the geometry casting it. Live terrain and buildings have been visually checked in Claremont; their dimensions and coverage have not been surveyed for accuracy.

Weather comes from Open-Meteo, with explicit provenance:

| Selected time | Source and representation |
| --- | --- |
| Current hour through the provider’s 16-day forecast window | Hourly forecast; illustrative cloud cover/light, falling rain/snow, fog and wind |
| Earlier hours | Historical archive estimates. The archive runs several days behind, so hours from roughly the last three months fall back to the forecast service’s record of past hours when the archive has none |
| Beyond the forecast window | Five prior complete years of ERA5 samples, within ±3 calendar days at the same UTC hour; at least three years and 14 samples required |
| Missing or failed data | Weather unavailable; no precipitation is invented |

Between hourly values, forecast and historical conditions are blended in proportion to the time, so moving through an hour changes the scene gradually. The blend is a straight line between two model values, not a finer forecast.

The seasonal baseline is a recent historical sample, **not a 30-year climate normal or a prediction**. It changes representative temperature, cloud cover and wind; average rain/snow rates do not produce continuous falling precipitation. Precipitation probability is kept separate from rainfall amount. Wind represents the provider’s 10 m estimate, not building-resolved ground-level airflow. The sky is painted behind terrain and buildings using Cesium’s scene depth: its colours follow the Sun’s calculated direction, with a warm band toward the Sun and a pink band opposite at dusk, and clouds are lit from the Sun’s side and drift downwind. The colours are composed for appearance, not from a physical scattering model, cloud drift is exaggerated to be visible, and cloud shapes are illustrative, not forecast positions. Devices without depth-texture support keep Cesium’s default sky and omit clouds while retaining weather lighting and labels. Rain, snow and haze remain lightweight viewport effects and do not simulate shelter from buildings. In the aerial view a flag stands at the selected point: it streams downwind, hangs when calm or when the wind is unknown, and is sized to stay readable as you zoom rather than to scale. Its shadow is drawn on the ground from the Sun’s calculated direction and height, fades under cloud, and is capped in length near sunrise and sunset; it is an overlay, so it does not bend over walls. Around the flag, a level compass ring sits just above the ground (drawn faintly where roofs and trees hide it) and the day’s Sun path arcs overhead: every point on the arc is in the Sun’s direction at that time, sunrise and sunset meet the ring at their bearings, whole hours are marked in the location’s time zone, a marker shows the Sun now, and the part of the day covered by a selected range is drawn heavier.

Requests use only coordinates and dates. The scene keeps an on-disk web cache private to the app, so downloaded map tiles and weather responses are reused across launches as far as the providers' cache headers allow. Hourly/day caching, timeouts, cancellation, stale-result protection, periodic refresh, and a bounded memory cache limit network work. No event title, attendees or notes are sent to Cesium or Open-Meteo. Apple receives the place query/reverse-geocoding request needed for the map and time zone.

## The browser app

`Site/` holds the browser version: the same 3D scene (`Web/`, loaded in a frame under `scene/`) with a location panel and time controls written for the web. It is a static site, published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

**What it does.** Choose a place by searching, clicking the map, **Here** (the browser's location, on request), a saved place (Home, Work or any name, saved with the star) or a recent one. Times are shown in the place's own time zone, found offline from its coordinates. The date and time fields, **Now**, the time range, the slider, playback, ← → (⇧ for an hour) and Space work as in the Mac app, including while the scene has focus. **Paste event** (or ⌘V/Ctrl+V anywhere on the page) reads an event copied in a calendar app: its title and its time or time range, or its date for an all-day event, which starts at the place's local noon. Calendar's copied text has no location, so the app then asks where the event takes place; **Use …** keeps the current place. **Copy link** copies a link holding the place and time after the `#` (never sent to the server), to paste into an event's URL or notes; opening it shows that place and moment. Settings and saved places stay in the browser. On a phone the page is one column: scene, time, then location; drag to orbit and pinch to zoom.

**Google Maps.** The 3D model is Google's Photorealistic 3D Tiles, read straight from Google's Map Tiles API. Google's terms do not allow its map services to be used “with or near a non-Google Map” (Maps Platform Terms §3.2.3(e)), so the 2D map, place search and the naming of a clicked spot also come from Google (Maps JavaScript API, Places API (New) and Geocoding). The About box gives the notice those terms require. Google lets apps keep its coordinates and looked-up names for at most 30 days, so a saved place found by search keeps only its place ID after 30 days and is looked up again when used; a spot chosen on the map keeps its coordinates but drops its looked-up name; recent places are forgotten after 30 days.

**Setting up the key** (one Google Cloud project, with billing):

1. Enable the **Maps JavaScript API**, **Places API (New)**, **Geocoding API** and **Map Tiles API**.
2. Create an API key. Under *Application restrictions* choose *Websites* and add `https://davbachman.github.io/*` (browsers send only the site's origin with the 3D tile requests, so a path such as `/WhenScape/*` would block them). Under *API restrictions* allow only the four APIs above.
3. Under *Quotas*, cap the daily requests, especially the Map Tiles API's root tileset requests (1,000 a month are free, then about $6 per 1,000). Visitors past the cap see the sky preview without the 3D model.
4. In the GitHub repository, add the key as the Actions secret `GOOGLE_MAPS_API_KEY` (*Settings › Secrets and variables › Actions*), and set *Settings › Pages › Source* to **GitHub Actions**.

The key is public in the page; the website and API restrictions are what protect it. Without a key the site still builds and works, without the map, search or 3D model. To try the site on your own computer, create a second key restricted to `http://127.0.0.1:4174/*` and paste it under **Settings › Developer › Your own Google Maps key**; it stays in that browser.

```sh
npm run build:site            # GOOGLE_MAPS_API_KEY=… to build with a key
npm run preview:site          # http://127.0.0.1:4174/
# In a second terminal, with the preview running:
npm run test:site
```

The site tests replace Google Maps with a stand-in and weather with fixtures, so they need no key or network. They cover search, map clicks and time zones, saved places, time keys in the page and in the scene, pasted timed and all-day events, links reopening the same moment, and the phone layout.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run preview
# In a second terminal, with the preview running:
npm run test:browser
```

The preview is the **scene component only**.

To debug the scene inside the app, turn on **Settings › Developer › Show scene diagnostics**; it turns off again when the app quits. It shows the camera and ground heights, the raw ground readings, the orbit, any raised gaze and its lens, the flag size, tile loading and failures, the frame rate and the weather sample over the scene, and lets Safari's Web Inspector attach to the scene (Develop › this Mac › WhenScape). Debug builds are always inspectable. The scene stops rendering while the window is covered and animates more slowly while the app is in the background. The native calendar and MapKit interface require macOS. Browser tests use Playwright and an installed Chromium (`CHROMIUM_PATH` can override it); otherwise install Playwright’s browser with `npx playwright install chromium`. To use an installed Google Chrome on a Mac:

```sh
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

Mac verification on November 16, 2026 (Apple silicon, macOS 26.6.2, Xcode 27.2, Swift 6.4.2, Node 25.6.0):

- The full build script passes, including the release executable, bundled Cesium assets, icon generation and strict code-signature verification. Fixed a duplicate actor annotation, added the explicit Combine import, and replaced method-reference bindings that produced concurrency warnings.
- All 23 JavaScript tests pass, covering equinox/solstice/eclipse astronomy, time-zone equivalence, weather routing, leap years, seasonal averages, cancellation, caching and missing data.
- All four Swift XCTest cases pass: 23/25-hour DST days, civil noon and forward/backward playback wrapping.
- Chrome integration checks pass for scene startup, no-token messaging, rotation, compass reset, day/night, clear-sky mode, rain, snow and seasonal mode, the Sun and Moon finders, a lit Moon at night, lens zoom and the constellations switch, with no uncaught page errors. Weather network responses in these automated checks are fixtures. A cloud-only fixture confirms the foreground effects canvas stays transparent; a separate pixel regression verifies that clouds alter the sky while preserving opaque building pixels at three camera pitches with both linear and logarithmic depth.
- The packaged native app launches and renders Cesium in WKWebView. Manually verified MapKit tiles and place search/selection, calendar width expansion/restoration, camera rotation/north reset, clear-sky/weather switching, time scrubbing, night stars, range playback, weather provenance and the native settings sheet. Live Open-Meteo forecast data loads in the app. Fixed the repeated window title and the setup notice overlapping expanded weather details; checked default and minimum window sizes.
- The running native asset server serves the bundled HTML, JavaScript and Cesium workers over `127.0.0.1` only. HTTP smoke checks pass for HEAD/MIME behavior, rejected POST requests, invalid hosts, traversal attempts and missing files. The local app ZIP was checked to contain the executable and bundled web assets.
- After the user connected calendars, the populated week grid and event selection were observed in the native app. The permission approval itself was performed by the user. The latest development rebuild shows **Connect calendars** again; reconnection has been left to the user. Ad-hoc development builds may need permission again after rebuilding. The EventKit service still has no save/delete/commit operations, and no calendar records were created or modified during verification.
- The user saved a Cesium ion token with access to World Terrain (`1`) and OSM Buildings (`96188`); live terrain and buildings load in Claremont. A buildings-only token was confirmed to fail because terrain is required for alignment.
- Fixed the apparent horizontal horizon line through buildings: the former foreground cloud canvas clipped at an estimated screen horizon. Clouds now use scene depth and viewing direction. Verified the rebuilt WKWebView at 333 N Indian Hill Blvd with live overcast weather, terrain and buildings; the large foreground façade is unobscured. The saved Cesium token survived the rebuild.

## Code map

- `Sources/WhenScape/WhenScapeApp.swift`: three-pane workspace, time controls and settings.
- `CalendarService.swift` / `CalendarView.swift`: immutable EventKit projections and calendar grid.
- `AppModel.swift` / `MapPane.swift`: exploration state, time zones, geocoding, map selection and saved places.
- `ContactsService.swift` / `CurrentLocation.swift`: read-only contact address lookup, and this Mac’s location on request.
- `CesiumView.swift` / `LocalAssetServer.swift`: WKWebView bridge and loopback-only bundled assets.
- `Sources/WhenScapeCore`: testable date/playback behavior, saved and recent places, and calendar swipe handling.
- `Web/scene.js`: renderer, fixed observer, geography and visual effects.
- `Web/clouds.js`: sky cloud compositing with terrain/building depth masking.
- `Web/astronomy.js` / `Web/weather.js`: independently testable calculations and weather acquisition.
- `Site/site.js`: the browser app's state, location panel, time controls and bridge to the scene's frame.
- `Site/google.js`: Google's map, place search and spot naming. `Site/time.js`: time zones with the browser's Intl. `Site/paste.js`: reading copied calendar events. `Site/link.js`: WhenScape links. `Site/places.js`: saved and recent places with Google's 30-day limit.
- `scripts/build-site.mjs`: builds `dist/site`, with the key in `config.js`.

The embedded page is served from an ephemeral loopback port because Cesium workers need a normal origin. That server serves bundled static files only; state and tokens pass directly through WKWebView. It binds only to `127.0.0.1`, validates paths/hosts, limits request sizes and lifetime, and has no write endpoint. External document navigation is blocked; explicit HTTPS attribution links open in the default browser. Calendar data remains native.

## Providers and distribution

The application code is under the repository’s MIT license. CesiumJS is Apache-2.0; Astronomy Engine is MIT. The constellation figures come from Olaf Frohn’s [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD 3-Clause), whose lines follow the IAU constellation charts. Their license notices are bundled with the scene. Cesium’s asset credits remain visible, including **© OpenStreetMap contributors** for OSM data. See the [OSM copyright/license](https://www.openstreetmap.org/copyright) and [Cesium OSM content/attribution requirements](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/).

[Open-Meteo](https://open-meteo.com/) data requires attribution under its applicable data license. Its public API endpoint is for **non-commercial use** and is subject to rate limits. Configure an appropriate commercial plan before commercial distribution; the service endpoints are defined in `Web/weather.js`. Review [Open-Meteo pricing and terms](https://open-meteo.com/en/pricing), [Cesium ion plans](https://cesium.com/platform/cesium-ion/pricing/), and Apple’s MapKit terms for the intended usage. No subscriptions, paid services or accounts are created by the build.

Before distributing outside development, finish native/live-data testing, choose provider plans, configure your own bundle identifier/signing identity, enable and test the intended app sandbox entitlements (calendar, network client and loopback server), and notarize the app. The supplied build is a development-signed (or ad-hoc-signed) development application.
