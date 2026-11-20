import SwiftUI
import AppKit
import Combine

@main
@MainActor
struct WhenScapeApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .frame(minWidth: 1080, minHeight: 720)
        }
        .defaultSize(width: 1380, height: 900)
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Explore") {
                Button(model.isPlaying ? "Pause Time" : "Play Time") { model.isPlaying.toggle() }
                    .keyboardShortcut(.space, modifiers: [.command])
                    .disabled(model.locationRequired)
                Button("Return to Event") { model.resetToEvent() }.disabled(model.selectedEventID == nil)
                Toggle("Show Weather", isOn: $model.weatherEnabled)
                Toggle("Turntable", isOn: $model.idleOrbit).disabled(model.reducedMotion)
            }
        }
        Settings { SettingsView(model: model) }
    }
}

@MainActor
struct ContentView: View {
    @ObservedObject var model: AppModel
    @State private var calendarExpanded = false
    @State private var showSetup = false
    @State private var sidebarWidth: CGFloat?
    @State private var previousSidebarWidth: CGFloat?
    @State private var dragStartWidth: CGFloat?
    @State private var keyMonitor: Any?
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    private let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geometry in
          HStack(spacing: 0) {
            VSplitView {
                VStack(spacing: 0) {
                    HStack {
                        Text("YOUR WEEK").font(.system(size: 10, weight: .semibold)).tracking(1.8).foregroundStyle(.secondary)
                        Spacer()
                        Button { toggleCalendarWidth(availableWidth: geometry.size.width) } label: {
                            Image(systemName: calendarExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                        }.buttonStyle(.borderless).help(calendarExpanded ? "Restore workspace" : "Widen calendar")
                            .accessibilityLabel(calendarExpanded ? "Restore calendar width" : "Widen calendar")
                    }.padding(.horizontal, 16).padding(.top, 10)
                    CalendarPane(model: model)
                }.frame(minHeight: 280, idealHeight: 425)
                MapPane(model: model).frame(minHeight: 220, idealHeight: 380)
            }
            .frame(width: resolvedSidebarWidth(availableWidth: geometry.size.width))
            sidebarDivider(availableWidth: geometry.size.width)
            VStack(spacing: 0) {
                ZStack {
                    CesiumView(model: model)
                    if model.locationRequired {
                        Rectangle().fill(.regularMaterial)
                        VStack(spacing: 14) {
                            Image(systemName: "mappin.and.ellipse").font(.system(size: 34)).foregroundStyle(Color.accentColor)
                            Text("Choose a location").font(.title2.weight(.semibold))
                            Text(model.locationMessage ?? "Search or click the map to choose where to stand.")
                                .foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 340)
                        }.padding(32)
                    } else if !model.sceneReady {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "cube.transparent")
                                .font(.system(size: 24)).foregroundStyle(.secondary)
                            Text(model.sceneMessage)
                                .font(.callout).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(18).frame(maxWidth: 360, alignment: .leading)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .overlay { RoundedRectangle(cornerRadius: 12).stroke(.primary.opacity(0.08)) }
                        .allowsHitTesting(false)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                TimeControls(model: model)
            }.frame(minWidth: 600)
          }
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Image(systemName: "sun.horizon.fill").foregroundStyle(Color.accentColor)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if model.ionToken.isEmpty {
                    Button("Connect 3D Data", systemImage: "square.stack.3d.up") { showSetup = true }
                }
                Button { showSetup = true } label: { Image(systemName: "slider.horizontal.3") }.help("Scene settings")
            }
        }
        .sheet(isPresented: $showSetup) {
            VStack(spacing: 0) {
                SettingsView(model: model)
                HStack { Spacer(); Button("Done") { showSetup = false }.keyboardShortcut(.defaultAction) }.padding()
            }
        }
        .onReceive(timer) { _ in model.tick() }
        .onAppear {
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                handleTimeKey(event) ? nil : event
            }
        }
        .onDisappear { if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }; keyMonitor = nil }
        .onAppear { model.reducedMotion = systemReduceMotion }
        .onChange(of: systemReduceMotion) { _, value in model.reducedMotion = value }
    }

    /// ← and → step through time (Shift for an hour) and Space plays or pauses,
    /// anywhere in the main window except where those keys already do something:
    /// text and date fields, popovers and sheets, and Space on a focused button.
    private func handleTimeKey(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.numericPad, .function])
        // Popovers and sheets cannot become the main window, so this keeps the
        // keys to the app's window and out of a calendar popover or the settings.
        guard flags.isEmpty || flags == .shift, let window = event.window, window.canBecomeMain,
              window.attachedSheet == nil else { return false }
        let responder = window.firstResponder
        if responder is NSText || responder is NSTextField || responder is NSDatePicker { return false }
        switch event.keyCode {
        case 123, 124:
            model.step(minutes: flags == .shift ? 60 : 15, forward: event.keyCode == 124)
            return true
        case 49:
            guard flags.isEmpty, !(responder is NSButton) else { return false }
            model.togglePlayback()
            return true
        default:
            return false
        }
    }

    private func resolvedSidebarWidth(availableWidth: CGFloat) -> CGFloat {
        clampedSidebarWidth(sidebarWidth ?? availableWidth / 3, availableWidth: availableWidth)
    }

    private func clampedSidebarWidth(_ proposed: CGFloat, availableWidth: CGFloat) -> CGFloat {
        min(max(365, proposed), max(365, availableWidth - 606))
    }

    private func toggleCalendarWidth(availableWidth: CGFloat) {
        if calendarExpanded {
            sidebarWidth = previousSidebarWidth
            previousSidebarWidth = nil
        } else {
            previousSidebarWidth = sidebarWidth
            let currentWidth = resolvedSidebarWidth(availableWidth: availableWidth)
            sidebarWidth = clampedSidebarWidth(max(currentWidth + 180, availableWidth / 2), availableWidth: availableWidth)
        }
        calendarExpanded.toggle()
    }

    private func sidebarDivider(availableWidth: CGFloat) -> some View {
        Rectangle().fill(Color(nsColor: .separatorColor).opacity(0.35))
            .frame(width: 6)
            .overlay { Capsule().fill(.secondary.opacity(0.35)).frame(width: 2, height: 28) }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    if dragStartWidth == nil { dragStartWidth = resolvedSidebarWidth(availableWidth: availableWidth) }
                    sidebarWidth = clampedSidebarWidth((dragStartWidth ?? 365) + value.translation.width, availableWidth: availableWidth)
                    calendarExpanded = false
                }
                .onEnded { _ in dragStartWidth = nil })
            .onHover { hovering in
                if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .help("Drag to resize the calendar and map")
            .accessibilityLabel("Calendar and map width")
            .accessibilityValue("\(Int(resolvedSidebarWidth(availableWidth: availableWidth))) points")
            .accessibilityAdjustableAction { direction in
                let change: CGFloat
                switch direction {
                case .increment: change = 30
                case .decrement: change = -30
                @unknown default: return
                }
                sidebarWidth = clampedSidebarWidth(resolvedSidebarWidth(availableWidth: availableWidth) + change, availableWidth: availableWidth)
                calendarExpanded = false
            }
    }
}

@MainActor
struct TimeControls: View {
    @ObservedObject var model: AppModel
    private var timeText: String {
        let formatter = DateFormatter()
        formatter.timeZone = model.timeZone
        formatter.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy jmm z")
        return formatter.string(from: model.instant)
    }
    private var sliderBounds: ClosedRange<Double> {
        let interval = model.interval
        // Keep an instant-mode scrub inside its day. Selecting the following
        // midnight would otherwise replace the slider's bounds during the drag.
        let upper = model.rangeEnabled ? interval.end : interval.end.addingTimeInterval(-1)
        return interval.start.timeIntervalSince1970...max(interval.start, upper).timeIntervalSince1970
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if let title = model.selectedEventTitle {
                    Label(title, systemImage: "calendar").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Button("Reset to event") { model.resetToEvent() }.font(.caption).buttonStyle(.link)
                } else { Text("EXPLORE A MOMENT").font(.system(size: 10, weight: .semibold)).tracking(1.5).foregroundStyle(.secondary) }
                Label(model.zoneLabel, systemImage: "clock").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    .help("Times are shown in the place's own time zone")
                Spacer()
                Toggle("Time range", isOn: Binding(get: { model.rangeEnabled }, set: { model.setRangeEnabled($0) })).toggleStyle(.checkbox).font(.caption)
                Toggle(isOn: $model.weatherEnabled) { Label("Weather", systemImage: "cloud.sun").font(.caption) }
                    .toggleStyle(.switch).controlSize(.mini)
                    .help("Turn off weather to explore a clear astronomical sky")
                    .accessibilityLabel("Weather")
                Toggle(isOn: $model.idleOrbit) { Label("Turntable", systemImage: "rotate.3d").font(.caption) }
                    .toggleStyle(.switch).controlSize(.mini)
                    .disabled(model.reducedMotion)
                    .accessibilityLabel("Turntable")
                    .help(model.reducedMotion ? "Reduce motion is on, so the aerial view stays still"
                          : "Slowly circle the aerial view around the flag when it is left alone for 30 seconds")
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 18) { dateFields }
                VStack(alignment: .leading, spacing: 8) { dateFields }
            }
            if let note = model.timeZoneNote { Text(note).font(.caption).foregroundStyle(.orange) }
            if model.isAllDaySelected && !model.rangeEnabled {
                Text("All-day events start at local noon; the viewing time is editable.").font(.caption2).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button {
                    if model.isPlaying && model.playbackDirection < 0 { model.isPlaying = false }
                    else { model.playbackDirection = -1; model.isPlaying = true }
                } label: { Image(systemName: "backward.fill") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(model.isPlaying && model.playbackDirection < 0 ? Color.accentColor : Color.primary)
                    .help(model.isPlaying && model.playbackDirection < 0 ? "Pause backward playback" : "Play backward")
                    .accessibilityLabel(model.isPlaying && model.playbackDirection < 0 ? "Pause backward playback" : "Play backward")
                    .disabled(model.locationRequired)
                Button {
                    if model.isPlaying { model.isPlaying = false }
                    else { model.playbackDirection = 1; model.isPlaying = true }
                } label: {
                    Image(systemName: model.isPlaying ? "pause.fill" : "play.fill").frame(width: 24, height: 24)
                }.buttonStyle(.borderedProminent).clipShape(Circle()).help(model.isPlaying ? "Pause" : "Play forward")
                    .accessibilityLabel(model.isPlaying ? "Pause" : "Play forward")
                    .disabled(model.locationRequired)
                Slider(value: Binding(
                    get: { min(max(model.instant.timeIntervalSince1970, sliderBounds.lowerBound), sliderBounds.upperBound) },
                    set: { model.isPlaying = false; model.instant = Date(timeIntervalSince1970: $0) }
                ), in: sliderBounds)
                    .accessibilityLabel("Explore time").accessibilityValue(timeText)
                    .help("← → step 15 minutes · ⇧ for an hour · Space plays or pauses")
                Picker("Playback speed", selection: $model.playbackSpeed) {
                    Text("1 min/s").tag(60.0)
                    Text("5 min/s").tag(300.0)
                    Text("30 min/s").tag(1800.0)
                }.labelsHidden().frame(width: 100)
            }
            HStack {
                Text(timeText).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                Spacer()
                if !model.weatherEnabled { Label("Clear-sky preview", systemImage: "sun.max").font(.caption).foregroundStyle(.orange) }
                else { Text(model.weatherLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }.padding(18).background(.background)
        .environment(\.timeZone, model.timeZone)
    }

    // Typing in a field or choosing from its calendar both count as choosing a
    // time, which clears the selected event (the slider and playback do not).
    @ViewBuilder private var dateFields: some View {
        if model.rangeEnabled {
            DateField(label: "From", selection: Binding(get: { model.start }, set: { model.chooseStart($0) }))
            DateField(label: "To", selection: Binding(get: { model.end }, set: { model.chooseEnd($0) }),
                      earliest: model.start.addingTimeInterval(60))
        } else {
            DateField(label: "Date & time", selection: Binding(get: { model.instant }, set: { model.chooseInstant($0) }))
        }
    }
}

/// A date and time field with a button that opens a calendar and clock.
private struct DateField: View {
    let label: String
    @Binding var selection: Date
    var earliest: Date?
    @State private var showingCalendar = false
    @Environment(\.timeZone) private var timeZone
    var body: some View {
        HStack(spacing: 4) {
            picker(label)
            Button { showingCalendar.toggle() } label: { Image(systemName: "calendar") }
                .buttonStyle(.borderless)
                .help("Choose \(label.lowercased()) from a calendar")
                .accessibilityLabel("Choose \(label.lowercased()) from a calendar")
                .popover(isPresented: $showingCalendar, arrowEdge: .top) {
                    VStack(alignment: .leading, spacing: 10) {
                        picker(label).datePickerStyle(.graphical).labelsHidden()
                        HStack {
                            Button("Now") { selection = Date() }
                            Spacer()
                            Button("Done") { showingCalendar = false }.keyboardShortcut(.defaultAction)
                        }
                    }.padding(14)
                    // The popover is presented apart from the controls; keep the place's time zone.
                    .environment(\.timeZone, timeZone)
                }
        }
    }
    @ViewBuilder private func picker(_ title: String) -> some View {
        if let earliest {
            DatePicker(title, selection: $selection, in: earliest..., displayedComponents: [.date, .hourAndMinute])
        } else {
            DatePicker(title, selection: $selection, displayedComponents: [.date, .hourAndMinute])
        }
    }
}

@MainActor
struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var token = ""
    @State private var saved = false
    var body: some View {
        Form {
            Section {
                Text("Connect real terrain and buildings").font(.headline)
                Text("Add a Cesium ion access token with access to Cesium World Terrain and OSM Buildings. The token is stored in your Mac’s Keychain.")
                    .font(.callout).foregroundStyle(.secondary)
                Link("Get a Cesium ion token", destination: URL(string: "https://ion.cesium.com/tokens")!)
                SecureField("Access token", text: $token)
                HStack {
                    Button("Save token") { model.saveToken(token); saved = model.tokenError == nil }
                    if saved { Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                }
                if let error = model.tokenError { Text(error).foregroundStyle(.red) }
            }
            Section("Scene") {
                Picker("Detail", selection: $model.detail) {
                    Text("Low").tag("low"); Text("Balanced").tag("balanced"); Text("High").tag("high")
                }
                Toggle("Reduce motion", isOn: $model.reducedMotion)
                Toggle("Turntable: slowly circle the aerial view when idle", isOn: $model.idleOrbit)
                    .disabled(model.reducedMotion)
                Toggle("Illustrative white surfaces", isOn: $model.snowCover)
                Text("White surfaces are an illustration, not a prediction of accumulated snow. No snow depth or puddles are simulated.").font(.caption).foregroundStyle(.secondary)
                Toggle("Computed shadows on the 3D mesh", isOn: $model.computedShadows)
                Text("The photorealistic mesh already shows the shadows from when it was photographed, and they cannot be removed. This adds shadows that follow the calculated Sun, so both sets appear. It also costs some performance.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Developer") {
                Toggle("Show scene diagnostics", isOn: $model.sceneDiagnostics)
                Text("Shows camera, ground and tile readings over the 3D scene, and lets Safari’s Web Inspector attach to it (Develop menu › this Mac › WhenScape). It turns off when WhenScape quits.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Data & privacy") {
                Text("Calendar access is read-only within WhenScape. Event titles, notes and attendees stay on your Mac. Contacts, if you allow them, are read for names and addresses only; they stay on your Mac except an address you choose, which goes to Apple to find it. Place searches go to Apple; coordinates and requested times go to map and weather providers.")
                Text("Astronomy is calculated. Weather uses forecasts, historical estimates, or a five-year seasonal baseline. Buildings may have estimated heights or missing geometry; the scene is not a historical reconstruction.")
                Link("Weather data: Open-Meteo", destination: URL(string: "https://open-meteo.com/")!)
                Text("The public Open-Meteo endpoint is for non-commercial use. Review provider plans and licenses before commercial distribution.")
            }.font(.caption).foregroundStyle(.secondary)
        }.formStyle(.grouped).frame(width: 530, height: 640)
            .onAppear { token = model.ionToken }
            .onChange(of: token) { _, _ in saved = false }
    }
}
