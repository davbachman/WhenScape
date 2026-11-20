import Foundation

/// A place the user can return to with one click.
public struct PlaceRecord: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    /// The user's name for a saved place, such as "Home"; nil for a recent one.
    public var label: String?
    /// What the place is: a place name, an address or a contact's address.
    public var name: String
    public var latitude: Double
    public var longitude: Double
    /// The place's own time zone, once known.
    public var timeZoneID: String?

    public init(id: UUID = UUID(), label: String? = nil, name: String, latitude: Double, longitude: Double,
                timeZoneID: String? = nil) {
        self.id = id
        self.label = label
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.timeZoneID = timeZoneID
    }

    /// The label for a saved place, or the name for a recent one.
    public var title: String { label ?? name }
}

/// The user's saved places (Home, Work and any others they name) and the few
/// places they chose most recently. Two places closer than
/// `samePlaceDistance` count as the same spot.
public struct PlaceBook: Codable, Equatable, Sendable {
    public private(set) var saved: [PlaceRecord] = []
    public private(set) var recent: [PlaceRecord] = []

    public static let recentLimit = 5
    public static let samePlaceDistance = 75.0

    public init() {}

    /// Saves a place under a label. It replaces a saved place with the same
    /// label (so saving a new Home moves Home) and any saved place at the same
    /// spot (so saving again renames it). Home and Work stay first.
    @discardableResult
    public mutating func save(_ place: PlaceRecord, as label: String) -> PlaceRecord? {
        let label = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return nil }
        saved.removeAll { $0.label?.caseInsensitiveCompare(label) == .orderedSame || Self.isSameSpot($0, place) }
        var entry = place
        entry.id = UUID()
        entry.label = label
        saved.append(entry)
        saved = saved.enumerated().sorted { first, second in
            let a = Self.rank(first.element), b = Self.rank(second.element)
            return a != b ? a < b : first.offset < second.offset
        }.map(\.element)
        return entry
    }

    /// Forgets a saved or recent place.
    public mutating func remove(_ id: UUID) {
        saved.removeAll { $0.id == id }
        recent.removeAll { $0.id == id }
    }

    /// Puts a place at the front of the recent places, replacing an older
    /// visit to the same spot.
    public mutating func noteVisit(_ place: PlaceRecord) {
        var entry = place
        entry.label = nil
        recent.removeAll { Self.isSameSpot($0, entry) }
        recent.insert(entry, at: 0)
        if recent.count > Self.recentLimit { recent.removeLast(recent.count - Self.recentLimit) }
    }

    /// The saved place at this spot, if any.
    public func savedPlace(nearLatitude latitude: Double, longitude: Double) -> PlaceRecord? {
        saved.first { Self.distance($0.latitude, $0.longitude, latitude, longitude) < Self.samePlaceDistance }
    }

    /// Whether a place with this label is saved, ignoring case.
    public func hasSaved(label: String) -> Bool {
        saved.contains { $0.label?.caseInsensitiveCompare(label) == .orderedSame }
    }

    /// Recent places that are not also saved.
    public var unsavedRecents: [PlaceRecord] {
        recent.filter { place in !saved.contains { Self.isSameSpot($0, place) } }
    }

    /// Great-circle distance in metres.
    public static func distance(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let radians = Double.pi / 180
        let dLat = (lat2 - lat1) * radians, dLon = (lon2 - lon1) * radians
        let a = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * radians) * cos(lat2 * radians) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000 * 2 * atan2(sqrt(a), sqrt(max(0, 1 - a)))
    }

    private static func isSameSpot(_ a: PlaceRecord, _ b: PlaceRecord) -> Bool {
        distance(a.latitude, a.longitude, b.latitude, b.longitude) < samePlaceDistance
    }

    private static func rank(_ place: PlaceRecord) -> Int {
        switch place.label?.lowercased() {
        case "home": return 0
        case "work": return 1
        default: return 2
        }
    }
}
