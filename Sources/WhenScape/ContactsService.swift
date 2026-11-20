import Contacts
import CoreLocation
import SwiftUI

/// One postal address of one contact.
struct ContactPlace: Identifiable {
    let id: String
    let person: String
    /// The address's label, such as "home" or "work".
    let kind: String
    let address: CNPostalAddress
    /// The address on one line.
    let line: String

    /// How the place is named in the scene and in recent places.
    var title: String { kind.isEmpty ? person : "\(person) (\(kind))" }
}

/// Reads names and postal addresses from Contacts, only after the user allows
/// it, and never changes them. Matching happens on the Mac; only an address
/// the user picks is sent to Apple's geocoder to find it on the map.
@MainActor
final class ContactsService: ObservableObject {
    @Published private(set) var authorization = CNContactStore.authorizationStatus(for: .contacts)
    @Published private(set) var isRequestingAccess = false
    /// People matching the current search who have an address.
    @Published private(set) var matches: [ContactPlace] = []
    /// Home and Work addresses from the user's own card.
    @Published private(set) var cardPlaces: [ContactPlace] = []

    private var searchTask: Task<Void, Never>?

    var hasAccess: Bool { authorization == .authorized }

    init() { if hasAccess { loadCard() } }

    func requestAccess() async {
        guard !isRequestingAccess else { return }
        isRequestingAccess = true
        defer { isRequestingAccess = false }
        _ = try? await CNContactStore().requestAccess(for: .contacts)
        authorization = CNContactStore.authorizationStatus(for: .contacts)
        if hasAccess { loadCard() }
    }

    /// Looks for people whose names match, after a short pause in typing.
    func search(_ text: String) {
        searchTask?.cancel()
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard hasAccess, text.count >= 2 else { matches = []; return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            let found = await Task.detached(priority: .userInitiated) { Self.find(text) }.value
            guard !Task.isCancelled else { return }
            matches = found
        }
    }

    func clear() {
        searchTask?.cancel()
        matches = []
    }

    /// Finds the address on the map.
    func locate(_ place: ContactPlace) async -> CLPlacemark? {
        try? await CLGeocoder().geocodePostalAddress(place.address).first
    }

    private func loadCard() {
        Task {
            let places = await Task.detached(priority: .utility) { Self.cardAddresses() }.value
            cardPlaces = places
        }
    }

    private nonisolated static let keys: [CNKeyDescriptor] = [
        CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
        CNContactOrganizationNameKey as CNKeyDescriptor,
        CNContactPostalAddressesKey as CNKeyDescriptor,
    ]

    private nonisolated static func find(_ text: String) -> [ContactPlace] {
        let predicate = CNContact.predicateForContacts(matchingName: text)
        let contacts = (try? CNContactStore().unifiedContacts(matching: predicate, keysToFetch: keys)) ?? []
        return Array(contacts.flatMap(places(of:)).prefix(8))
    }

    private nonisolated static func cardAddresses() -> [ContactPlace] {
        guard let me = try? CNContactStore().unifiedMeContactWithKeys(toFetch: keys) else { return [] }
        return [(CNLabelHome, "Home"), (CNLabelWork, "Work")].compactMap { label, name in
            guard let entry = me.postalAddresses.first(where: { $0.label == label }) else { return nil }
            return place(entry.value, of: me, id: "me-\(name)", kind: name, person: name)
        }
    }

    private nonisolated static func places(of contact: CNContact) -> [ContactPlace] {
        let person = CNContactFormatter.string(from: contact, style: .fullName) ?? contact.organizationName
        return contact.postalAddresses.enumerated().compactMap { index, entry in
            let kind = entry.label.map { CNLabeledValue<CNPostalAddress>.localizedString(forLabel: $0) } ?? ""
            return place(entry.value, of: contact, id: "\(contact.identifier)-\(index)", kind: kind.lowercased(),
                         person: person.isEmpty ? "Contact" : person)
        }
    }

    private nonisolated static func place(_ address: CNPostalAddress, of contact: CNContact, id: String,
                                          kind: String, person: String) -> ContactPlace? {
        let line = CNPostalAddressFormatter.string(from: address, style: .mailingAddress)
            .split(whereSeparator: \.isNewline).joined(separator: ", ")
        guard !line.isEmpty else { return nil }
        return ContactPlace(id: id, person: person, kind: kind, address: address, line: line)
    }
}
