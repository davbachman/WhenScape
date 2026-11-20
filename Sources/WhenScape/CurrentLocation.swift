import CoreLocation

/// Finds the Mac's own location once, when the user clicks Here. macOS asks
/// for permission the first time. Nothing is tracked in the background.
@MainActor
final class CurrentLocation: NSObject, ObservableObject, CLLocationManagerDelegate {
    enum Problem: Error { case denied, unavailable }

    @Published private(set) var isLocating = false
    private let manager = CLLocationManager()
    private var completion: ((Result<CLLocation, Problem>) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func locate(_ completion: @escaping (Result<CLLocation, Problem>) -> Void) {
        guard !isLocating else { return }
        self.completion = completion
        isLocating = true
        proceed(manager.authorizationStatus)
    }

    /// Asks for permission, gives up if it is refused, or asks for one fix.
    private func proceed(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: finish(.failure(.denied))
        default: manager.requestLocation()
        }
    }

    private func finish(_ result: Result<CLLocation, Problem>) {
        guard isLocating else { return }
        isLocating = false
        let completion = completion
        self.completion = nil
        completion?(result)
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            // Also called when the delegate is set; only act on a pending request.
            guard self.isLocating, status != .notDetermined else { return }
            self.proceed(status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in self.finish(.success(location)) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        Task { @MainActor in self.finish(.failure(denied ? .denied : .unavailable)) }
    }
}
