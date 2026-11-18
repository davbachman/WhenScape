#include "Scene.hpp"

#include <array>
#include <cstdint>

namespace sundial {
namespace {

double smooth(double a, double b, double x) {
    const double t = unit((x - a) / (b - a));
    return t*t*(3 - 2*t);
}

double seeded(uint32_t n) {
    n ^= n >> 16;
    n *= 0x7feb352d;
    n ^= n >> 15;
    n *= 0x846ca68b;
    n ^= n >> 16;
    return n / 4294967296.0;
}

double noise(double x, double y) {
    int ix = static_cast<int>(std::floor(x)), iy = static_cast<int>(std::floor(y));
    const double u = smooth(0, 1, x - ix), v = smooth(0, 1, y - iy);
    const uint32_t p = uint32_t(ix) * 92837111u + uint32_t(iy) * 689287499u;
    const double a = seeded(p) * (1-u) + seeded(p + 92837111u) * u;
    const double b = seeded(p + 689287499u) * (1-u) + seeded(p + 997124610u) * u;
    return a * (1-v) + b * v;
}

struct Star { double rightAscension, declination, magnitude; };
const std::array<Star, 1220> stars = [] {
    std::array<Star, 1220> result{};
    for (size_t i = 0; i < result.size(); ++i) {
        result[i] = {seeded(3*i + 5)*2*pi, std::asin(2*seeded(3*i + 6)-1), seeded(3*i + 7)};
    }
    return result;
}();

} // namespace

Atmosphere atmosphere(const Sky& sky, const Weather& weather) {
    const double elevation = degrees(std::asin(sky.sun.y));
    const double day = smooth(-4, 16, elevation);
    const double twilight = smooth(-13, -1, elevation) * (1-smooth(1, 14, elevation));
    const double cloud = weather.cloudiness(), fog = weather.fog();
    Color horizon = Color{0.12, 0.17, 0.26}.mix({0.81, 0.86, 0.87}, day);
    horizon = horizon.mix({0.78, 0.43, 0.35}, twilight*0.64*(1-cloud*0.7));
    horizon = horizon.mix(Color{0.18, 0.22, 0.28}.mix({0.71, 0.76, 0.77}, day), cloud*0.53 + fog*0.37);
    Color zenith = Color{0.027, 0.046, 0.096}.mix({0.15, 0.35, 0.55}, day);
    zenith = zenith.mix({0.16, 0.21, 0.39}, twilight*0.51);
    zenith = zenith.mix(Color{0.096, 0.125, 0.185}.mix({0.48, 0.57, 0.65}, day), cloud*0.58);
    const Color sunlight = Color{1, 0.65, 0.43}.mix({1, 0.95, 0.85}, smooth(0, 32, elevation));
    return {day, twilight, cloud, fog, (1-smooth(-16, -7, elevation)) * (1-fog*0.85),
            horizon, zenith, sunlight};
}

NSBitmapImageRep* skyImage(const Sky& sky, const Atmosphere& air, double seconds, CGSize size, double aspect) {
    const int w = static_cast<int>(size.width), h = static_cast<int>(size.height);
    auto bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr pixelsWide:w pixelsHigh:h
        bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
        bitmapFormat:0 bytesPerRow:w*4 bitsPerPixel:32];
    auto pixels = bitmap.bitmapData;
    const double spread = std::tan(radians(frameFOV(aspect) / 2));
    const double drift = std::fmod(seconds, 60*60*24*30) * 0.0025;
    const double sunHaze = 0.23 * (air.daylight + air.twilight*0.8) * (1-air.cloud*0.86);
    std::vector<double> obscuration(w*h);

    const double phaseCos = std::clamp(2 * sky.moonFraction - 1, -1.0, 1.0);
    const double sunAlongMoon = sky.sun.dot(sky.moon);
    const Vec brightSide = sky.sun - sky.moon * sunAlongMoon;
    const Vec moonLight = brightSide.dot(brightSide) > 1e-12
        ? brightSide.normalized() * std::sqrt(1 - phaseCos*phaseCos) - sky.moon * phaseCos
        : sky.moon * -phaseCos;
    const double moonRadius = radians(0.58); // Enlarged slightly for the small system preview.
    const bool showMoon = sky.moon.y > 0 && sky.moon.dot(cameraForward) > 0.75;
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            Vec ray = (cameraForward + cameraRight * ((2.0*(x + 0.5)/w - 1)*aspect*spread)
                       + cameraUp * ((1 - 2.0*(y + 0.5)/h)*spread)).normalized();
            const double lift = smooth(0, 0.32, ray.y);
            Color color = air.horizon.mix(air.zenith, std::pow(lift, 0.72));
            double cloudAlpha = 0;
            if (ray.y > 0) {
                // Project the view through a raised cloud layer. The horizon
                // compresses the shapes and haze softens edges in the distance.
                const double altitude = 0.14 + ray.y;
                const double a = ray.x / altitude * 1.75 + drift, b = ray.z / altitude * 2.6;
                const double warp = noise(a*1.6+31, b*1.7) - 0.5;
                const double field = noise(a+warp*0.55, b)*0.65 +
                    noise(a*2.9 + 23, b*2.9)*0.24 + noise(a*8, b*7)*0.11;
                const double threshold = 0.88 - air.cloud*0.74;
                cloudAlpha = smooth(threshold-0.08, threshold+0.12, field) * smooth(0, 0.055, ray.y);
                cloudAlpha = unit(cloudAlpha * (1-air.fog*0.40) * smooth(0, 0.14, air.cloud));
                const double sunDot = std::max(0.0, sky.sun.dot(ray));
                const double warmHaze = air.twilight*0.29*std::exp(-std::pow((ray.y-0.045)/0.063, 2)) *
                    smooth(0, 0.029, ray.y)*(1-air.cloud*0.65)*(1-air.fog*0.45);
                color = color.mix({0.94, 0.57, 0.43}, warmHaze);
                color = color.mix(air.sunlight, std::pow(sunDot, 16)*sunHaze);
                if (sky.sun.y > 0) color = color.mix({1, 0.95, 0.78},
                    smooth(std::cos(radians(0.53)), std::cos(radians(0.30)), sunDot)*(1-air.fog*0.85));
                if (showMoon) {
                    const double along = ray.dot(sky.moon);
                    const double halo = std::pow(std::max(0.0, along), 310) *
                        sky.moonFraction*(1-air.daylight)*(1-air.fog)*0.18;
                    color = color.mix({0.38, 0.48, 0.61}, halo);
                    if (along > std::cos(moonRadius)) {
                        const Vec inPlane = (ray - sky.moon*along) * (1/std::sin(moonRadius));
                        const Vec normal = inPlane - sky.moon*std::sqrt(unit(1-inPlane.dot(inPlane)));
                        const double shade = smooth(-0.035, 0.035, normal.dot(moonLight));
                        const double maria = noise(6*inPlane.x + 8, 6*(inPlane.y + inPlane.z));
                        Color disc = Color{0.88, 0.88, 0.78}.mix({0.68, 0.70, 0.65}, maria*0.68);
                        color = color.mix(disc, (0.045 + shade*0.93)*(1-air.fog*0.85));
                    }
                }
                const Color cloudColor = Color{0.11, 0.14, 0.20}.mix({0.91, 0.91, 0.88}, air.daylight)
                    .mix({0.66, 0.39, 0.34}, air.twilight*0.37)
                    .mix(air.horizon, (1-smooth(0, 0.27, ray.y))*0.42)
                    .mix({0.41, 0.48, 0.56}, air.daylight*field*(0.27+air.cloud*0.45));
                color = color.mix(cloudColor, cloudAlpha);
            }
            const size_t index = static_cast<size_t>(y*w + x);
            obscuration[index] = cloudAlpha;
            const double dither = (seeded(static_cast<uint32_t>(index))-0.5)/255;
            color = color + Color{dither, dither, dither};
            auto p = pixels + 4*index;
            p[0] = unit(color.r)*255; p[1] = unit(color.g)*255; p[2] = unit(color.b)*255; p[3] = 255;
        }
    }
    if (air.stars > 0.005 && air.cloud < 0.95) {
        for (const auto& star : stars) {
            const double hour = radians(15*sky.siderealHours + longitude) - star.rightAscension;
            const Vec direction = equatorialDirection(hour, star.declination);
            const double depth = direction.dot(cameraForward);
            if (direction.y < 0.035 || depth < 0.1) continue;
            const double sx = direction.dot(cameraRight) / (depth*spread*aspect);
            const double sy = direction.dot(cameraUp) / (depth*spread);
            if (std::abs(sx) >= 0.995 || std::abs(sy) >= 0.995) continue;
            const int x = std::clamp(static_cast<int>((sx+1)*w/2), 0, w-1);
            const int y = std::clamp(static_cast<int>((1-sy)*h/2), 0, h-1);
            const size_t index = static_cast<size_t>(y*w+x);
            const double brightness = (0.18 + 0.82*std::pow(star.magnitude, 5)) * air.stars *
                std::pow(1-obscuration[index], 3) * (1-air.cloud*0.62);
            for (int i = 0; i < 3; ++i) pixels[4*index+i] = pixels[4*index+i]*(1-brightness) + 246*brightness;
        }
    }
    return bitmap;
}

} // namespace sundial
