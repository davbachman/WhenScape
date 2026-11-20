# WhenScape

A native macOS calendar companion for exploring a place at a particular time. SwiftUI and EventKit provide a read-only week calendar, MapKit selects the observer’s location, and a bundled CesiumJS scene displays real terrain, simplified buildings, astronomy and illustrative weather.

The next version is a sundial screen saver. See [the sundial handoff](docs/sundial-handoff.md) for the design, reference photos and acceptance checks. The instructions below describe the existing calendar app.

## Build and run on a Mac

Requirements: **macOS 14 or later**, **Xcode 15 or later** with its command-line tools selected, and **Node.js 22.17 or later**. An internet connection is required for place search, map tiles, terrain, buildings and weather.

From the repository root:

```sh
bash scripts/build-macos.sh
open build/WhenScape.app
```

The script installs the locked web dependencies, bundles all Cesium code/assets, runs JavaScript and Swift tests, builds the native executable, and packages a signed `.app` with the required calendar permission description and icon. It verifies the finished code signature. Launch the packaged application for EventKit permission testing; a bare `swift run` executable lacks the application’s privacy metadata.

Build caches stay under `.build/`. The signed app is stored in `~/Library/Developer/WhenScape/WhenScape.app`; `build/WhenScape.app` is a symlink to it. This avoids cloud file providers continually adding Finder metadata to app/resource bundles in a synced Documents folder, which invalidates code signing. Set `WHENSCAPE_PRODUCT_DIR` to override the product directory; choose an unsynced local folder. A managed execution environment must allow SwiftPM’s build sandbox and Apple’s icon conversion service to run; run the build outside its nested execution restrictions when needed. No system protections or calendar permissions are changed by the script.

You can open `Package.swift` in Xcode to edit the native code after `npm ci && npm run build`. The GitHub Actions workflow builds, tests and packages the app on a macOS 26 runner when pushed. The local build targets the Mac’s current architecture. It signs with your Apple Development certificate when one is in the keychain, so macOS keeps calendar access across rebuilds, and otherwise signs ad hoc (set `WHENSCAPE_SIGN_IDENTITY` to choose an identity, or `-` for ad hoc).

## First launch

1. The initial exploration is explicitly set to Claremont, California, at the current instant. No sample calendar appointments are inserted.
2. Choose **Connect 3D Data** and enter your [Cesium ion access token](https://ion.cesium.com/tokens). It needs read access to Cesium World Terrain and Cesium OSM Buildings. Keep its scope limited to the assets this app uses. The token is stored in Keychain and is never committed or included in logs. Cesium’s default terrain and OSM asset IDs are used by its library helpers. To see a textured mesh of the real buildings, trees and ground, also add **Google Photorealistic 3D Tiles** (asset `2275207`) to your ion account from the Asset Depot and include it in the token. The scene uses that mesh when the token can read it and otherwise falls back to terrain with OSM building boxes. The mesh was photographed in daylight and cannot be relit, so its look is approximated: it is tinted by the time of day, lifted slightly by moonlight, given a warm tone on pale surfaces after dark, faded into the horizon with distance and in fog, darkened when it rains, whitened evenly for snow cover, and crossed by drifting cloud shadows that match the clouds’ pattern but not real cloud positions. By default it casts no computed shadows; the **Computed shadows on the 3D mesh** setting adds shadows that follow the calculated Sun, drawn alongside the photographed ones, which cannot be removed. On a clear night with a bright Moon above the horizon, the flag’s shadow is cast by the Moon instead, more faintly, and notable gusts show as occasional surges of the flag.
3. Choose **Connect calendars** in the week pane if desired. Apple requires full EventKit access to read events; WhenScape implements no event creation, editing or deletion. Manual exploration works without permission.
4. Select an event, search for a place, or click the map to set the exact observer point. Ambiguous text locations show search results for the user to choose. Missing locations obscure the scene until a point is selected.

Without a token, the app provides a clearly labeled astronomical sky preview. It does not substitute invented buildings. A token/network error is also shown explicitly.

## Workspace and controls

- The left third contains an Apple Calendar-style week grid above a mini map. Drag either divider to resize; the calendar’s expansion button widens it temporarily.
- Calendar features include week navigation, all-day events, overlapping appointments, calendar colors/filtering and full event detail popovers. The calendar displays the Mac’s time zone, labeled in its header.
- Search the map with Return or the arrow button. Click the map to move the observer, then drag inside the 3D pane or use arrow keys to look left/right/up/down. The compass resets north. With terrain and OSM buildings the view is from the ground, with no camera translation, zoom or elevated view. With the photorealistic mesh the view is aerial, because that mesh is captured from the air and breaks down at street level: the camera orbits the pin, dragging or the arrow keys orbit and tilt it (a sideways drag below the pin turns the other way, like spinning a turntable from its near edge), and scrolling or the plus and minus keys zoom. The camera stays at least 40 m above the pin, so zooming in close steepens the view rather than dropping into the trees.
- The observer is placed 1.7 metres above sampled terrain. Choose an outdoor pin; no automatic building-interior detection or street snapping is claimed.
- The native controls below the scene edit an instant or a range, including overnight and multi-day intervals. They display the location’s time zone and UTC offset at the selected instant. Reverse geocoding resolves the zone; if it fails, UTC is explicitly labeled as the fallback.
- The slider explores the selected interval, or the selected local day in instant mode. Playback loops at the selected speed. Local days follow DST and can be 23 or 25 hours. All-day events initially use noon on their civil date in the destination time zone. **Reset to event** restores its original selection. The calendar button beside each date field opens a calendar and clock for choosing a day and time. Choosing a date or time there or in the field deselects the event and keeps the place; the slider and playback explore within it.
- The conditions panel leads with the temperature and condition, a one-sentence summary (including whether sunset or sunrise falls inside a selected range), the wind with notable gusts, the chance of rain, and the Moon’s phase with its next rise or set. Temperatures and speeds use the Mac’s regional units. A strip below charts the selected interval: daylight and darkness, cloud, chance of rain, temperature, sunrise and sunset, and a cursor at the selected instant; hours beyond the forecast window are left blank.
- **Weather** switches between visual weather and a labeled clear-sky astronomical preview. **Data details** exposes the weather category, valid/retrieved times, source, and available precipitation probabilities/rates. **Refresh weather** retries a failed request.
- Scene settings, the weather switch, the playback speed, hidden calendars and the last place are remembered between launches; reduced motion follows the system setting. Scene settings offer low/balanced/high detail, reduced motion, and an explicitly illustrative white-surface treatment, and optional computed shadows on the photorealistic mesh (off by default, since the mesh’s photographed shadows remain). Surface whitening can also reflect an available snow-depth estimate; no accumulation, drifts, melting, frost or puddles are simulated.

## Astronomy, geometry and weather

The Sun, Moon and stars are driven by the selected absolute instant and geographic location. Cesium draws its clock-driven Sun, sun-lit lunar ellipsoid (including phase), and sidereally rotated star sky. Astronomy Engine independently computes topocentric Sun/Moon positions, lunar illumination and twilight categories. Stars are suppressed in daylight. Sun lighting and building shadows change with time. Buildings use neutral colors rather than photographic textures with captured shadows.

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

To debug the scene inside the app, turn on **Settings › Developer › Show scene diagnostics**. It shows the camera and ground heights, the raw ground readings, the orbit, the flag size, tile loading and failures, the frame rate and the weather sample over the scene, and lets Safari's Web Inspector attach to the scene (Develop › this Mac › WhenScape). Debug builds are always inspectable. The scene stops rendering while the window is covered and animates more slowly while the app is in the background. The native calendar and MapKit interface require macOS. Browser tests use Playwright and an installed Chromium (`CHROMIUM_PATH` can override it); otherwise install Playwright’s browser with `npx playwright install chromium`. To use an installed Google Chrome on a Mac:

```sh
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

Mac verification on November 16, 2026 (Apple silicon, macOS 26.6.2, Xcode 27.2, Swift 6.4.2, Node 25.6.0):

- The full build script passes, including the release executable, bundled Cesium assets, icon generation and strict code-signature verification. Fixed a duplicate actor annotation, added the explicit Combine import, and replaced method-reference bindings that produced concurrency warnings.
- All 23 JavaScript tests pass, covering equinox/solstice/eclipse astronomy, time-zone equivalence, weather routing, leap years, seasonal averages, cancellation, caching and missing data.
- All four Swift XCTest cases pass: 23/25-hour DST days, civil noon and forward/backward playback wrapping.
- Chrome integration checks pass for scene startup, no-token messaging, rotation, compass reset, day/night, clear-sky mode, rain, snow and seasonal mode, with no uncaught page errors. Weather network responses in these automated checks are fixtures. A cloud-only fixture confirms the foreground effects canvas stays transparent; a separate pixel regression verifies that clouds alter the sky while preserving opaque building pixels at three camera pitches with both linear and logarithmic depth.
- The packaged native app launches and renders Cesium in WKWebView. Manually verified MapKit tiles and place search/selection, calendar width expansion/restoration, camera rotation/north reset, clear-sky/weather switching, time scrubbing, night stars, range playback, weather provenance and the native settings sheet. Live Open-Meteo forecast data loads in the app. Fixed the repeated window title and the setup notice overlapping expanded weather details; checked default and minimum window sizes.
- The running native asset server serves the bundled HTML, JavaScript and Cesium workers over `127.0.0.1` only. HTTP smoke checks pass for HEAD/MIME behavior, rejected POST requests, invalid hosts, traversal attempts and missing files. The local app ZIP was checked to contain the executable and bundled web assets.
- After the user connected calendars, the populated week grid and event selection were observed in the native app. The permission approval itself was performed by the user. The latest development rebuild shows **Connect calendars** again; reconnection has been left to the user. Ad-hoc development builds may need permission again after rebuilding. The EventKit service still has no save/delete/commit operations, and no calendar records were created or modified during verification.
- The user saved a Cesium ion token with access to World Terrain (`1`) and OSM Buildings (`96188`); live terrain and buildings load in Claremont. A buildings-only token was confirmed to fail because terrain is required for alignment.
- Fixed the apparent horizontal horizon line through buildings: the former foreground cloud canvas clipped at an estimated screen horizon. Clouds now use scene depth and viewing direction. Verified the rebuilt WKWebView at 333 N Indian Hill Blvd with live overcast weather, terrain and buildings; the large foreground façade is unobscured. The saved Cesium token survived the rebuild.

## Code map

- `Sources/WhenScape/WhenScapeApp.swift`: three-pane workspace, time controls and settings.
- `CalendarService.swift` / `CalendarView.swift`: immutable EventKit projections and calendar grid.
- `AppModel.swift` / `MapPane.swift`: exploration state, time zones, geocoding and map selection.
- `CesiumView.swift` / `LocalAssetServer.swift`: WKWebView bridge and loopback-only bundled assets.
- `Sources/WhenScapeCore`: testable date/playback behavior.
- `Web/scene.js`: renderer, fixed observer, geography and visual effects.
- `Web/clouds.js`: sky cloud compositing with terrain/building depth masking.
- `Web/astronomy.js` / `Web/weather.js`: independently testable calculations and weather acquisition.

The embedded page is served from an ephemeral loopback port because Cesium workers need a normal origin. That server serves bundled static files only; state and tokens pass directly through WKWebView. It binds only to `127.0.0.1`, validates paths/hosts, limits request sizes and lifetime, and has no write endpoint. External document navigation is blocked; explicit HTTPS attribution links open in the default browser. Calendar data remains native.

## Providers and distribution

The application code is under the repository’s MIT license. CesiumJS is Apache-2.0; Astronomy Engine is MIT. Their license notices are bundled with the scene. Cesium’s asset credits remain visible, including **© OpenStreetMap contributors** for OSM data. See the [OSM copyright/license](https://www.openstreetmap.org/copyright) and [Cesium OSM content/attribution requirements](https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/).

[Open-Meteo](https://open-meteo.com/) data requires attribution under its applicable data license. Its public API endpoint is for **non-commercial use** and is subject to rate limits. Configure an appropriate commercial plan before commercial distribution; the service endpoints are defined in `Web/weather.js`. Review [Open-Meteo pricing and terms](https://open-meteo.com/en/pricing), [Cesium ion plans](https://cesium.com/platform/cesium-ion/pricing/), and Apple’s MapKit terms for the intended usage. No subscriptions, paid services or accounts are created by the build.

Before distributing outside development, finish native/live-data testing, choose provider plans, configure your own bundle identifier/signing identity, enable and test the intended app sandbox entitlements (calendar, network client and loopback server), and notarize the app. The supplied build is a development-signed (or ad-hoc-signed) development application.
