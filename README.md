# WhenScape

WhenScape is a macOS screen saver that shows the Ralph Larkin Memorial Sundial in Claremont in one fixed 3D view. The spindle casts its shadow on the **PST** scale year-round. The caption identifies which edge to read. In summer the dial is an hour behind Claremont’s civil clock. The nighttime sunrise caption uses Claremont’s local time, including daylight saving.

## Install on a Mac

1. Sign in to GitHub and download **WhenScape-saver-macOS** from the Artifacts section of a successful [Validate WhenScape run](https://github.com/davbachman/WhenScape/actions/workflows/validate.yml). Open the downloaded archive, then extract `WhenScape-saver-macOS.zip` inside it.
2. Open `WhenScape.saver` in Finder and accept the install prompt. You can also copy the bundle into `~/Library/Screen Savers/` and reopen System Settings.
3. On macOS Tahoe 26 and later, open **System Settings → Wallpaper → Screen Saver → Custom**. Scroll to **Other** and select **WhenScape**. On macOS 14 and 15, open **Screen Saver** directly in the System Settings sidebar and scroll to **Other**. [Apple’s Tahoe guide](https://support.apple.com/en-sg/guide/mac-help/mchle95c1370/26/mac/26)

The GitHub ZIP contains an ad-hoc signed development bundle. If macOS says Apple couldn’t verify WhenScape, it may offer a per-item **Open Anyway** button under **System Settings → Privacy & Security** after the blocked attempt. [Apple’s Gatekeeper guidance](https://support.apple.com/en-gb/102445)

For a local build, run `scripts/build-saver.sh` on your Mac and reveal the result with `open -R build/WhenScape.saver`. Copy that bundle into `~/Library/Screen Savers/` and choose **Replace** if the downloaded copy is already there. Quit and reopen System Settings to select the local copy. Distributing a download that Gatekeeper can verify requires [Developer ID signing and Apple notarization](https://developer.apple.com/developer-id/).

## Build and test

Build from source on a Mac with Xcode, or run the portable tests from macOS or Linux with a C and C++17 toolchain:

```sh
scripts/test-saver.sh
scripts/build-saver.sh
build/WhenScapePreview --fixture clear
```

The bundle is `build/WhenScape.saver`. The first build fetches hash-pinned [Astronomy Engine 2.1.19 C source](https://github.com/cosinekitty/astronomy/tree/v2.1.19/source/c). Both the engine license and the project license are included in the bundle. The default build supports Apple silicon and Intel. Set `WHENSCAPE_SAVER_ARCHS=arm64` to build only for Apple silicon. No map service, location permission, calendar access or Cesium token is needed. Live weather uses Open-Meteo’s [non-commercial API](https://open-meteo.com/en/terms), with model estimates for the preset Claremont coordinates. The astronomical scene continues offline.

See the [sundial reconstruction and Mac checks](docs/sundial-saver.md) and the [design handoff](docs/sundial-handoff.md).
