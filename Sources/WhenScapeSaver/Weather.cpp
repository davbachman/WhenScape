#include "Weather.hpp"

namespace sundial {
namespace {
bool nonnegative(std::optional<double> value) {
    return value && std::isfinite(*value) && *value >= 0;
}

double amount(std::optional<double> value) { return nonnegative(value) ? *value : 0; }
}

bool Weather::fresh(double now) const { return validAt <= now + 60 && now - validAt <= staleSeconds; }

bool Weather::hasData() const {
    return nonnegative(code) || nonnegative(rain) || nonnegative(showers) || nonnegative(snowfall) ||
        nonnegative(visibility) || nonnegative(snowDepth) || (clouds && *clouds >= 0 && *clouds <= 100) ||
        wind().has_value();
}

std::optional<Wind> Weather::wind() const {
    if (!nonnegative(windSpeed)) return std::nullopt;
    if (*windSpeed <= 0.25) return Wind{*windSpeed, {0, 0, 0}};
    if (!nonnegative(windFrom) || *windFrom > 360) return std::nullopt;
    const double angle = radians(*windFrom);
    return Wind{*windSpeed, east * -std::sin(angle) - north * std::cos(angle)};
}

double Weather::cloudiness() const {
    if (clouds && *clouds >= 0 && *clouds <= 100) return *clouds / 100;
    if (code == 1) return 0.2;
    if (code == 2) return 0.52;
    if (code == 3) return 0.95;
    if (code && *code >= 45) return 0.82;
    return 0;
}

double Weather::fog() const {
    if (nonnegative(visibility)) return unit(1 - std::log1p(*visibility / 100) / std::log(61.0));
    return code == 45 || code == 48 ? 0.72 : 0;
}

// The current sums are for the preceding 15 minutes. Convert to hourly intensity.
double Weather::rainfall() const {
    const double rate = 4 * (amount(rain) + amount(showers));
    if (nonnegative(rain) || nonnegative(showers)) return unit(std::sqrt(rate / 12));
    if (code && ((*code >= 51 && *code <= 67) || (*code >= 80 && *code <= 82) || *code >= 95)) return 0.28;
    return 0;
}

double Weather::flakes() const {
    if (nonnegative(snowfall)) return unit(std::sqrt(*snowfall * 4 / 2.0));
    if (code && ((*code >= 71 && *code <= 77) || *code == 85 || *code == 86)) return 0.32;
    return 0;
}

double Weather::cover() const { return unit(amount(snowDepth) / 0.045); }

std::optional<size_t> currentHourIndex(const std::vector<double>& unixHours, double validAt) {
    for (size_t index = 0; index < unixHours.size(); ++index) {
        if (validAt >= unixHours[index] && validAt - unixHours[index] < 3600) return index;
    }
    return std::nullopt;
}

double retrySeconds(unsigned failures) {
    if (failures == 0) return refreshSeconds;
    return std::min(refreshSeconds, 30.0 * (1u << std::min(failures - 1, 5u)));
}

} // namespace sundial
