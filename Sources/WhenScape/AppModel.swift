import SwiftUI
import CoreLocation
import MapKit
import Security
import WhenScapeCore

@MainActor
final class AppModel: ObservableObject {
    @Published var latitude = 34.0967
    @Published var longitude = -117.7198
    @Published var locationName = "Claremont, California"
    @Published var timeZone = TimeZone(identifier: "America/Los_Angeles")!
    @Published var timeZoneNote: String? = nil
    @Published var instant = Date()
    @Published var start = Date()
    @Published var end = Date().addingTimeInterval(3600)
    @Published var rangeEnabled = false
    @Published var selectedEventID: String?
    @Published var selectedEventTitle: String?
    @Published var locationRequired = false
    @Published var locationMessage: String?
    @Published var eventLocationQuery = ""
    @Published var eventSearchRevision = UUID()
    @Published var isPlaying = false
    @Published var playbackDirection = 1.0
    @Published var playbackSpeed = 300.0
    @Published var weatherEnabled = true
    @Published var snowCover = false
    @Published var reducedMotion = false
    @Published var detail = "balanced"
    @Published var ionToken = TokenStore.read()
    @Published var sceneMessage = "Preparing the scene…"
    @Published var sceneReady = false
    @Published var heading = 0.0
    @Published var sunAltitude: Double?
    @Published var weatherLabel = "Loading weather"
    @Published var tokenError: String?
    private var sourceEvent: CalendarEvent?
    private let geocoder = CLGeocoder()
    private var locationRevision = UUID()
    private struct PendingAllDayTime {
        let eventID: String
        let civilDate: DateComponents
        let initialInstant: Date
    }
    private var pendingAllDayTime: PendingAllDayTime?

    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
    var isAllDaySelected: Bool { sourceEvent?.isAllDay == true }
    var interval: DateInterval {
        rangeEnabled ? DateInterval(start: start, end: max(end, start.addingTimeInterval(60))) : ExplorationTime.dayInterval(containing: instant, in: timeZone)
    }
    var zoneLabel: String {
        let seconds = timeZone.secondsFromGMT(for: instant)
        let sign = seconds < 0 ? "−" : "+"
        return "\(timeZone.identifier) · UTC\(sign)\(abs(seconds) / 3600):\(String(format: "%02d", abs(seconds) % 3600 / 60))"
    }

    func selectEvent(_ event: CalendarEvent) {
        geocoder.cancelGeocode()
        locationRevision = UUID()
        pendingAllDayTime = nil
        sourceEvent = event
        selectedEventID = event.id
        selectedEventTitle = event.title
        isPlaying = false
        start = event.start
        end = max(event.end, start.addingTimeInterval(60))
        rangeEnabled = !event.isAllDay
        instant = event.isAllDay ? ExplorationTime.noon(on: event.start, in: event.timeZone ?? .current) : start
        if event.isAllDay {
            var sourceCalendar = Calendar(identifier: .gregorian)
            sourceCalendar.timeZone = event.timeZone ?? .current
            pendingAllDayTime = PendingAllDayTime(
                eventID: event.id,
                civilDate: sourceCalendar.dateComponents([.year, .month, .day], from: event.start),
                initialInstant: instant
            )
        }
        eventLocationQuery = event.location?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let lat = event.latitude, let lon = event.longitude,
           CLLocationCoordinate2DIsValid(.init(latitude: lat, longitude: lon)) {
            setLocation(.init(latitude: lat, longitude: lon), name: event.location ?? "Event location")
        } else {
            locationRequired = true
            timeZone = event.timeZone ?? .current
            timeZoneNote = "Choose a location to resolve its local time zone"
            locationMessage = eventLocationQuery.isEmpty ? "This event has no location. Search or click the map to choose where to stand." : "Choose the matching place below, or click the map."
        }
        // Invalidate previous searches even when this event already has coordinates.
        eventSearchRevision = UUID()
    }

    func resetToEvent() { if let event = sourceEvent { selectEvent(event) } }

    func setLocation(_ coordinate: CLLocationCoordinate2D, name: String? = nil, knownTimeZone: TimeZone? = nil) {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        geocoder.cancelGeocode()
        let revision = UUID()
        locationRevision = revision
        latitude = coordinate.latitude
        longitude = coordinate.longitude
        locationName = name ?? String(format: "%.5f, %.5f", latitude, longitude)
        locationRequired = false
        locationMessage = nil
        timeZone = knownTimeZone ?? TimeZone(secondsFromGMT: 0)!
        timeZoneNote = knownTimeZone == nil ? "Resolving local time zone; showing UTC" : nil
        if knownTimeZone != nil { applyPendingAllDayTime() }
        geocoder.reverseGeocodeLocation(CLLocation(latitude: latitude, longitude: longitude)) { [weak self] places, _ in
            Task { @MainActor in
                guard let self, self.locationRevision == revision else { return }
                if let place = places?.first {
                    if name == nil {
                        self.locationName = [place.name, place.locality].compactMap { $0 }.joined(separator: ", ")
                        if self.locationName.isEmpty { self.locationName = "Selected map point" }
                    }
                    if let zone = place.timeZone {
                        self.timeZone = zone
                        self.timeZoneNote = nil
                        self.applyPendingAllDayTime()
                    }
                    else if knownTimeZone == nil { self.timeZoneNote = "Local time zone unavailable; showing UTC" }
                } else if knownTimeZone == nil { self.timeZoneNote = "Local time zone unavailable; showing UTC" }
            }
        }
    }

    private func applyPendingAllDayTime() {
        guard let pending = pendingAllDayTime else { return }
        pendingAllDayTime = nil
        // An all-day event has a civil date, not an absolute viewing instant. Preserve
        // that date when first resolving its destination, unless the user edited time.
        guard pending.eventID == selectedEventID, instant == pending.initialInstant else { return }
        var components = pending.civilDate
        components.hour = 12
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        if let noon = calendar.date(from: components) { instant = noon }
    }

    func setStart(_ date: Date) {
        start = date
        if end <= start { end = start.addingTimeInterval(3600) }
        instant = ExplorationTime.clamped(instant, to: interval)
    }
    func setEnd(_ date: Date) {
        end = max(date, start.addingTimeInterval(60))
        instant = ExplorationTime.clamped(instant, to: interval)
    }
    func setRangeEnabled(_ value: Bool) {
        rangeEnabled = value
        if value { start = instant; end = instant.addingTimeInterval(3600) }
    }
    func tick() {
        guard isPlaying, !locationRequired else { return }
        instant = ExplorationTime.advancing(instant, by: playbackDirection * playbackSpeed * 0.1, in: interval)
    }
    func saveToken(_ token: String) {
        let clean = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let status = TokenStore.save(clean)
        if status == errSecSuccess { ionToken = clean; tokenError = nil }
        else { tokenError = "Keychain could not save the token (\(status))." }
    }

    var sceneState: [String: Any] {
        let formatter = ISO8601DateFormatter()
        return ["latitude": latitude, "longitude": longitude, "location": locationName,
                "time": formatter.string(from: instant), "start": formatter.string(from: interval.start),
                "end": formatter.string(from: interval.end), "weatherEnabled": weatherEnabled,
                "snowCover": snowCover, "reducedMotion": reducedMotion, "detail": detail, "ionToken": ionToken]
    }
    func receiveSceneStatus(_ status: [String: Any]) {
        if let ready = status["ready"] as? Bool { sceneReady = ready }
        if let message = status["message"] as? String { sceneMessage = message }
        if let value = status["heading"] as? Double { heading = value }
        if let value = status["sunAltitude"] as? Double { sunAltitude = value }
        if let weather = status["weather"] as? [String: Any], let label = weather["label"] as? String { weatherLabel = label }
    }
}

enum TokenStore {
    static let service = "com.whenscape.app.cesium"
    static func read() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: "ion", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ value: String) -> OSStatus {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "ion"]
        if value.isEmpty {
            let status = SecItemDelete(query as CFDictionary)
            return status == errSecItemNotFound ? errSecSuccess : status
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        guard updated == errSecItemNotFound else { return updated }
        return SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
    }
}
