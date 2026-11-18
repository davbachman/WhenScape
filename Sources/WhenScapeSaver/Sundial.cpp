#include "Sundial.hpp"
#include "astronomy.h"

#include <array>
#include <stdexcept>

namespace sundial {
namespace {
constexpr double unixJ2000 = 946728000;
constexpr double day = 86400;
constexpr double wireRadius = 0.0035;

astro_time_t engineTime(double seconds) { return Astronomy_TimeFromDays((seconds - unixJ2000) / day); }
const astro_observer_t observer = Astronomy_MakeObserver(latitude, longitude, 0);

astro_equatorial_t equator(astro_body_t body, astro_time_t& time) {
    auto value = Astronomy_Equator(body, &time, observer, EQUATOR_OF_DATE, ABERRATION);
    if (value.status != ASTRO_SUCCESS) throw std::runtime_error("Astronomy Engine equatorial position failed");
    return value;
}

double wrap(double angle) { return std::remainder(angle, 2 * pi); }
}

Vec equatorialDirection(double hourAngle, double declination) {
    return (trough * -std::cos(hourAngle) - east * std::sin(hourAngle)) * std::cos(declination)
        + pole * std::sin(declination);
}

Sky skyAt(double unixSeconds) {
    auto time = engineTime(unixSeconds);
    const double sidereal = Astronomy_SiderealTime(&time);
    auto direction = [&](astro_body_t body) {
        const auto position = equator(body, time);
        return equatorialDirection(radians(sidereal * 15 + longitude - position.ra * 15),
                                   radians(position.dec));
    };
    const auto illumination = Astronomy_Illumination(BODY_MOON, time);
    if (illumination.status != ASTRO_SUCCESS) throw std::runtime_error("Astronomy Engine lunar illumination failed");
    return {direction(BODY_SUN), direction(BODY_MOON), illumination.phase_fraction, sidereal};
}

std::optional<double> nextSunrise(double unixSeconds) {
    auto rise = Astronomy_SearchRiseSet(BODY_SUN, observer, DIRECTION_RISE, engineTime(unixSeconds), 2);
    if (rise.status != ASTRO_SUCCESS) return std::nullopt;
    return unixJ2000 + rise.time.ut * day;
}

double pstMinutes(double unixSeconds) {
    double seconds = std::fmod(unixSeconds + pstOffsetSeconds, day);
    return (seconds < 0 ? seconds + day : seconds) / 60;
}

Vec scalePoint(double angle, double axial, double inset) {
    const double faceRadius = radius - inset;
    const double crossSection = std::sqrt(faceRadius*faceRadius - axial*axial);
    return center + pole * axial + (trough * std::cos(angle) + east * std::sin(angle)) * crossSection;
}

Dial::Dial() {
    // Sample one reference year from winter solstice to winter solstice at noon PST.
    // Between solstices declination selects two dates, one on each branch. The
    // two edges of a centered spindle approximate the two equation-of-time corrections.
    std::vector<SeasonPoint> year;
    const double start = unixJ2000 + Astronomy_MakeTime(2023, 12, 20, 20, 0, 0).ut * day;
    for (int i = 0; i < 370; ++i) {
        const auto sky = skyAt(start + i * day);
        const double declination = std::asin(sky.sun.dot(pole));
        const double hourAngle = std::atan2(-sky.sun.dot(east), -sky.sun.dot(trough));
        year.push_back({declination, wrap(hourAngle - longitudeOffset) * 60 / hourRadians});
    }
    auto solstice = std::max_element(year.begin(), year.end(), [](auto a, auto b) {
        return a.declination < b.declination;
    });
    auto byDeclination = [](auto a, auto b) { return a.declination < b.declination; };
    auto winterStart = std::min_element(year.begin(), solstice, byDeclination);
    auto winterEnd = std::min_element(solstice, year.end(), byDeclination);
    spring.assign(winterStart, solstice + 1);
    autumn.assign(std::make_reverse_iterator(winterEnd + 1), std::make_reverse_iterator(solstice));

    // For a circle tangent to the solar ray, b = R*sin(edge angle) and
    // q = sqrt(R²-b²)*tan(declination) at the central graduation lane.
    // Use the actual tangent axial coordinate when constructing the lathe mesh.
    rings.push_back({-0.556, wireRadius});
    for (int i = 0; i <= 192; ++i) {
        const double d = radians(-23.45 + i * (46.90 / 192));
        const double a = separationAt(d) * hourRadians / 60;
        const double r = std::max(wireRadius, radius * std::sin(a));
        rings.push_back({std::sqrt(radius*radius-r*r) * std::tan(d), r});
    }
    rings.push_back({0.556, wireRadius});
}

double Dial::equationAt(const std::vector<SeasonPoint>& branch, double declination) {
    auto next = std::lower_bound(branch.begin(), branch.end(), declination,
        [](auto sample, double d) { return sample.declination < d; });
    if (next == branch.begin()) return next->equationMinutes;
    if (next == branch.end()) return branch.back().equationMinutes;
    auto previous = next - 1;
    double f = (declination - previous->declination) / (next->declination - previous->declination);
    return previous->equationMinutes + f * (next->equationMinutes - previous->equationMinutes);
}

double Dial::separationAt(double declination) const {
    return std::abs(equationAt(spring, declination) - equationAt(autumn, declination)) / 2;
}

ReadingEdge Dial::readingEdge(double unixSeconds) const {
    // Infer the branch of the annual curve from whether declination is rising.
    // The ordering of the two equation-of-time branches crosses in late spring.
    auto declination = [](double t) { return std::asin(skyAt(t).sun.dot(pole)); };
    const bool rising = declination(unixSeconds + day / 2) > declination(unixSeconds - day / 2);
    const double d = declination(unixSeconds);
    const bool springEarlier = equationAt(spring, d) >= equationAt(autumn, d);
    return springEarlier == rising ? ReadingEdge::earlier : ReadingEdge::later;
}

bool Dial::intersects(double offset, double axial, double slope, double receiverRadius) const {
    const double across = receiverRadius * std::sin(offset);
    const double along = receiverRadius * std::cos(offset);
    if (along <= 0 || std::abs(across) > 0.085) return false;
    const double atAxis = axial + along * slope;
    // Along is the receiver's distance from closest approach, in its equatorial
    // plane. Ray parameter u is centered at closest approach. Each spindle ring
    // pair encloses a conical frustum with linearly interpolated radius.
    if (std::abs(slope) < 1e-9) {
        auto next = std::upper_bound(rings.begin(), rings.end(), atAxis,
            [](double q, Ring ring) { return q < ring.axial; });
        if (next == rings.begin() || next == rings.end()) return std::abs(across) <= wireRadius;
        const auto previous = next - 1;
        const double f = (atAxis - previous->axial) / (next->axial - previous->axial);
        return std::abs(across) <= previous->radius + f * (next->radius - previous->radius);
    }
    if (std::abs(across) <= wireRadius) return true;
    // Only the ring intervals within one maximum spindle radius of the ray can intersect.
    const double span = 0.085 * std::abs(slope);
    auto next = std::upper_bound(rings.begin(), rings.end(), atAxis - span,
        [](double q, Ring ring) { return q < ring.axial; });
    if (next == rings.begin()) ++next;
    for (; next != rings.end() && (next - 1)->axial <= atAxis + span; ++next) {
        const auto a = *(next - 1);
        const auto b = *next;
        const double taper = (b.radius - a.radius) / (b.axial - a.axial);
        const double p = a.radius + taper * (atAxis - a.axial);
        const double m = taper * slope;
        const double u1 = (a.axial - atAxis) / slope;
        const double u2 = (b.axial - atAxis) / slope;
        const double low = std::min(u1, u2), high = std::min(along, std::max(u1, u2));
        auto intercept = [&](double u) {
            double r = p + m * u;
            return u*u + across*across <= r*r;
        };
        if (low > high) continue;
        if (intercept(low) || intercept(high)) return true;
        if (std::abs(m) < 1 && intercept(std::clamp(p*m / (1 - m*m), low, high))) return true;
    }
    return false;
}

bool Dial::rayHitsSpindle(double angle, double axial, Vec sun) const {
    const double x = -sun.dot(east), y = -sun.dot(trough);
    return intersects(wrap(angle - std::atan2(x, y)), axial, sun.dot(pole) / std::hypot(x, y),
                      std::sqrt(radius*radius - axial*axial));
}

std::optional<ShadowBand> Dial::shadow(Vec sun, double unixSeconds) const {
    if (sun.y <= 0) return std::nullopt;
    const double angle = std::atan2(-sun.dot(east), -sun.dot(trough));
    if (angle < startAngle - 0.1 || angle > endAngle + 0.1) return std::nullopt;
    ShadowBand result{readingEdge(unixSeconds), {}};
    for (int i = -24; i <= 24; ++i) {
        const double q = halfWidth * i / 24;
        double inside = 0, outside = 0.1;
        for (int j = 0; j < 16; ++j) {
            const double mid = (inside + outside) / 2;
            if (rayHitsSpindle(angle + mid, q, sun)) inside = mid;
            else outside = mid;
        }
        result.rows.push_back({q, angle - inside, angle + inside});
    }
    return result;
}

} // namespace sundial
