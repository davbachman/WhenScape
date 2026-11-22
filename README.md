# WhenScape

See the light, sky and weather at a place and time, in 3D. WhenScape is a browser app for computers and phones, published at **https://davbachman.github.io/WhenScape/**.

Choose a place and a moment, or a stretch of time such as a calendar event, and the scene shows that place from the air with the Sun, Moon, planets and stars where they will be, the day's light, and the weather forecast, recorded or typical for the date. Paste an event copied from your calendar to bring in its time, and copy a WhenScape link into the event to come back to the same place and moment.

## Using it

**Place.** Search, click the map, choose **Here** (the browser's location, on request), or a saved or recent place. The star in the Location header saves the current place under a name (Home and Work are one click); saved places sit as buttons under the search field, followed by recent ones. Times are shown in the place's own time zone, found from its coordinates without a network request.

**Time.** The date opens a calendar and the time a picker of hours and minutes (on phones, the device's own); both stay on screen however close to the bottom of the window the field is. **Now** jumps to the present. **Time range** sets a start and end, overnight or over several days. The slider explores the selected day or range, playback runs it at 1, 5 or 30 minutes a second, ← and → step a quarter hour (⇧ for an hour) and Space plays or pauses, including while the scene has focus.

**Calendar events.** **Paste event** (or ⌘V/Ctrl+V anywhere on the page) reads an event copied in a calendar app: its title and its time or range, or its date for an all-day event, which starts at the place's local noon. Copied events carry no location, so the app then asks where the event takes place; **Use …** keeps the current place. **Reset to event** returns to it after exploring. **Copy link** copies a link holding the place and time after the `#`, which browsers never send to the site; paste it into an event's URL or notes. Pasted calendar text is read in the page and not sent anywhere.

**The 3D view.** With Google's Photorealistic 3D Tiles the view is aerial: the camera orbits the pin and dragging orbits and tilts it (a sideways drag below the pin turns the other way, like spinning a turntable from its near edge); scrolling, pinching or the plus and minus keys zoom; ⌥← ⌥→ and ↑ ↓ do the same from the keyboard. Drags are applied once per display frame and eased over a few frames, so the view moves smoothly in Safari, which delivers pointer moves out of step with the display. The camera stays at least 40 m above the pin. Tilting up past the flattest orbit keeps the camera still and raises its gaze into the sky, up to 85°; while looking up, zooming narrows the lens to as little as 6°. Choosing a new place flies the camera there. Left alone for 30 seconds the view slowly circles the pin; the **Turntable** switch turns this off. Without the 3D model (no key, or today's quota used) the view is a ground-level sky preview.

Under the compass, **Look at the Sun** and **Look at the Moon** turn to that body, the Moon through a 12° lens so its phase shows; each is dimmed while its body is below the horizon. **Constellations** draws the figures and names of the 88 constellations, and the choice is remembered. A flag at the pin streams downwind and casts a shadow from the Sun, or on a bright clear night from the Moon. Around it a compass ring sits on the ground and the day's Sun path arcs overhead, with sunrise, sunset, the hours and the Sun now; a selected range is drawn heavier.

**The sky.** The Sun, Moon and stars follow the selected instant and place. The five naked-eye planets are drawn among the stars, sized by brightness and named. During a meteor shower its radiant is marked with short rays and its name, and after dark meteors streak away from it; they come 30 times as often as real ones so a few show while you look, in proportion to the rate you would see, and stop with reduced motion.

**Conditions.** The panel over the bottom of the scene folds to one line and opens when hovered or focused; a click keeps it open. It gives the temperature and condition, a one-sentence summary (including whether sunset or sunrise falls inside a range), the wind with notable gusts, the chance of rain, the air quality with its colour on the US scale, the Moon's phase and next rise or set, the planets up after dark, and an active meteor shower with about how many an hour you would see. A strip charts the day or range: daylight and darkness, cloud, chance of rain, temperature, sunrise and sunset. **Data details** gives the sources, times and fuller notes; **Weather** off shows a clear astronomical sky.

**Settings.** Detail (low, balanced, high), reduce motion, the turntable, illustrative white surfaces, computed shadows on the 3D mesh, scene diagnostics, and your own Google Maps key for local testing. Settings, saved places and the last place stay in the browser.

**Phones.** The page is one column: scene, time, then location. Drag to orbit and pinch to zoom.

## Data and accuracy

**Astronomy** is calculated with Astronomy Engine: topocentric Sun and Moon positions, lunar phase and twilight, rise and set times, and the planets' positions and brightness. Cesium supplies the star field, turned with sidereal time; stars appear once the Sun is 9° below the horizon. Constellation figures, planets and meteor radiants share one frame with Cesium's stars, so they stay on them. The Moon is lit from the Sun's direction at a fixed strength, so its phase is right and it stays bright after dark.

**Meteor showers** follow the International Meteor Organization's working list of major showers, approximately: active dates, peaks in solar longitude, radiants and their drift, speeds and peak rates (ZHR). Activity rises and falls exponentially either side of the peak, as the IMO models it. The rate you would see is lowered by the radiant's height, twilight and moonlight, and assumes a dark site and a clear sky; the conditions say "if clear" under heavy cloud.

**Weather** comes from Open-Meteo, with its provenance in **Data details**:

| Selected time | Source and representation |
| --- | --- |
| Current hour through the provider’s 16-day forecast window | Hourly forecast; illustrative cloud cover and light, falling rain or snow, fog and wind |
| Earlier hours | Historical archive estimates. The archive runs several days behind, so recent hours fall back to the forecast service’s record of past hours |
| Beyond the forecast window | Five prior complete years of ERA5 samples, within ±3 calendar days at the same UTC hour; at least three years and 14 samples required |
| Missing or failed data | Weather unavailable; no precipitation is invented |

Between hourly values, conditions are blended in proportion to the time. The seasonal baseline is a recent historical sample, **not a 30-year climate normal or a prediction**; average rain and snow rates do not produce falling precipitation. Wind is the provider's 10 m estimate.

**Air quality** is a model estimate from the Copernicus Atmosphere Monitoring Service (CAMS), served by Open-Meteo's air quality API, on a grid about 45 km across (11 km in Europe), from August 2022 to about five days ahead. The headline is the US Air Quality Index, the worst of its pollutants' indices, with particles averaged over 24 hours and ozone over 8; for a range it is the worst hour.

**The 3D model** is Google's Photorealistic 3D Tiles, photographed in daylight; it shows the place as captured, not as it was at a past date. Its look is approximated: tinted by the time of day, cooled by moonlight, a readable deep blue at night with a warm lamp glow on paving, faded with distance and fog, darkened with a wet sheen in rain, whitened for snow cover, and crossed by drifting cloud shadows that match the painted clouds, not real ones. Computed shadows, off by default, are drawn alongside the photographed ones, which cannot be removed.

**Illustrative.** The sky is painted behind the model using the scene's depth: its colours follow the Sun's direction and clouds drift downwind, but the colours are composed for appearance rather than from a scattering model, and cloud shapes are not forecast positions. Rain, snow and haze are viewport effects. The flag is sized to stay readable rather than to scale. Meteors are shown far more often than they occur.

## Google Maps

The 3D model is read straight from Google's Map Tiles API. Google's terms do not allow its map services to be used “with or near a non-Google Map” (Maps Platform Terms §3.2.3(e)), so the 2D map, place search and the naming of a clicked spot also come from Google (Maps JavaScript API, Places API (New) and Geocoding). The About box gives the notice those terms require. Google lets apps keep its coordinates and looked-up names for at most 30 days, so a saved place found by search keeps only its place ID after 30 days and is looked up again when used; a spot chosen on the map keeps its coordinates but drops its looked-up name; recent places are forgotten after 30 days.

**Setting up the key** (one Google Cloud project, with billing):

1. Enable the **Maps JavaScript API**, **Places API (New)**, **Geocoding API** and **Map Tiles API**.
2. Create an API key. Under *Application restrictions* choose *Websites* and add `https://davbachman.github.io/*` (browsers send only the site's origin with the 3D tile requests, so a path such as `/WhenScape/*` would block them). Under *API restrictions* allow only the four APIs above.
3. Under *Quotas*, cap the daily requests, especially the Map Tiles API's root tileset requests (1,000 a month are free, then about $6 per 1,000). Visitors past the cap see the sky preview without the 3D model.
4. In the GitHub repository, add the key as the Actions secret `GOOGLE_MAPS_API_KEY` (*Settings › Secrets and variables › Actions*), and set *Settings › Pages › Source* to **GitHub Actions**.

The key is public in the page; the website and API restrictions are what protect it. Without a key the site still builds and works, without the map, search or 3D model. To try the site on your own computer, create a second key restricted to `http://127.0.0.1:4174/*` and paste it under **Settings › Developer › Your own Google Maps key**; it stays in that browser.

## Privacy

Saved places, recent places and settings stay in the browser. Place searches, the map and the 3D model come from Google, which receives your searches and the places you look at. Weather and air quality come from Open-Meteo, which receives the place's coordinates and the time. Your own location is read only when you choose **Here**, with the browser's permission. Pasted calendar text is read in the page and not sent anywhere. Links keep the place and time after the `#`, which browsers do not send to the site.

## Development

Requirements: **Node.js 22.17 or later**. `npm ci` installs the locked dependencies.

```sh
npm test                      # unit tests
npm run build:site            # the site in dist/site; GOOGLE_MAPS_API_KEY=… to build with a key
npm run preview:site          # http://127.0.0.1:4174/
npm run test:site             # in a second terminal, with the preview running
npm run build                 # the 3D scene on its own, in dist/scene
npm run preview               # http://127.0.0.1:4173/
npm run test:browser          # in a second terminal, with that preview running
```

The browser tests use Playwright with Chromium (`npx playwright install chromium`, or set `CHROMIUM_PATH`, for example to Google Chrome on a Mac). They replace Google Maps with a stand-in and weather and air quality with fixtures, so they need no key or network:

- **Unit tests** cover astronomy (equinoxes, solstices, eclipses, rise and set), planets, meteor shower activity and visible rates, constellation data, time zones and wall-clock times, the calendar and time picker, pasted events, links, saved places with Google's 30-day limit, weather routing, blending, seasonal samples, caching and cancellation, air quality parsing and requests, and the conditions' wording.
- **Scene tests** cover startup, rotation and the compass, day and night, clear sky, rain, snow, seasonal weather, the Sun and Moon finders, a lit night Moon, lens zoom, constellations on and off, planets, Perseid meteors with motion on and off, air quality, and a pixel check that clouds stay behind buildings at three camera pitches with linear and logarithmic depth.
- **Site tests** cover search, map clicks and time zones, saved places, time keys in the page and the scene, the calendar and time picker, pasted timed and all-day events, links reopening the same moment, and the phone layout.

`.github/workflows/pages.yml` runs all three on every push and pull request, and on `main` publishes the site to GitHub Pages.

To look inside the scene, turn on **Settings › Developer › Show scene diagnostics**: camera and ground heights, the orbit, any raised gaze and its lens, the flag size, tile loading and failures, the frame rate, meteor streaks, and the weather sample. The scene stops drawing while the page is hidden and animates more slowly while its window is in the background.

## Code map

- `Site/site.js`: the page's state, location panel, time controls and bridge to the scene's frame. `Site/google.js`: Google's map, place search and spot naming. `Site/time.js`: time zones with the browser's Intl. `Site/calendar.js` and `Site/timepicker.js`: the date and time popovers, placed by `Site/popover.js`. `Site/paste.js`: copied calendar events. `Site/link.js`: WhenScape links. `Site/places.js`: saved and recent places.
- `Web/scene.js`: the 3D scene: renderer, camera, geography, sky and effects. `Web/clouds.js`: the painted sky and clouds behind the model. `Web/meshlook.js`: relighting the photographed model. `Web/flag.js`, `Web/guides.js` and `Web/guideview.js`: the flag, compass ring and Sun path.
- `Web/skyframe.js`: the sky's frame, shared by `Web/constellationview.js` (with `Web/constellations.js`), `Web/planetview.js` and `Web/meteorview.js`. `Web/meteors.js`: meteor showers and their rates.
- `Web/astronomy.js`, `Web/weather.js`, `Web/airquality.js`, `Web/briefing.js` and `Web/timeline.js`: calculations, data and wording, independent of the renderer.
- `scripts/build-site.mjs` builds `dist/site` with the key in `config.js`; `scripts/build-web.mjs` builds the scene; `scripts/preview.mjs` serves either.

## Providers and licenses

The application code is under the repository’s MIT license. CesiumJS is Apache-2.0; Astronomy Engine is MIT; tz-lookup's time zone data is CC0. The constellation figures come from Olaf Frohn’s [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD 3-Clause), whose lines follow the IAU constellation charts. Their license notices are bundled with the site.

[Open-Meteo](https://open-meteo.com/) data, including CAMS air quality from the [Copernicus Atmosphere Monitoring Service](https://atmosphere.copernicus.eu/), requires attribution, which the conditions panel gives. Its public API is for **non-commercial use** and is rate limited; the endpoints are defined in `Web/weather.js` and `Web/airquality.js`. Review [Open-Meteo's pricing and terms](https://open-meteo.com/en/pricing) and the Google Maps Platform terms before any commercial use. No subscriptions, paid services or accounts are created by the build.

The macOS app that WhenScape began as was retired in November 2026; it is in the repository's history before then.
