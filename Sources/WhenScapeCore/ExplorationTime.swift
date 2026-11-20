import Foundation

public enum ExplorationTime {
    public static func dayInterval(containing date: Date, in timeZone: TimeZone) -> DateInterval {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: date)
        return DateInterval(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!)
    }

    public static func noon(on date: Date, in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }

    public static func clamped(_ date: Date, to interval: DateInterval) -> Date {
        min(max(date, interval.start), interval.end)
    }

    /// One step earlier or later on the local clock, landing on a whole step:
    /// from 10:53, fifteen minutes later is 11:00 and earlier is 10:45.
    public static func stepped(_ date: Date, minutes: Int, forward: Bool, in timeZone: TimeZone) -> Date {
        let step = TimeInterval(max(1, minutes) * 60)
        let offset = TimeInterval(timeZone.secondsFromGMT(for: date))
        let local = date.timeIntervalSince1970 + offset
        let target = forward ? (floor(local / step) + 1) * step : (ceil(local / step) - 1) * step
        return Date(timeIntervalSince1970: target - offset)
    }

    /// Fixed elapsed seconds, preserving distinct instants in repeated DST hours.
    public static func advancing(_ date: Date, by seconds: TimeInterval, in interval: DateInterval) -> Date {
        guard interval.duration > 0 else { return interval.start }
        let offset = date.timeIntervalSince(interval.start) + seconds
        let wrapped = ((offset.truncatingRemainder(dividingBy: interval.duration)) + interval.duration).truncatingRemainder(dividingBy: interval.duration)
        return interval.start.addingTimeInterval(wrapped)
    }
}
