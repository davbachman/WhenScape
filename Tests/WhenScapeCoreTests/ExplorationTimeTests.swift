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
    func testStepsLandOnWholeQuarterHoursAndHours() {
        let local = { (h: Int, m: Int) in self.date(String(format: "2026-11-17T%02d:%02d:00Z", h + 8, m)) }
        XCTAssertEqual(ExplorationTime.stepped(local(10, 53), minutes: 15, forward: true, in: zone), local(11, 0))
        XCTAssertEqual(ExplorationTime.stepped(local(11, 0), minutes: 15, forward: true, in: zone), local(11, 15))
        XCTAssertEqual(ExplorationTime.stepped(local(10, 53), minutes: 15, forward: false, in: zone), local(10, 45))
        XCTAssertEqual(ExplorationTime.stepped(local(10, 45), minutes: 15, forward: false, in: zone), local(10, 30))
        XCTAssertEqual(ExplorationTime.stepped(local(10, 53), minutes: 60, forward: true, in: zone), local(11, 0))
        XCTAssertEqual(ExplorationTime.stepped(local(10, 53), minutes: 60, forward: false, in: zone), local(10, 0))
    }
    func testHourStepsFollowTheLocalClockInIndia() {
        // A half-hour offset: whole hours are on the local clock, not UTC.
        let india = TimeZone(identifier: "Asia/Kolkata")!
        XCTAssertEqual(ExplorationTime.stepped(date("2026-11-17T04:40:00Z"), minutes: 60, forward: true, in: india), date("2026-11-17T05:30:00Z"))
    }
    func testNoonUsesPlaceTimezone() {
        XCTAssertEqual(ExplorationTime.noon(on: date("2026-11-17T07:00:00Z"), in: zone), date("2026-11-16T20:00:00Z"))
    }
}
