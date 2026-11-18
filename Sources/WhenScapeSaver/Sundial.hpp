#pragma once

#include <algorithm>
#include <cmath>
#include <optional>
#include <vector>

namespace sundial {

constexpr double pi = 3.14159265358979323846;
constexpr double radians(double degrees) { return degrees * pi / 180; }
constexpr double degrees(double radians) { return radians * 180 / pi; }
constexpr double unit(double x) { return std::clamp(x, 0.0, 1.0); }
constexpr double latitude = 34.100;
constexpr double longitude = -117.728;
constexpr double longitudeOffset = radians(longitude + 120);
constexpr double pstOffsetSeconds = -8 * 3600;

// World axes are east, up, south. Azimuth is clockwise from true north.
struct Vec {
    double x, y, z;
    Vec operator+(Vec b) const { return {x + b.x, y + b.y, z + b.z}; }
    Vec operator-(Vec b) const { return *this + b * -1; }
    Vec operator*(double k) const { return {x * k, y * k, z * k}; }
    double dot(Vec b) const { return x*b.x + y*b.y + z*b.z; }
    Vec cross(Vec b) const { return {y*b.z - z*b.y, z*b.x - x*b.z, x*b.y - y*b.x}; }
    Vec normalized() const { return *this * (1 / std::sqrt(dot(*this))); }
};

inline const Vec east{1, 0, 0};
inline const Vec up{0, 1, 0};
inline const Vec north{0, 0, -1};
inline const Vec pole = up * std::sin(radians(latitude)) + north * std::cos(radians(latitude));
inline const Vec trough = north * std::sin(radians(latitude)) - up * std::cos(radians(latitude));

struct Sky {
    Vec sun, moon;
    double moonFraction, siderealHours;
};

Sky skyAt(double unixSeconds);
Vec equatorialDirection(double hourAngle, double declination);
std::optional<double> nextSunrise(double unixSeconds);
double pstMinutes(double unixSeconds);

constexpr double radius = 1.143; // 90 inch diameter, NASS dial 505.
constexpr double halfWidth = 0.245;
constexpr double firstMinute = 6 * 60;
constexpr double lastMinute = 18 * 60;
constexpr double hourRadians = pi / 12;
constexpr double markAngle(double minute) { return (minute - 720) * hourRadians / 60 + longitudeOffset; }
constexpr double markMinute(double angle) { return 720 + (angle - longitudeOffset) * 60 / hourRadians; }
constexpr double startAngle = markAngle(firstMinute) - radians(1);
constexpr double endAngle = markAngle(lastMinute) + radians(1);
inline const Vec center{0, 1.56, 0};
Vec scalePoint(double angle, double axial, double inset = 0);

enum class ReadingEdge { earlier, later };
struct Ring { double axial, radius; };
struct ShadowRow {
    double axial, earlier, later;
};
struct ShadowBand {
    ReadingEdge readingEdge;
    std::vector<ShadowRow> rows;
};

class Dial {
public:
    Dial();
    const std::vector<Ring>& spindle() const { return rings; }
    ReadingEdge readingEdge(double unixSeconds) const;
    std::optional<ShadowBand> shadow(Vec sun, double unixSeconds) const;
    bool rayHitsSpindle(double angle, double axial, Vec sun) const;
private:
    struct SeasonPoint { double declination, equationMinutes; };
    std::vector<SeasonPoint> spring, autumn;
    std::vector<Ring> rings;
    double separationAt(double declination) const;
    static double equationAt(const std::vector<SeasonPoint>& branch, double declination);
    bool intersects(double offset, double axial, double slope, double receiverRadius) const;
};

} // namespace sundial
