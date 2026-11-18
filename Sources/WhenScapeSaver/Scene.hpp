#pragma once

#import <AppKit/AppKit.h>
#import <SceneKit/SceneKit.h>

#include "Sundial.hpp"
#include "Weather.hpp"

namespace sundial {
inline const Vec cameraPosition{4.0, 2.52, 4.4};
inline const Vec cameraTarget{0, 1.40, -0.12};
inline const Vec cameraForward = (cameraTarget - cameraPosition).normalized();
inline const Vec cameraRight = cameraForward.cross(up).normalized();
inline const Vec cameraUp = cameraRight.cross(cameraForward);
inline double frameFOV(double aspect) {
    return degrees(2 * std::atan(std::tan(radians(43.0/2)) * std::max(1.0, 1.26/aspect)));
}

inline SCNVector3 sceneVector(Vec v) { return SCNVector3Make(v.x, v.y, v.z); }

struct Color {
    double r, g, b;
    Color mix(Color to, double f) const { return {r + (to.r-r)*f, g + (to.g-g)*f, b + (to.b-b)*f}; }
    Color operator*(double k) const { return {r*k, g*k, b*k}; }
    NSColor* native() const { return [NSColor colorWithSRGBRed:unit(r) green:unit(g) blue:unit(b) alpha:1]; }
};

struct Atmosphere {
    double daylight, twilight, cloud, fog, stars;
    Color horizon, zenith, sunlight;
};

Atmosphere atmosphere(const Sky& sky, const Weather& weather);
NSBitmapImageRep* skyImage(const Sky& sky, const Atmosphere& air, double seconds, CGSize size, double aspect);

} // namespace sundial

@interface SundialScene : NSObject
@property(nonatomic, readonly) SCNScene *scene;
@property(nonatomic, readonly) SCNNode *camera;
- (void)updateAt:(double)seconds weather:(const sundial::Weather&)weather size:(CGSize)size preview:(BOOL)preview;
- (BOOL)updateMotion:(double)elapsed;
- (BOOL)hasReadableShadow;
- (sundial::ReadingEdge)readingEdge;
- (BOOL)isNight;
@end
