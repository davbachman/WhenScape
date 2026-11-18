#pragma once

#include "Sundial.hpp"

namespace sundial {

struct Wind {
    double speed; // m/s
    Vec downwind;
};

struct Weather {
    double validAt = 0;
    std::optional<double> clouds, rain, showers, snowfall, snowDepth, visibility;
    std::optional<double> windSpeed, windFrom, code;

    bool fresh(double now) const;
    bool hasData() const;
    std::optional<Wind> wind() const;
    double cloudiness() const;
    double fog() const;
    double rainfall() const;
    double flakes() const;
    double cover() const;
};

std::optional<size_t> currentHourIndex(const std::vector<double>& unixHours, double validAt);

constexpr double refreshSeconds = 15 * 60;
constexpr double staleSeconds = 45 * 60;
double retrySeconds(unsigned failures);

} // namespace sundial
