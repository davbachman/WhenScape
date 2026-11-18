# WhenScape screen saver

## Reconstruction

The scene uses the built-in reference point of 34.100° N, 117.728° W and a fixed oblique camera. The y-axis is up, positive x is east, and negative z is true north. The concrete and terrazzo model is an approximate reconstruction. The North American Sundial Society records a 90-inch diameter spherical face and a 40-inch fiberglass gnomon. The scale, support proportions, stone finish, placement of the month guide, and surrounding scene are modeled geometry. [Handoff photo references](https://www.mikeraugh.org/Talks/LACC-2008.pdf#page=9) · [NASS registry entry](https://sundials.org/index.php/sundial-registry/onedial/505)

The wire points true north at an elevation of 34.100°. Hours advance by 15° on the scale and XII is offset by 2.272° for the difference between Claremont’s longitude and the PST meridian. At a given solar declination the two branches of the annual equation-of-time curve usually need different corrections. The same stationary spindle approximates both with the earlier and later shadow edges. The profile uses half the difference of the two corrections as the tangent angle, an approximation that leaves a small common offset. The hour ticks start at the central lane where the profile was calibrated. [USNO equation of time](https://aa.usno.navy.mil/faq/eqtime)

The renderer casts rays from the spherical scale toward the topocentric Sun and solves for intersections with the wire and spindle frusta. Those intersections define the rendered shadow band. The night caption formats the next standard astronomical sunrise in `America/Los_Angeles`. Stars use a procedural field that rotates at the local sidereal rate. The Moon uses its computed topocentric position and phase with an enlarged disc for visibility.

## Verification

`scripts/test-saver.sh` samples morning, noon and afternoon across 2024, 2026 and 2030, covering seasonal extrema, dates around both DST transitions and both shadow edges. It recovers the reading from the geometry used by the renderer and checks the ray immediately inside and outside the selected edge. It also checks the polar orientation, lunar visibility and illumination, sunrise around DST, weather intensities, wind direction and cache expiry.

`scripts/build-saver.sh` produces an ad-hoc signed bundle. The macOS workflow loads its principal class in the preview host and exercises start, frame update, and stop against the fixtures without making network requests. The saved CI artifact is **WhenScape-saver-macOS**, containing `WhenScape-saver-macOS.zip`.

The preview host uses the installed bundle entry point. Run it without arguments for live conditions. Use `--fixture NAME` to freeze the date and weather while the flag and precipitation continue to animate. Add `--system-size` to use the small preview render settings. Use `--capture file.png` to save the 3D scene frame. The runner publishes selected frames as **WhenScape-saver-previews**.

| Fixtures | What to inspect |
| --- | --- |
| `clear`, `summer`, `morning`, `afternoon` | Read the indicated shadow edge at the central tick lane. The expected readings are 12:00, 12:00, 8:30 and 15:30 PST. At summer noon PST, the civil time is 1 PM PDT. |
| `overcast`, `fog`, `rain` | Reduced direct light, lower contrast with distance, and rain in depth around the model. |
| `snow`, `snow-cover` | Falling flakes and accumulation, then ground snow without flakes. |
| `calm`, `clear`, `afternoon` | Limp flag in calm, streaming east with wind from west, and south with wind from north. |
| `twilight`, `night`, `moon`, `cloudy-night` | Twilight color, star visibility, lunar phase and next sunrise. |
| `offline`, `stale` | Weather unavailable indication with the dial and clear astronomical sky still present. |

On a real Mac, install the artifact and check System Settings preview and actual idle activation. Also check full-screen sizing, repeated dismissal and reactivation, sleep and wake, an external display where available, live and disconnected weather, and CPU/GPU use in a quiet scene. Compare the visible shadow and ticks in the preview fixtures, especially in the small System Settings preview.
