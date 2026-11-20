import Foundation

/// Tells a two-finger sideways scroll apart from a vertical one, for paging a
/// calendar a week at a time. A trackpad gesture is followed as it moves and
/// judged when the fingers lift; a mouse's sideways wheel turns one page per
/// notch, a few times a second at most. Vertical scrolls, and gestures that
/// start outside the area, are left for the scroll views to handle.
///
/// Distances use the system's scroll direction: negative moves the content
/// left, bringing in what lies to the right, which is later.
public struct SideScroll {
    public enum Phase: Equatable { case mayBegin, began, changed, ended, cancelled, momentum, none }

    public enum Outcome: Equatable {
        /// Not a sideways scroll: let the event through.
        case pass
        /// Part of a sideways scroll already being handled: swallow it.
        case consume
        /// The content should follow the fingers this far, in points.
        case follow(Double)
        /// The fingers lifted after travelling this far.
        case release(Double)
        /// A wheel notch: page by this much, −1 earlier or +1 later.
        case step(Int)
    }

    /// How far the fingers move before the scroll is judged sideways or vertical.
    public static let decisionDistance = 4.0
    /// The shortest time between wheel pages, in seconds.
    public static let stepInterval = 0.35

    private enum Lock { case undecided, sideways, vertical }
    private var tracking = false
    private var lock = Lock.undecided
    private var travel = 0.0, pendingX = 0.0, pendingY = 0.0
    private var swallowMomentum = false
    private var lastStep = -Double.infinity

    public init() {}

    public mutating func handle(_ phase: Phase, dx: Double, dy: Double, inside: Bool, precise: Bool,
                                at time: TimeInterval) -> Outcome {
        switch phase {
        case .momentum:
            // The glide after a sideways gesture would otherwise scroll the hours.
            return swallowMomentum ? .consume : .pass
        case .none:
            // A mouse wheel, which reports no gesture phases.
            guard inside, !precise, dx != 0, abs(dx) > abs(dy) else { return .pass }
            guard time - lastStep >= Self.stepInterval else { return .consume }
            lastStep = time
            return .step(dx < 0 ? 1 : -1)
        case .mayBegin:
            start(inside)
            return .pass
        case .began:
            start(inside)
            return move(dx, dy)
        case .changed:
            return move(dx, dy)
        case .ended, .cancelled:
            defer { tracking = false; lock = .undecided }
            guard tracking, lock == .sideways else { return .pass }
            swallowMomentum = true
            return .release(phase == .cancelled ? 0 : travel)
        }
    }

    /// Which way to page once the fingers lift, for an area this wide:
    /// −1 for the earlier week, +1 for the later one, 0 to stay.
    public static func page(travel: Double, width: Double) -> Int {
        guard abs(travel) >= min(80, max(width, 1) * 0.2) else { return 0 }
        return travel < 0 ? 1 : -1
    }

    private mutating func start(_ inside: Bool) {
        tracking = inside
        lock = .undecided
        travel = 0; pendingX = 0; pendingY = 0
        swallowMomentum = false
    }

    private mutating func move(_ dx: Double, _ dy: Double) -> Outcome {
        guard tracking else { return .pass }
        switch lock {
        case .vertical:
            return .pass
        case .sideways:
            travel += dx
            return .follow(travel)
        case .undecided:
            pendingX += dx; pendingY += dy
            guard hypot(pendingX, pendingY) >= Self.decisionDistance else { return .pass }
            guard abs(pendingX) > abs(pendingY) * 1.2 else { lock = .vertical; return .pass }
            lock = .sideways
            travel = pendingX
            return .follow(travel)
        }
    }
}
