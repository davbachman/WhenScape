import XCTest
@testable import WhenScapeCore

final class SideScrollTests: XCTestCase {
    func testSidewaysGestureFollowsTheFingersAndSwallowsItsGlide() {
        var scroll = SideScroll()
        XCTAssertEqual(scroll.handle(.mayBegin, dx: 0, dy: 0, inside: true, precise: true, at: 0), .pass)
        XCTAssertEqual(scroll.handle(.began, dx: -3, dy: 0.5, inside: true, precise: true, at: 0.01), .pass)
        XCTAssertEqual(scroll.handle(.changed, dx: -5, dy: 0, inside: true, precise: true, at: 0.02), .follow(-8))
        XCTAssertEqual(scroll.handle(.changed, dx: -90, dy: 4, inside: true, precise: true, at: 0.03), .follow(-98))
        XCTAssertEqual(scroll.handle(.ended, dx: 0, dy: 0, inside: true, precise: true, at: 0.04), .release(-98))
        XCTAssertEqual(scroll.handle(.momentum, dx: -20, dy: 0, inside: true, precise: true, at: 0.05), .consume)
        XCTAssertEqual(SideScroll.page(travel: -98, width: 400), 1)
    }

    func testVerticalScrollIsLeftAloneIncludingItsGlide() {
        var scroll = SideScroll()
        XCTAssertEqual(scroll.handle(.began, dx: 1, dy: 6, inside: true, precise: true, at: 0), .pass)
        XCTAssertEqual(scroll.handle(.changed, dx: 30, dy: 2, inside: true, precise: true, at: 0.01), .pass)
        XCTAssertEqual(scroll.handle(.ended, dx: 0, dy: 0, inside: true, precise: true, at: 0.02), .pass)
        XCTAssertEqual(scroll.handle(.momentum, dx: 0, dy: 10, inside: true, precise: true, at: 0.03), .pass)
    }

    func testGestureStartingOutsideIsIgnored() {
        var scroll = SideScroll()
        XCTAssertEqual(scroll.handle(.began, dx: -10, dy: 0, inside: false, precise: true, at: 0), .pass)
        XCTAssertEqual(scroll.handle(.changed, dx: -40, dy: 0, inside: true, precise: true, at: 0.01), .pass)
        XCTAssertEqual(scroll.handle(.ended, dx: 0, dy: 0, inside: true, precise: true, at: 0.02), .pass)
    }

    func testNewGestureStopsSwallowingTheGlide() {
        var scroll = SideScroll()
        _ = scroll.handle(.began, dx: -10, dy: 0, inside: true, precise: true, at: 0)
        _ = scroll.handle(.ended, dx: 0, dy: 0, inside: true, precise: true, at: 0.01)
        XCTAssertEqual(scroll.handle(.began, dx: 0, dy: 10, inside: true, precise: true, at: 1), .pass)
        _ = scroll.handle(.ended, dx: 0, dy: 0, inside: true, precise: true, at: 1.01)
        XCTAssertEqual(scroll.handle(.momentum, dx: 0, dy: 10, inside: true, precise: true, at: 1.02), .pass)
    }

    func testCancelledGestureStays() {
        var scroll = SideScroll()
        _ = scroll.handle(.began, dx: 50, dy: 0, inside: true, precise: true, at: 0)
        XCTAssertEqual(scroll.handle(.cancelled, dx: 0, dy: 0, inside: true, precise: true, at: 0.01), .release(0))
    }

    func testMouseWheelPagesOncePerNotchWithAPause() {
        var scroll = SideScroll()
        XCTAssertEqual(scroll.handle(.none, dx: -1, dy: 0, inside: true, precise: false, at: 10), .step(1))
        XCTAssertEqual(scroll.handle(.none, dx: -1, dy: 0, inside: true, precise: false, at: 10.1), .consume)
        XCTAssertEqual(scroll.handle(.none, dx: 1, dy: 0, inside: true, precise: false, at: 10.5), .step(-1))
        XCTAssertEqual(scroll.handle(.none, dx: 0, dy: -1, inside: true, precise: false, at: 11), .pass)
        XCTAssertEqual(scroll.handle(.none, dx: -1, dy: 0, inside: false, precise: false, at: 12), .pass)
    }

    func testPagingNeedsAFifthOfTheWidthUpTo80Points() {
        XCTAssertEqual(SideScroll.page(travel: 50, width: 600), 0)
        XCTAssertEqual(SideScroll.page(travel: 85, width: 600), -1)
        XCTAssertEqual(SideScroll.page(travel: -65, width: 300), 1)
        XCTAssertEqual(SideScroll.page(travel: -55, width: 300), 0)
    }
}
