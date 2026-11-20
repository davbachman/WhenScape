import XCTest
@testable import WhenScapeCore

final class PlaceBookTests: XCTestCase {
    private let pitzer = PlaceRecord(name: "Pitzer College", latitude: 34.1040, longitude: -117.7071, timeZoneID: "America/Los_Angeles")
    private let griffith = PlaceRecord(name: "Griffith Observatory", latitude: 34.1184, longitude: -118.3004)
    private let nearPitzer = PlaceRecord(name: "Pitzer quad", latitude: 34.1043, longitude: -117.7071)  // about 33 m away

    func testHomeAndWorkStayFirstWhateverTheOrderSaved() {
        var book = PlaceBook()
        book.save(griffith, as: "Stargazing")
        book.save(pitzer, as: "work")
        book.save(PlaceRecord(name: "Elsewhere", latitude: 40, longitude: -74), as: "Home")
        XCTAssertEqual(book.saved.map(\.label), ["Home", "work", "Stargazing"])
    }

    func testSavingALabelAgainMovesIt() {
        var book = PlaceBook()
        book.save(pitzer, as: "Home")
        book.save(griffith, as: "home")
        XCTAssertEqual(book.saved.count, 1)
        XCTAssertEqual(book.saved.first?.name, "Griffith Observatory")
    }

    func testSavingTheSameSpotAgainRenamesIt() {
        var book = PlaceBook()
        book.save(pitzer, as: "Office")
        book.save(nearPitzer, as: "Work")
        XCTAssertEqual(book.saved.map(\.label), ["Work"])
        XCTAssertEqual(book.savedPlace(nearLatitude: 34.1040, longitude: -117.7071)?.label, "Work")
        XCTAssertNil(book.savedPlace(nearLatitude: 34.1184, longitude: -118.3004))
    }

    func testBlankLabelsAreNotSaved() {
        var book = PlaceBook()
        XCTAssertNil(book.save(pitzer, as: "  "))
        XCTAssertTrue(book.saved.isEmpty)
    }

    func testRecentsPutTheLatestFirstWithoutRepeatsAndStayShort() {
        var book = PlaceBook()
        book.noteVisit(pitzer)
        book.noteVisit(griffith)
        book.noteVisit(nearPitzer)
        XCTAssertEqual(book.recent.map(\.name), ["Pitzer quad", "Griffith Observatory"])
        for i in 0..<10 { book.noteVisit(PlaceRecord(name: "Place \(i)", latitude: Double(i), longitude: 0)) }
        XCTAssertEqual(book.recent.count, PlaceBook.recentLimit)
        XCTAssertEqual(book.recent.first?.name, "Place 9")
    }

    func testSavedPlacesAreLeftOutOfRecentsAndCanBeRemoved() {
        var book = PlaceBook()
        book.noteVisit(pitzer)
        book.noteVisit(griffith)
        let home = book.save(pitzer, as: "Home")!
        XCTAssertEqual(book.unsavedRecents.map(\.name), ["Griffith Observatory"])
        XCTAssertTrue(book.hasSaved(label: "HOME"))
        book.remove(home.id)
        XCTAssertFalse(book.hasSaved(label: "Home"))
        XCTAssertEqual(book.unsavedRecents.count, 2)
        book.remove(book.recent[0].id)
        XCTAssertEqual(book.recent.map(\.name), ["Pitzer College"])
    }

    func testRoundTripsThroughJSON() throws {
        var book = PlaceBook()
        book.save(pitzer, as: "Work")
        book.noteVisit(griffith)
        let copy = try JSONDecoder().decode(PlaceBook.self, from: JSONEncoder().encode(book))
        XCTAssertEqual(copy, book)
    }

    func testDistance() {
        XCTAssertEqual(PlaceBook.distance(34.1040, -117.7071, 34.1184, -118.3004), 54_700, accuracy: 300)
    }
}
