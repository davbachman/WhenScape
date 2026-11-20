import AppKit
import EventKit
import SwiftUI
import WhenScapeCore

@MainActor
struct CalendarPane: View {
    @ObservedObject var model: AppModel
    @StateObject private var service = CalendarService()
    @State private var displayedDate = Date()
    @State private var details: CalendarEvent?
    @State private var showCalendars = false
    /// How far the days are pushed sideways by a two-finger scroll or a week turning.
    @State private var slide: CGFloat = 0
    @State private var dayAreaWidth: CGFloat = 300
    @State private var turning = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    private let hourHeight: CGFloat = 48
    private let gutter: CGFloat = 38
    private var calendar: Calendar { Calendar.current }
    private var week: DateInterval {
        calendar.dateInterval(of: .weekOfYear, for: displayedDate)!
    }
    private var days: [Date] {
        (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: week.start) }
    }
    private var weekTitle: String {
        let last = calendar.date(byAdding: .day, value: -1, to: week.end)!
        if calendar.component(.month, from: week.start) == calendar.component(.month, from: last) {
            return week.start.formatted(.dateTime.month(.wide).year())
        }
        return "\(week.start.formatted(.dateTime.month(.abbreviated))) – \(last.formatted(.dateTime.month(.abbreviated).year()))"
    }
    private var hasClockChange: Bool {
        days.contains { abs((calendar.dateInterval(of: .day, for: $0)?.duration ?? 86400) - 86400) > 1 }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if service.hasReadAccess {
                weekGrid
            } else {
                permissionView
            }
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .task { service.refresh(week: week) }
        .onChange(of: displayedDate) { _, _ in service.refresh(week: week) }
        .onReceive(NotificationCenter.default.publisher(for: .EKEventStoreChanged)) { _ in
            service.refresh(week: week)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            service.refresh(week: week)
        }
        .popover(item: $details, arrowEdge: .trailing) { event in
            EventDetails(event: event)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").foregroundStyle(.secondary)
                Text(weekTitle).font(.system(size: 14, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Button { showCalendars.toggle() } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .buttonStyle(.borderless)
                .help("Choose visible calendars")
                .accessibilityLabel("Choose visible calendars")
                .disabled(!service.hasReadAccess)
                .popover(isPresented: $showCalendars) { calendarFilter }
            }
            HStack(spacing: 5) {
                Button { turnWeek(-1) } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Previous week")
                Button("Today") { displayedDate = Date() }
                Button { turnWeek(1) } label: { Image(systemName: "chevron.right") }
                    .accessibilityLabel("Next week")
                Spacer(minLength: 0)
                Text("Week · \(calendar.timeZone.abbreviation() ?? calendar.timeZone.identifier)")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                    .help("Calendar display time zone: \(calendar.timeZone.identifier)")
                Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(.tertiary)
                    .help("Read-only calendar. Scene edits never change events.")
            }
            .controlSize(.small)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }

    private var weekGrid: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: gutter)
                sliding {
                    ForEach(days, id: \.self) { day in
                        VStack(spacing: 3) {
                            Text(day.formatted(.dateTime.weekday(.narrow)))
                                .font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
                            Text(day.formatted(.dateTime.day()))
                                .font(.system(size: 12, weight: calendar.isDateInToday(day) ? .bold : .regular))
                                .foregroundStyle(calendar.isDateInToday(day) ? Color.white : Color.primary)
                                .frame(width: 23, height: 23)
                                .background(calendar.isDateInToday(day) ? Color.accentColor : .clear, in: Circle())
                        }.frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { dayAreaWidth = $0 }
            }
            // Only as tall as the day labels; otherwise the blank corner above the
            // hour labels stretches and takes half the height from the hours.
            .fixedSize(horizontal: false, vertical: true)
            ScrollView(.vertical) { allDayRow }
                .frame(height: allDayRowHeight)
            Divider()
            if hasClockChange {
                Text("Clock change this week · times use local wall clock")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 3)
                    .background(Color.accentColor.opacity(0.05))
            }
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    ZStack(alignment: .topLeading) {
                        HStack(alignment: .top, spacing: 0) {
                            hourLabels
                            sliding {
                                ForEach(days, id: \.self) { day in
                                    DayColumn(day: day, events: service.visibleEvents,
                                              calendar: calendar, hourHeight: hourHeight,
                                              selectedID: model.selectedEventID) { event in
                                        model.selectEvent(event)
                                        details = event
                                    }
                                }
                            }
                        }
                        VStack(spacing: 0) {
                            ForEach(0..<24, id: \.self) { hour in
                                Color.clear.frame(height: hourHeight).id(hour)
                            }
                        }.allowsHitTesting(false)
                    }
                    .padding(.top, 7)
                }
                .onAppear { proxy.scrollTo(8, anchor: .top) }
            }
            HStack(spacing: 5) {
                Circle().fill(Color.accentColor).frame(width: 4, height: 4)
                Text(service.visibleEvents.isEmpty ? "No events this week · explore a place on the map" : "Select an event to explore its place and time")
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
            }.padding(.horizontal, 10).padding(.vertical, 7)
                .background(.bar)
        }
        .background(SideScrollReader(onFollow: followSwipe, onRelease: releaseSwipe, onStep: turnWeek))
    }

    /// Days that move together when the week is scrolled sideways, clipped to
    /// their own column so the hour labels stay put.
    private func sliding<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 0) { content() }
            .offset(x: slide)
            .opacity(1 - 0.6 * min(abs(slide) / max(dayAreaWidth, 1), 1))
            .clipped()
    }

    private func followSwipe(_ travel: CGFloat) {
        guard !turning else { return }
        slide = max(-dayAreaWidth, min(dayAreaWidth, travel))
    }

    private func releaseSwipe(_ travel: CGFloat) {
        guard !turning else { return }
        let page = SideScroll.page(travel: travel, width: dayAreaWidth)
        if page == 0 { withAnimation(.spring(duration: 0.25)) { slide = 0 } } else { turnWeek(page) }
    }

    /// Turns to an earlier (−1) or later (+1) week: the days slide out the way
    /// they were going and the new week slides in behind them.
    private func turnWeek(_ delta: Int) {
        guard !turning else { return }
        let width = max(dayAreaWidth, 1)
        guard !(systemReduceMotion || model.reducedMotion) else {
            navigateWeek(delta)
            slide = 0
            return
        }
        turning = true
        withAnimation(.easeIn(duration: 0.12)) { slide = delta > 0 ? -width : width } completion: {
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                navigateWeek(delta)
                slide = delta > 0 ? width : -width
            }
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.2)) { slide = 0 } completion: { turning = false }
            }
        }
    }

    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                Text(hourLabel(hour))
                    .font(.system(size: 9)).foregroundStyle(.tertiary)
                    .frame(width: gutter - 5, height: hourHeight, alignment: .topTrailing)
                    .offset(y: -6)
                    .padding(.trailing, 5)
            }
        }
    }

    private var allDayRow: some View {
        HStack(alignment: .top, spacing: 0) {
            Text("all-day").font(.system(size: 8)).foregroundStyle(.secondary)
                .frame(width: gutter, height: 22, alignment: .center)
            sliding {
                ForEach(days, id: \.self) { day in
                    let entries = service.visibleEvents.filter {
                        $0.isAllDay && $0.start < calendar.date(byAdding: .day, value: 1, to: day)! && $0.end > day
                    }
                    VStack(spacing: 2) {
                        ForEach(entries) { event in
                            Button {
                                model.selectEvent(event)
                                details = event
                            } label: {
                                Text(event.title).font(.system(size: 9, weight: .medium))
                                    .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 3).padding(.vertical, 3)
                                    .background(event.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 3))
                            }
                            .buttonStyle(.plain).help(event.title)
                            .accessibilityLabel("\(event.title), all-day")
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 22, alignment: .topLeading)
                    .padding(.horizontal, 1)
                }
            }
        }.padding(.bottom, 4)
    }

    private var allDayRowHeight: CGFloat {
        let largestCount = days.map { day in
            service.visibleEvents.filter {
                $0.isAllDay && $0.start < calendar.date(byAdding: .day, value: 1, to: day)! && $0.end > day
            }.count
        }.max() ?? 0
        return min(76, max(26, CGFloat(largestCount) * 20 + 4))
    }

    private var permissionView: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 10)
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 31, weight: .light)).foregroundStyle(Color.accentColor)
            Text("Your calendar, in perspective")
                .font(.system(size: 14, weight: .semibold))
            Text(permissionExplanation)
                .font(.system(size: 11)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 310)
            if service.authorization == .notDetermined || service.authorization == .writeOnly {
                Button(service.isRequestingAccess ? "Connecting…" : "Connect calendars") {
                    Task { await service.requestAccess(for: week) }
                }
                .buttonStyle(.borderedProminent).disabled(service.isRequestingAccess)
            } else if service.authorization == .denied {
                Button("Open Calendar Privacy Settings") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") {
                        NSWorkspace.shared.open(url)
                    }
                }.controlSize(.small)
            }
            if let error = service.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Text("You can also explore directly using the map and time controls.")
                .font(.system(size: 10)).foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
            Spacer(minLength: 10)
        }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var permissionExplanation: String {
        switch service.authorization {
        case .denied:
            return "Calendar access is off. Enable Full Access in System Settings to see your events. WhenScape only reads them."
        case .restricted:
            return "Calendar access is restricted on this Mac. You can still choose a place and time manually."
        default:
            return "Apple requires Full Access to read existing events. WhenScape only reads your calendars and never creates, changes or deletes events."
        }
    }

    private var calendarFilter: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Visible calendars").font(.headline)
            if service.calendars.isEmpty { Text("No calendars available").foregroundStyle(.secondary) }
            ForEach(service.calendars) { entry in
                Toggle(isOn: Binding(
                    get: { !service.hiddenCalendarIDs.contains(entry.id) },
                    set: { visible in
                        if visible { service.hiddenCalendarIDs.remove(entry.id) }
                        else { service.hiddenCalendarIDs.insert(entry.id) }
                    }
                )) {
                    HStack {
                        Circle().fill(entry.color).frame(width: 7, height: 7)
                        Text(entry.title)
                    }
                }.toggleStyle(.checkbox)
            }
        }.padding(16).frame(minWidth: 220)
    }

    private func navigateWeek(_ delta: Int) {
        displayedDate = calendar.date(byAdding: .weekOfYear, value: delta, to: displayedDate) ?? displayedDate
    }

    private func hourLabel(_ hour: Int) -> String {
        var stable = Calendar(identifier: .gregorian)
        stable.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = stable.date(from: DateComponents(year: 2001, month: 1, day: 1, hour: hour))!
        let formatter = DateFormatter()
        formatter.timeZone = stable.timeZone
        formatter.setLocalizedDateFormatFromTemplate("j")
        return formatter.string(from: date)
    }
}

/// Layout uses wall-clock minutes, matching a conventional week calendar.
/// Clipping uses actual day boundaries, including 23/25-hour DST days.
private struct DayColumn: View {
    let day: Date
    let events: [CalendarEvent]
    let calendar: Calendar
    let hourHeight: CGFloat
    let selectedID: String?
    let select: (CalendarEvent) -> Void

    private var entries: [EventPlacement] {
        EventPlacement.layout(events: events, day: day, calendar: calendar)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                Rectangle().fill(calendar.isDateInWeekend(day) ? Color.primary.opacity(0.018) : .clear)
                Path { path in
                    path.move(to: .zero)
                    path.addLine(to: CGPoint(x: 0, y: hourHeight * 24))
                    for hour in 0..<24 {
                        let y = CGFloat(hour) * hourHeight
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                    }
                }.stroke(Color.primary.opacity(0.07), lineWidth: 0.5)
                ForEach(entries) { item in
                    let width = max(8, (geometry.size.width - 3) / CGFloat(item.columns) - 1)
                    Button { select(item.event) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.event.title).font(.system(size: 9, weight: .medium)).lineLimit(2)
                            if item.endMinute - item.startMinute >= 55 {
                                Text(item.event.start.formatted(.dateTime.hour().minute()))
                                    .font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .padding(.leading, 4).padding(.trailing, 2).padding(.top, 3)
                        .frame(width: width,
                               height: max(15, CGFloat(item.endMinute - item.startMinute) / 60 * hourHeight - 1),
                               alignment: .topLeading)
                        .background(item.event.color.opacity(selectedID == item.event.id ? 0.36 : 0.17),
                                    in: RoundedRectangle(cornerRadius: 3))
                        .overlay(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 1).fill(item.event.color).frame(width: 2)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(selectedID == item.event.id ? item.event.color : .clear, lineWidth: 1)
                        }
                        .clipped()
                    }
                    .buttonStyle(.plain)
                    .position(x: 2 + CGFloat(item.column) * (width + 1) + width / 2,
                              y: CGFloat(item.startMinute) / 60 * hourHeight + max(15, CGFloat(item.endMinute - item.startMinute) / 60 * hourHeight - 1) / 2)
                    .help("\(item.event.title)\n\(item.event.start.formatted(date: .omitted, time: .shortened)) – \(item.event.end.formatted(date: .omitted, time: .shortened))")
                    .accessibilityLabel("\(item.event.title), \(item.event.start.formatted(date: .abbreviated, time: .shortened))")
                }
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    if calendar.isDate(context.date, inSameDayAs: day) {
                        let parts = calendar.dateComponents([.hour, .minute], from: context.date)
                        let minutes = Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0))
                        Rectangle().fill(Color.red.opacity(0.7)).frame(height: 1)
                            .offset(y: CGFloat(minutes) / 60 * hourHeight)
                            .allowsHitTesting(false)
                    }
                }
            }
        }.frame(height: hourHeight * 24)
    }
}

struct EventPlacement: Identifiable {
    let event: CalendarEvent
    let startMinute: Double
    let endMinute: Double
    var column: Int
    var columns: Int
    var id: String { event.id }

    static func layout(events: [CalendarEvent], day: Date, calendar: Calendar) -> [EventPlacement] {
        let start = calendar.startOfDay(for: day)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return [] }
        func minute(_ date: Date) -> Double {
            let parts = calendar.dateComponents([.hour, .minute, .second], from: date)
            return Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) + Double(parts.second ?? 0) / 60
        }
        var placed = events.filter {
            !$0.isAllDay && $0.start < end && ($0.end > start || ($0.start == $0.end && $0.start >= start))
        }.map { event -> EventPlacement in
            let top = event.start <= start ? 0 : minute(event.start)
            let bottom = event.end >= end ? 1440 : minute(event.end)
            return EventPlacement(event: event, startMinute: top,
                                  endMinute: min(1440, max(top + 20, bottom)), column: 0, columns: 1)
        }.sorted {
            if $0.startMinute != $1.startMinute { return $0.startMinute < $1.startMinute }
            if $0.endMinute != $1.endMinute { return $0.endMinute > $1.endMinute }
            return $0.id < $1.id
        }

        var groupStart = 0
        while groupStart < placed.count {
            var groupEnd = groupStart + 1
            var latestEnd = placed[groupStart].endMinute
            while groupEnd < placed.count && placed[groupEnd].startMinute < latestEnd {
                latestEnd = max(latestEnd, placed[groupEnd].endMinute)
                groupEnd += 1
            }
            var columnEnds: [Double] = []
            for index in groupStart..<groupEnd {
                let column = columnEnds.firstIndex(where: { $0 <= placed[index].startMinute }) ?? columnEnds.count
                if column == columnEnds.count { columnEnds.append(placed[index].endMinute) }
                else { columnEnds[column] = placed[index].endMinute }
                placed[index].column = column
            }
            for index in groupStart..<groupEnd { placed[index].columns = columnEnds.count }
            groupStart = groupEnd
        }
        return placed
    }
}

private struct EventDetails: View {
    let event: CalendarEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 2).fill(event.color).frame(width: 4, height: 34)
                Text(event.title).font(.headline).textSelection(.enabled)
            }
            Label(event.calendarTitle, systemImage: "calendar").font(.caption).foregroundStyle(.secondary)
            Text(event.isAllDay ? "All-day event" : timeDescription)
                .font(.callout).textSelection(.enabled)
            if let location = event.location {
                Label(location, systemImage: "mappin.and.ellipse").font(.callout).textSelection(.enabled)
            } else {
                Label("No location · choose one on the map", systemImage: "mappin.slash")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            Label("Scene controls are editable. This event stays unchanged.", systemImage: "lock")
                .font(.caption2).foregroundStyle(.secondary)
        }.padding(18).frame(width: 280, alignment: .leading)
    }

    private var timeDescription: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.timeZone = event.timeZone ?? .current
        let zone = formatter.timeZone!
        // Abbreviations are calculated at each instant: a DST transition can change them.
        let firstZone = zone.abbreviation(for: event.start) ?? zone.identifier
        let lastZone = zone.abbreviation(for: event.end) ?? zone.identifier
        return "\(formatter.string(from: event.start)) \(firstZone)\n\(formatter.string(from: event.end)) \(lastZone)"
    }
}

/// Watches scroll events over the week grid. Two-finger sideways scrolls (and
/// a mouse's sideways wheel) go to the calendar; vertical ones go on to the
/// scroll views inside, so the hours still scroll as before.
private struct SideScrollReader: NSViewRepresentable {
    var onFollow: (CGFloat) -> Void
    var onRelease: (CGFloat) -> Void
    var onStep: (Int) -> Void

    func makeNSView(context: Context) -> ReaderView { ReaderView() }

    func updateNSView(_ view: ReaderView, context: Context) {
        view.onFollow = onFollow
        view.onRelease = onRelease
        view.onStep = onStep
    }

    static func dismantleNSView(_ view: ReaderView, coordinator: ()) { view.stopWatching() }

    final class ReaderView: NSView {
        var onFollow: (CGFloat) -> Void = { _ in }
        var onRelease: (CGFloat) -> Void = { _ in }
        var onStep: (Int) -> Void = { _ in }
        private var monitor: Any?
        private var scroll = SideScroll()

        // Clicks and hovers go to the calendar underneath.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopWatching()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                guard let self, self.take(event) else { return event }
                return nil
            }
        }

        func stopWatching() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        /// Whether the event was used here and should go no further.
        private func take(_ event: NSEvent) -> Bool {
            guard event.window === window, !isHiddenOrHasHiddenAncestor else { return false }
            let inside = bounds.contains(convert(event.locationInWindow, from: nil))
            switch scroll.handle(Self.phase(of: event), dx: event.scrollingDeltaX, dy: event.scrollingDeltaY,
                                 inside: inside, precise: event.hasPreciseScrollingDeltas, at: event.timestamp) {
            case .pass: return false
            case .consume: return true
            case .follow(let travel): onFollow(travel); return true
            case .release(let travel): onRelease(travel); return true
            case .step(let direction): onStep(direction); return true
            }
        }

        private static func phase(of event: NSEvent) -> SideScroll.Phase {
            if !event.momentumPhase.isEmpty { return .momentum }
            let phase = event.phase
            if phase.contains(.mayBegin) { return .mayBegin }
            if phase.contains(.began) { return .began }
            if phase.contains(.ended) { return .ended }
            if phase.contains(.cancelled) { return .cancelled }
            if phase.contains(.changed) || phase.contains(.stationary) { return .changed }
            return .none
        }
    }
}
