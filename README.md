# WhenScape

WhenScape is a macOS screen saver that shows the Ralph Larkin Memorial Sundial in Claremont in one fixed 3D view. The spindle casts its shadow on the **PST** scale year-round. The caption identifies which edge to read. In summer the dial is an hour behind Claremont’s civil clock. The nighttime sunrise caption uses Claremont’s local time, including daylight saving.

On macOS 14 or later, sign in to GitHub and download **WhenScape-saver-macOS** from the Artifacts section of a successful [Validate WhenScape run](https://github.com/davbachman/WhenScape/actions/workflows/validate.yml) with a **mac-saver** job. Extract `WhenScape-saver-macOS.zip`, open `WhenScape.saver` in Finder, and select **WhenScape** in System Settings under **Screen Saver**. To install by hand, copy the bundle into `~/Library/Screen Savers/` and reopen System Settings. CI produces an ad-hoc signed development bundle. A public release would require Developer ID signing and notarization.

Build from source on a Mac with Xcode, or run the portable tests from macOS or Linux with a C and C++17 toolchain:

```sh
scripts/test-saver.sh
scripts/build-saver.sh
build/WhenScapePreview --fixture clear
```

The bundle is `build/WhenScape.saver`. The first build fetches hash-pinned [Astronomy Engine 2.1.19 C source](https://github.com/cosinekitty/astronomy/tree/v2.1.19/source/c). Both the engine license and the project license are included in the bundle. The default build supports Apple silicon and Intel. Set `WHENSCAPE_SAVER_ARCHS=arm64` to build only for Apple silicon. No map service, location permission, calendar access or Cesium token is needed. Live weather uses Open-Meteo’s [non-commercial API](https://open-meteo.com/en/terms), with model estimates for the preset Claremont coordinates. The astronomical scene continues offline.

See the [sundial reconstruction and Mac checks](docs/sundial-saver.md) and the [design handoff](docs/sundial-handoff.md).
