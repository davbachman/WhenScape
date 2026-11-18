import XCTest
@testable import WhenScapeCore

final class ExplorationTimeTests: XCTestCase {
    private let zone = TimeZone(identifier: "America/Los_Angeles")!
    private func date(_ string: String) -> Date { ISO8601DateFormatter().date(from: string)! }

    func testSpringDayHas23Hours() {
        XCTAssertEqual(ExplorationTime.dayInterval(containing: date("2026-03-08T20:00:00Z"), in: zone).duration, 23 * 3600)
    }
    func testFallDayHas25Hours() {
        XCTAssertEqual(ExplorationTime.dayInterval(containing: date("2026-11-01T20:00:00Z"), in: zone).duration, 25 * 3600)
    }
    func testPlaybackAcrossMidnightAndBackwardWrap() {
        let start = date("2026-11-17T07:00:00Z")
        let interval = DateInterval(start: start, duration: 7200)
        XCTAssertEqual(ExplorationTime.advancing(start, by: -60, in: interval), start.addingTimeInterval(7140))
        XCTAssertEqual(ExplorationTime.advancing(start.addingTimeInterval(7140), by: 120, in: interval), start.addingTimeInterval(60))
    }
    func testNoonUsesPlaceTimezone() {
        XCTAssertEqual(ExplorationTime.noon(on: date("2026-11-17T07:00:00Z"), in: zone), date("2026-11-16T20:00:00Z"))
    }
}
