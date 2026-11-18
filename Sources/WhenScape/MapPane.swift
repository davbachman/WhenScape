import SwiftUI
import MapKit

@MainActor
struct MapPane: View {
    @ObservedObject var model: AppModel
    @State private var position: MapCameraPosition = .automatic
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var searching = false
    @State private var searchMessage: String?
    @State private var activeSearch: MKLocalSearch?
    @State private var revision = UUID()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Location", systemImage: "map").font(.headline)
                Spacer()
                Button { recenter() } label: { Image(systemName: "location") }.help("Center on observer")
                    .buttonStyle(.borderless)
            }.padding(.horizontal, 16).padding(.vertical, 12)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search for a place or address", text: Binding(
                    get: { query },
                    set: { value in
                        query = value
                        cancelSearch()
                    }
                )).textFieldStyle(.plain).onSubmit(search)
                if searching { ProgressView().controlSize(.small) }
                else if !query.isEmpty { Button { query = ""; cancelSearch() } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Clear location search") }
                Button(action: search) { Image(systemName: "arrow.right.circle.fill") }.buttonStyle(.plain).help("Search")
            }.padding(9).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, 12).padding(.bottom, 10)
            if let message = model.locationMessage {
                Text(message).font(.caption).foregroundStyle(.orange).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
            }
            if let message = searchMessage {
                Text(message).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.bottom, 8)
            }
            if !results.isEmpty {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.offset) { _, item in
                            Button {
                                cancelSearch()
                                model.setLocation(item.placemark.coordinate, name: item.name, knownTimeZone: item.timeZone)
                                query = item.name ?? query
                                recenter()
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.name ?? "Place").fontWeight(.medium)
                                    Text(item.placemark.title ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }.frame(maxHeight: 155).background(.background)
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
                        cancelSearch()
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
            cancelSearch()
            query = model.eventLocationQuery
            if model.locationRequired && !query.isEmpty { search() }
        }
        .onDisappear { cancelSearch() }
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
                else if results.isEmpty { searchMessage = "No matching places. Try a fuller address or choose a map point." }
            }
        }
    }

    private func cancelSearch() {
        activeSearch?.cancel()
        activeSearch = nil
        revision = UUID()
        searching = false
        results = []
        searchMessage = nil
    }
}
