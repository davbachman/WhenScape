import Foundation
import WhenScapeCore

/// Settings and the last place, kept between launches in the app's own
/// defaults. Nothing here leaves the Mac. The Cesium token is not stored here;
/// it stays in the Keychain.
enum Preferences {
    enum Key: String {
        case weatherEnabled, snowCover, computedShadows, detail, playbackSpeed, hiddenCalendars, idleOrbit, places
        case placeLatitude, placeLongitude, placeName, placeTimeZone
    }

    struct Place {
        let latitude: Double
        let longitude: Double
        let name: String
        let timeZone: TimeZone?
    }

    private static var store: UserDefaults { .standard }

    static func bool(_ key: Key, default value: Bool) -> Bool {
        store.object(forKey: key.rawValue) as? Bool ?? value
    }
    static func double(_ key: Key, default value: Double) -> Double {
        store.object(forKey: key.rawValue) as? Double ?? value
    }
    static func string(_ key: Key, default value: String, allowed: Set<String>? = nil) -> String {
        guard let saved = store.string(forKey: key.rawValue), allowed?.contains(saved) ?? true else { return value }
        return saved
    }
    static func strings(_ key: Key) -> Set<String> {
        Set(store.stringArray(forKey: key.rawValue) ?? [])
    }
    static func set(_ value: Any, _ key: Key) {
        if let set = value as? Set<String> { store.set(set.sorted(), forKey: key.rawValue) }
        else { store.set(value, forKey: key.rawValue) }
    }

    static func place() -> Place? {
        guard let latitude = store.object(forKey: Key.placeLatitude.rawValue) as? Double,
              let longitude = store.object(forKey: Key.placeLongitude.rawValue) as? Double,
              (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
        let zone = store.string(forKey: Key.placeTimeZone.rawValue).flatMap(TimeZone.init(identifier:))
        return Place(latitude: latitude, longitude: longitude,
                     name: store.string(forKey: Key.placeName.rawValue) ?? String(format: "%.5f, %.5f", latitude, longitude),
                     timeZone: zone)
    }

    /// Saved and recent places. An unreadable record starts the book afresh.
    static func placeBook() -> PlaceBook {
        guard let data = store.data(forKey: Key.places.rawValue),
              let book = try? JSONDecoder().decode(PlaceBook.self, from: data) else { return PlaceBook() }
        return book
    }
    static func setPlaceBook(_ book: PlaceBook) {
        if let data = try? JSONEncoder().encode(book) { store.set(data, forKey: Key.places.rawValue) }
    }

    /// Saves the place; a time zone is kept only once it is the place's own, not the UTC fallback.
    static func savePlace(_ place: Place) {
        store.set(place.latitude, forKey: Key.placeLatitude.rawValue)
        store.set(place.longitude, forKey: Key.placeLongitude.rawValue)
        store.set(place.name, forKey: Key.placeName.rawValue)
        if let zone = place.timeZone { store.set(zone.identifier, forKey: Key.placeTimeZone.rawValue) }
        else { store.removeObject(forKey: Key.placeTimeZone.rawValue) }
    }
}
