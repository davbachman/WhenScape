import EventKit
import SwiftUI

/// A local, immutable projection of EventKit. Nothing in this type can save an event.
struct CalendarEvent: Identifiable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let location: String?
    let latitude: Double?
    let longitude: Double?
    let isAllDay: Bool
    let color: Color
    let timeZone: TimeZone?
    let calendarTitle: String
    let calendarID: String
}

struct CalendarChoice: Identifiable {
    let id: String
    let title: String
    let color: Color
}

@MainActor
final class CalendarService: ObservableObject {
    @Published private(set) var events: [CalendarEvent] = []
    @Published private(set) var calendars: [CalendarChoice] = []
    @Published private(set) var authorization = EKEventStore.authorizationStatus(for: .event)
    @Published private(set) var isRequestingAccess = false
    @Published private(set) var errorMessage: String?
    @Published var hiddenCalendarIDs: Set<String> = []

    private let store = EKEventStore()

    var hasReadAccess: Bool { authorization == .fullAccess }

    var visibleEvents: [CalendarEvent] {
        events.filter { !hiddenCalendarIDs.contains($0.calendarID) }
    }

    func requestAccess(for week: DateInterval) async {
        guard !isRequestingAccess else { return }
        isRequestingAccess = true
        defer { isRequestingAccess = false }
        errorMessage = nil
        do {
            _ = try await store.requestFullAccessToEvents()
        } catch {
            errorMessage = error.localizedDescription
        }
        refresh(week: week)
    }

    func refresh(week: DateInterval) {
        authorization = EKEventStore.authorizationStatus(for: .event)
        guard hasReadAccess else {
            events = []
            calendars = []
            return
        }
        let sources = store.calendars(for: .event)
        calendars = sources.map {
            CalendarChoice(id: $0.calendarIdentifier, title: $0.title,
                           color: Color(cgColor: $0.cgColor))
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }

        let predicate = store.predicateForEvents(withStart: week.start, end: week.end, calendars: sources)
        events = store.events(matching: predicate).compactMap { event in
            guard let start = event.startDate, let end = event.endDate else { return nil }
            let coordinate = event.structuredLocation?.geoLocation?.coordinate
            let rawLocation = event.location?.trimmingCharacters(in: .whitespacesAndNewlines)
            let title = event.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return CalendarEvent(
                // Recurring occurrences may share an EventKit identifier.
                id: "\(event.calendarItemIdentifier)|\(start.timeIntervalSinceReferenceDate)",
                title: title.isEmpty ? "Untitled event" : title,
                start: start, end: max(start, end),
                location: rawLocation?.isEmpty == false ? rawLocation : nil,
                latitude: coordinate?.latitude, longitude: coordinate?.longitude,
                isAllDay: event.isAllDay, color: Color(cgColor: event.calendar.cgColor),
                timeZone: event.timeZone, calendarTitle: event.calendar.title,
                calendarID: event.calendar.calendarIdentifier
            )
        }.sorted {
            if $0.start != $1.start { return $0.start < $1.start }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }
}
