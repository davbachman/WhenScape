import SwiftUI
import MapKit
import WhenScapeCore

@MainActor
struct MapPane: View {
    @ObservedObject var model: AppModel
    @StateObject private var contacts = ContactsService()
    @State private var position: MapCameraPosition = .automatic
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var searching = false
    @State private var searchMessage: String?
    @State private var activeSearch: MKLocalSearch?
    @State private var revision = UUID()
    @State private var saving = false
    /// The contact address being found on the map.
    @State private var locating: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Location", systemImage: "map").font(.headline)
                Spacer()
                saveButton
                Button { recenter() } label: { Image(systemName: "location") }.help("Center on observer")
                    .buttonStyle(.borderless)
            }.padding(.horizontal, 16).padding(.vertical, 12)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(contacts.hasAccess ? "Search for a place, address or contact" : "Search for a place or address", text: Binding(
                    get: { query },
                    set: { value in
                        query = value
                        cancelSearch()
                        contacts.search(value)
                    }
                )).textFieldStyle(.plain).onSubmit(search)
                if searching { ProgressView().controlSize(.small) }
                else if !query.isEmpty { Button { query = ""; closeResults() } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Clear location search") }
                Button(action: search) { Image(systemName: "arrow.right.circle.fill") }.buttonStyle(.plain).help("Search")
            }.padding(9).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, 12).padding(.bottom, 8)
            shortcuts
            if let message = model.locationMessage {
                Text(message).font(.caption).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
            }
            if let message = searchMessage {
                Text(message).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.bottom, 8)
            }
            if !contacts.matches.isEmpty || !results.isEmpty {
                ScrollView {
                    VStack(spacing: 0) {
                        if !contacts.matches.isEmpty {
                            sectionTitle("Contacts")
                            ForEach(contacts.matches) { place in
                                resultRow(place.title, detail: place.line, icon: "person.crop.circle", busy: locating == place.id) {
                                    chooseContact(place)
                                }
                            }
                            if !results.isEmpty { sectionTitle("Places") }
                        }
                        ForEach(Array(results.enumerated()), id: \.offset) { _, item in
                            resultRow(item.name ?? "Place", detail: item.placemark.title ?? "", icon: nil, busy: false) {
                                closeResults()
                                model.setLocation(item.placemark.coordinate, name: item.name, knownTimeZone: item.timeZone, remember: true)
                                query = item.name ?? query
                                recenter()
                            }
                        }
                    }
                }.frame(maxHeight: 190).background(.background)
            }
            MapReader { proxy in
                Map(position: $position, interactionModes: [.pan, .zoom]) {
                    Annotation("Observer", coordinate: model.coordinate, anchor: .center) {
                        ZStack {
                            Circle().fill(Color.accentColor.opacity(0.15)).frame(width: 44, height: 44)
                            Image(systemName: "location.north.fill").font(.system(size: 22)).foregroundStyle(Color.accentColor)
                                .rotationEffect(.degrees(model.heading)).shadow(color: .white, radius: 2)
                        }.accessibilityLabel("Observer position and heading")
                    }
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll, showsTraffic: false))
                .mapControls { MapScaleView() }
                .onTapGesture { point in
                    if let coordinate = proxy.convert(point, from: .local) {
                        closeResults()
                        model.setLocation(coordinate)
                    }
                }
            }
            HStack(spacing: 5) {
                Image(systemName: "figure.stand")
                Text("Click the map to choose where to stand")
                Spacer(minLength: 0)
            }.font(.caption).foregroundStyle(.secondary).padding(10)
        }
        .onAppear { recenter() }
        .onChange(of: model.latitude) { _, _ in recenter() }
        .onChange(of: model.longitude) { _, _ in recenter() }
        .onChange(of: model.eventSearchRevision) { _, _ in
            closeResults()
            query = model.eventLocationQuery
            if model.locationRequired && !query.isEmpty {
                search()
                contacts.search(query)
            }
        }
        .onDisappear { closeResults() }
    }

    // MARK: Saved and recent places

    private var saveButton: some View {
        let saved = model.currentSavedPlace
        return Button { saving = true } label: { Image(systemName: saved == nil ? "star" : "star.fill") }
            .buttonStyle(.borderless)
            .foregroundStyle(saved == nil ? Color.secondary : Color.accentColor)
            .help(saved.map { "Saved as \($0.title). Click to rename or remove it." } ?? "Save this place")
            .accessibilityLabel(saved.map { "Saved as \($0.title)" } ?? "Save this place")
            .disabled(model.locationRequired)
            .popover(isPresented: $saving, arrowEdge: .bottom) {
                SavePlaceForm(placeName: model.locationName, existing: saved,
                              isTaken: { label in
                                  model.places.hasSaved(label: label)
                                      && saved?.label?.caseInsensitiveCompare(label) != .orderedSame
                              },
                              onSave: { label in model.saveCurrentPlace(as: label); saving = false },
                              onRemove: { if let saved { model.forget(saved) }; saving = false },
                              onCancel: { saving = false })
            }
    }

    /// Home and Work from the user's own contact card, until those are saved.
    private var cardSuggestions: [ContactPlace] {
        contacts.cardPlaces.filter { !model.places.hasSaved(label: $0.kind) }
    }

    @ViewBuilder private var shortcuts: some View {
        let recents = model.places.unsavedRecents
        if !model.places.saved.isEmpty || !cardSuggestions.isEmpty || !recents.isEmpty || contacts.authorization == .notDetermined {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.places.saved) { place in
                        chip(icon(for: place), place.title, prominent: true, help: place.name) { go(to: place) }
                            .contextMenu { Button("Remove “\(place.title)”") { model.forget(place) } }
                    }
                    ForEach(cardSuggestions) { place in
                        chip("person.crop.circle", place.kind, prominent: false,
                             help: "\(place.line), from your contact card. Click to go there and save it as \(place.kind).",
                             busy: locating == place.id) { useCardPlace(place) }
                    }
                    ForEach(recents) { place in
                        chip("clock", place.name, prominent: false, help: "Recent: \(place.name)") { go(to: place) }
                            .contextMenu { Button("Remove from Recents") { model.forget(place) } }
                    }
                    if contacts.authorization == .notDetermined {
                        chip("person.crop.circle.badge.plus", contacts.isRequestingAccess ? "Asking…" : "Contacts", prominent: false,
                             help: "Find people’s addresses from Contacts when you search. WhenScape only reads names and addresses.") {
                            Task { await contacts.requestAccess() }
                        }
                    }
                }.padding(.horizontal, 12)
            }
            .padding(.bottom, 8)
        }
    }

    private func icon(for place: PlaceRecord) -> String {
        switch place.label?.lowercased() {
        case "home": return "house.fill"
        case "work": return "briefcase.fill"
        default: return "star.fill"
        }
    }

    private func chip(_ icon: String, _ title: String, prominent: Bool, help: String, busy: Bool = false,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if busy { ProgressView().controlSize(.mini) }
                else { Image(systemName: icon).foregroundStyle(prominent ? Color.accentColor : Color.secondary) }
                Text(title).lineLimit(1).truncationMode(.tail)
            }
            .font(.caption)
            .frame(maxWidth: 150)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.quaternary.opacity(prominent ? 0.8 : 0.45), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    /// A place button replaces whatever was being searched for.
    private func go(to place: PlaceRecord) {
        closeResults()
        query = ""
        model.go(to: place)
    }

    /// Goes to Home or Work from the user's card and saves it under that name.
    private func useCardPlace(_ place: ContactPlace) {
        locate(place) { coordinate, zone in
            let name = [place.address.street.split(whereSeparator: \.isNewline).first.map(String.init), place.address.city]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
            closeResults()
            query = ""
            model.setLocation(coordinate, name: name.isEmpty ? place.line : name, knownTimeZone: zone)
            model.saveCurrentPlace(as: place.kind)
        }
    }

    // MARK: Search

    private func sectionTitle(_ title: String) -> some View {
        Text(title.uppercased()).font(.system(size: 9, weight: .semibold)).tracking(1).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
    }

    private func resultRow(_ title: String, detail: String, icon: String?, busy: Bool,
                           action: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button(action: action) {
                HStack(spacing: 8) {
                    if busy { ProgressView().controlSize(.small) }
                    else if let icon { Image(systemName: icon).foregroundStyle(.secondary) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title).fontWeight(.medium)
                        Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(10).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Divider()
        }
    }

    private func chooseContact(_ place: ContactPlace) {
        locate(place) { coordinate, zone in
            model.setLocation(coordinate, name: place.title, knownTimeZone: zone, remember: true)
            closeResults()
            query = place.title
        }
    }

    /// Finds a contact's address on the map, then hands over its position and time zone.
    private func locate(_ place: ContactPlace, then use: @escaping (CLLocationCoordinate2D, TimeZone?) -> Void) {
        guard locating == nil else { return }
        locating = place.id
        searchMessage = nil
        Task {
            let placemark = await contacts.locate(place)
            locating = nil
            guard let location = placemark?.location else {
                searchMessage = "That address could not be found on the map. Try searching for it."
                return
            }
            use(location.coordinate, placemark?.timeZone)
        }
    }

    private func recenter() {
        position = .region(MKCoordinateRegion(center: model.coordinate, latitudinalMeters: 1600, longitudinalMeters: 1600))
    }
    private func search() {
        cancelSearch()
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let id = UUID(); revision = id
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = MKCoordinateRegion(center: model.coordinate, latitudinalMeters: 25000, longitudinalMeters: 25000)
        let operation = MKLocalSearch(request: request)
        activeSearch = operation; searching = true; searchMessage = nil
        operation.start { response, error in
            DispatchQueue.main.async {
                guard revision == id else { return }
                searching = false
                activeSearch = nil
                results = Array((response?.mapItems ?? []).prefix(8))
                if error != nil { searchMessage = "Search is unavailable. Try again, or choose a point on the map." }
                else if results.isEmpty && contacts.matches.isEmpty { searchMessage = "No matching places. Try a fuller address or choose a map point." }
            }
        }
    }

    /// Stops a place search in progress and clears its results.
    private func cancelSearch() {
        activeSearch?.cancel()
        activeSearch = nil
        revision = UUID()
        searching = false
        results = []
        searchMessage = nil
    }

    /// Clears place and contact results alike.
    private func closeResults() {
        cancelSearch()
        contacts.clear()
    }
}

/// Names the current place, or renames or removes it if it is already saved.
private struct SavePlaceForm: View {
    let placeName: String
    let existing: PlaceRecord?
    let isTaken: (String) -> Bool
    let onSave: (String) -> Void
    let onRemove: () -> Void
    let onCancel: () -> Void
    @State private var label: String

    init(placeName: String, existing: PlaceRecord?, isTaken: @escaping (String) -> Bool,
         onSave: @escaping (String) -> Void, onRemove: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.placeName = placeName
        self.existing = existing
        self.isTaken = isTaken
        self.onSave = onSave
        self.onRemove = onRemove
        self.onCancel = onCancel
        _label = State(initialValue: existing?.label ?? "")
    }

    private var trimmed: String { label.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(existing == nil ? "Save this place" : "Saved place").font(.headline)
            Text(placeName).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            TextField("Name, such as Home", text: $label).textFieldStyle(.roundedBorder).onSubmit(save)
            HStack(spacing: 6) {
                ForEach(["Home", "Work"], id: \.self) { preset in
                    Button(preset) { label = preset }.controlSize(.small)
                }
            }
            if !trimmed.isEmpty && isTaken(trimmed) {
                Text("This replaces the place now saved as \(trimmed).").font(.caption).foregroundStyle(.orange)
            }
            HStack {
                if existing != nil { Button("Remove", role: .destructive, action: onRemove) }
                Spacer()
                Button("Cancel", action: onCancel).keyboardShortcut(.cancelAction)
                Button("Save", action: save).keyboardShortcut(.defaultAction).disabled(trimmed.isEmpty)
            }
        }
        .padding(14).frame(width: 280)
    }

    private func save() { if !trimmed.isEmpty { onSave(trimmed) } }
}
