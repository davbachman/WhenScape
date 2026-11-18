#include "Sundial.hpp"
#include "Weather.hpp"
#include "astronomy.h"

#include <cstdlib>
#include <iomanip>
#include <iostream>

using namespace sundial;

namespace {

double utc(int year, int month, int day, int hour, int minute = 0) {
    return 946728000 + Astronomy_MakeTime(year, month, day, hour, minute, 0).ut * 86400;
}

void check(bool pass, const char* message) {
    if (!pass) {
        std::cerr << message << '\n';
        std::exit(1);
    }
}

void near(double actual, double expected, double tolerance, const char* message) {
    if (std::abs(actual - expected) > tolerance) {
        std::cerr << actual << " expected " << expected << " within " << tolerance << '\n';
        check(false, message);
    }
}

void astronomy() {
    const auto eclipse = skyAt(utc(2024, 3, 25, 7));
    check(eclipse.moonFraction > 0.999 && eclipse.moon.y > 0.5, "The eclipsed full Moon is above Claremont");
    check(eclipse.sun.y < 0, "The Sun is down during the lunar eclipse");
    const auto summer = skyAt(utc(2024, 6, 20, 20));
    near(degrees(std::asin(summer.sun.y)), 79.3, 0.3, "Claremont solstice solar elevation");
    check(summer.sun.x < 0 && summer.sun.z > 0, "The noon PST summer Sun is west of south");
    const auto spring = skyAt(utc(2024, 3, 10, 7));
    check(spring.moon.y < 0, "Below-horizon Moon fixture");
    const auto rise = nextSunrise(utc(2024, 3, 10, 7));
    check(rise.has_value(), "Find the upcoming sunrise");
    near(*rise, utc(2024, 3, 10, 14, 7), 120, "Sunrise on the spring DST change");
    near(degrees(std::asin(skyAt(*rise).sun.y)), -0.833, 0.02, "Apparent upper limb reaches the horizon");
    near(degrees(std::asin(pole.y)), latitude, 1e-9, "Polar orientation elevation");
    check(pole.x == 0 && pole.z < 0, "Polar wire aims true north");
    near(degrees(markAngle(720)), 2.272, 1e-9, "XII is offset to the Pacific standard meridian");
    check(pstMinutes(utc(2024, 6, 20, 20)) == 720, "Dial reads noon during 1 PM PDT");
}

void shadows() {
    const Dial dial;
    double worst = 0;
    int used = 0, earlier = 0, later = 0;
    // Dense sampling across three years covers DST changes, extrema, leap day,
    // both seasonal edges, and different hours of the marked scale.
    for (int year : {2024, 2026, 2030}) {
        for (int day = 0; day < 365; day += 3) {
            for (int hour : {15, 16, 18, 20, 22, 24, 25}) {
                const double timestamp = utc(year, 1, 1, 0) + day * 86400 + hour * 3600 + 13 * 60;
                const auto sky = skyAt(timestamp);
                const auto shadow = dial.shadow(sky.sun, timestamp);
                if (sky.sun.y <= 0) {
                    check(!shadow, "No below-horizon shadow");
                    continue;
                }
                const double expected = pstMinutes(timestamp);
                check(shadow.has_value(), "The shadow intersects the marked arc");
                const auto row = shadow->rows[24]; // Graduation lane used by the renderer.
                check(row.axial == 0 && row.earlier < row.later, "The shadow straddles the graduation lane");
                const bool useEarlier = shadow->readingEdge == ReadingEdge::earlier;
                const double edge = useEarlier ? row.earlier : row.later;
                check(edge >= startAngle && edge <= endAngle, "Selected edge is on the marked scale");
                const double delta = radians(0.005);
                check(dial.rayHitsSpindle(edge + (useEarlier ? delta : -delta), 0, sky.sun),
                      "Ray inside the drawn shadow hits the caster");
                check(!dial.rayHitsSpindle(edge + (useEarlier ? -delta : delta), 0, sky.sun),
                      "Ray outside the drawn shadow misses the caster");
                const auto point = scalePoint(edge, 0);
                const auto direction = point - center;
                // Recover the reading from the same surface vertices the renderer
                // draws, then compare to the independently derived standard time.
                const double reading = markMinute(std::atan2(direction.dot(east), direction.dot(trough)));
                worst = std::max(worst, std::abs(reading - expected));
                near(reading, expected, 5, "Selected visible shadow edge within 5 minutes of PST");
                ++used;
                useEarlier ? ++earlier : ++later;
            }
        }
    }
    check(earlier > 500 && later > 500, "Both seasonal edges exercised");
    std::cout << used << " illuminated shadow samples, " << earlier << " earlier and " << later
              << " later edges, maximum rendered-geometry error " << std::fixed
              << std::setprecision(2) << worst << " minutes PST\n";
}

void weather() {
    Weather sample;
    check(!sample.hasData() && !sample.wind(), "All-missing data is unavailable, including unknown wind");
    check(sample.fog() == 0 && sample.cover() == 0 && sample.flakes() == 0, "No fabricated weather effects");
    sample.validAt = 9000;
    check(sample.fresh(9000) && sample.fresh(11700) && !sample.fresh(11701), "Cache expires at 45 minutes");
    check(!sample.fresh(8900), "Reject future-dated sample");
    sample.clouds = 96;
    near(sample.cloudiness(), 0.96, 1e-9, "Overcast cloud field");
    sample.visibility = 140;
    check(sample.fog() > 0.75, "Low visibility drives fog");
    sample.code = 45;
    sample.visibility.reset();
    check(sample.fog() > 0.7, "Fog code fallback");
    sample.rain = 0.7;
    sample.showers = 0.8;
    near(sample.rainfall(), std::sqrt(0.5), 1e-9, "Rain and showers are combined");
    sample.snowfall = 0.35;
    check(sample.flakes() > 0.8 && sample.cover() == 0, "Flakes do not create inferred snow cover");
    sample.snowfall = 0;
    sample.snowDepth = 0.05;
    check(sample.flakes() == 0 && sample.cover() == 1, "Snow remains on the ground after falling snow stops");
    sample.windSpeed = 0;
    check(sample.wind() && sample.wind()->downwind.dot(sample.wind()->downwind) == 0, "Calm hangs limp");
    sample.windSpeed = 9;
    check(!sample.wind(), "Missing direction remains unknown");
    sample.windFrom = 0;
    near(sample.wind()->downwind.z, 1, 1e-9, "Northerly wind streams south");
    sample.windFrom = 270;
    near(sample.wind()->downwind.x, 1, 1e-9, "Westerly wind streams east");
    check(currentHourIndex({7200, 10800}, 9900) == 0 && !currentHourIndex({7200}, 10800),
          "Hourly supplements must contain the current sample timestamp");
    check(retrySeconds(0) == 900 && retrySeconds(1) == 30 && retrySeconds(4) == 240 &&
          retrySeconds(10000) == 900, "Bounded exponential backoff");
}

} // namespace

int main() {
    astronomy();
    shadows();
    weather();
    std::cout << "Astronomy and weather fixtures passed\n";
}
