#include "Scene.hpp"

#include <cstdint>

namespace sundial {
namespace {

uint32_t hash(unsigned x, unsigned y, unsigned seed) {
    uint32_t n = x*0x9e3779b9u ^ y*0x85ebca6bu ^ seed*0xc2b2ae35u;
    n = (n ^ (n >> 16)) * 0x7feb352du;
    n = (n ^ (n >> 15)) * 0x846ca68bu;
    return n ^ (n >> 16);
}

double grain(unsigned x, unsigned y, unsigned seed) { return hash(x, y, seed) / 4294967296.0; }

double mottling(double u, double v, unsigned columns, unsigned rows, unsigned seed) {
    const double x = u*columns, y = v*rows;
    const unsigned a = static_cast<unsigned>(x), b = static_cast<unsigned>(y);
    const double dx = x-a, dy = y-b;
    const double f = dx*dx*(3-2*dx), g = dy*dy*(3-2*dy);
    const unsigned nextX = (a+1)%columns, nextY = (b+1)%rows;
    return (grain(a,b,seed)*(1-f)+grain(nextX,b,seed)*f)*(1-g)
        + (grain(a,nextY,seed)*(1-f)+grain(nextX,nextY,seed)*f)*g;
}

struct Finish {
    Color base, aggregate;
    double variation, mottlingStrength, grainStrength, aggregateStrength;
};

Finish finishFor(Surface surface) {
    switch (surface) {
    case Surface::concrete: return {{0.68, 0.64, 0.56}, {0.53, 0.49, 0.43}, 0.078, 0.041, 0.081, 0.23};
    case Surface::terrazzo: return {{0.86, 0.83, 0.75}, {0.49, 0.44, 0.38}, 0.052, 0.033, 0.061, 0.29};
    case Surface::paving: return {{0.66, 0.62, 0.53}, {0.48, 0.44, 0.36}, 0.119, 0.052, 0.085, 0.28};
    case Surface::earth: return {{0.38, 0.41, 0.36}, {0.31, 0.34, 0.28}, 0.073, 0.037, 0.070, 0.33};
    case Surface::patina: return {{0.30, 0.31, 0.26}, {0.20, 0.34, 0.29}, 0.117, 0.041, 0.075, 0.45};
    case Surface::gravel: return {{0.65, 0.59, 0.47}, {0.44, 0.42, 0.34}, 0.08, 0.07, 0.18, 0.30};
    }
}

void engraveScale(CGContextRef context, int w, int h) {
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithCGContext:context flipped:NO]];
    const auto x = [=](double minute) { return w * (markAngle(minute)-startAngle)/(endAngle-startAngle); };
    const auto y = [=](double axial) { return h * (axial + halfWidth)/(2*halfWidth); };
    const auto ink = [NSColor colorWithSRGBRed:0.20 green:0.17 blue:0.12 alpha:1];
    const auto lip = [NSColor colorWithSRGBRed:0.99 green:0.95 blue:0.83 alpha:0.54];

    const auto stroke = [&](double x1, double x2, double y1, double y2, double width) {
        CGContextSetLineWidth(context, width);
        CGContextSetStrokeColorWithColor(context, lip.CGColor);
        CGContextMoveToPoint(context, x1+1.6, y1-1.6);
        CGContextAddLineToPoint(context, x2+1.6, y2-1.6);
        CGContextStrokePath(context);
        CGContextSetStrokeColorWithColor(context, ink.CGColor);
        CGContextMoveToPoint(context, x1, y1);
        CGContextAddLineToPoint(context, x2, y2);
        CGContextStrokePath(context);
    };
    for (int minute = firstMinute; minute <= lastMinute; minute += 5) {
        const bool hour = minute % 60 == 0, quarter = minute % 15 == 0, half = minute % 30 == 0;
        const double length = hour ? 0.127 : half ? 0.092 : quarter ? 0.072 : 0.044;
        stroke(x(minute), x(minute), y(0), y(length), hour ? 6.8 : quarter ? 4.3 : 3.2);
    }
    stroke(x(firstMinute), x(lastMinute), y(0), y(0), 2.4);
    for (double edge : {-0.220, 0.220}) {
        stroke(x(firstMinute), x(lastMinute), y(edge), y(edge), 2.6);
    }

    const auto letter = [&](NSString* label, double minute, double axial, NSFont* font) {
        NSDictionary* attributes = @{NSFontAttributeName: font, NSForegroundColorAttributeName: ink};
        NSDictionary* bevel = @{NSFontAttributeName: font, NSForegroundColorAttributeName: lip};
        const auto size = [label sizeWithAttributes:attributes];
        const double left = std::clamp(x(minute)-size.width/2, 4.0, w-size.width-5);
        const auto point = NSMakePoint(left, y(axial)-size.height/2);
        [label drawAtPoint:NSMakePoint(point.x+1.8, point.y-2.2) withAttributes:bevel];
        [label drawAtPoint:point withAttributes:attributes];
    };
    NSArray<NSString*> *hours = @[@"VI", @"VII", @"VIII", @"IX", @"X", @"XI", @"XII",
                                  @"I", @"II", @"III", @"IV", @"V", @"VI"];
    const double typeSize = h*0.25;
    auto roman = [NSFont fontWithName:@"Baskerville-SemiBold" size:typeSize] ?: [NSFont boldSystemFontOfSize:typeSize];
    for (NSUInteger index = 0; index < hours.count; ++index) {
        letter(hours[index], firstMinute+60*index, -0.109, roman);
    }
    letter(@"PST", 720, 0.174, [NSFont systemFontOfSize:h*0.079 weight:NSFontWeightSemibold]);
    [NSGraphicsContext restoreGraphicsState];
}

} // namespace

NSImage* surfaceTexture(Surface surface, double snowCover) {
    const bool scale = surface == Surface::terrazzo;
    const bool gravel = surface == Surface::gravel;
    const int w = scale ? 3072 : gravel ? 192 : 384;
    const int h = gravel ? 1536 : 384;
    const auto finish = finishFor(surface);
    const auto seed = static_cast<unsigned>(surface) + 7;
    const Color base = finish.base.mix({0.89, 0.93, 0.96}, snowCover);
    const auto colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    const auto context = CGBitmapContextCreate(nullptr, w, h, 8, w*4, colorSpace, kCGImageAlphaPremultipliedLast);
    auto pixels = static_cast<uint8_t*>(CGBitmapContextGetData(context));
    for (int y = 0; y < h; ++y) {
        const double v = (y+0.5)/h;
        for (int x = 0; x < w; ++x) {
            const double u = (x+0.5)/w;
            const double coarse = mottling(u,v,scale ? 48 : 8,gravel ? 113 : 8,seed)-0.5;
            const double medium = mottling(u,v,scale ? 212 : 48,gravel ? 490 : 48,seed+11)-0.5;
            const double fine = grain(x,y,seed+29)-0.5;
            const double aggregate = unit(-0.70 + 2.9*mottling(u,v,scale ? 560 : 125,gravel ? 710 : 96,seed+53));
            const double variance = (coarse*finish.variation + medium*finish.mottlingStrength +
                fine*finish.grainStrength) *
                (1-snowCover*0.61);
            const auto color = base.mix(finish.aggregate, aggregate*finish.aggregateStrength*(1-snowCover*0.93))
                + Color{variance,variance,variance};
            double alpha = 1;
            if (gravel) {
                // Feather the gravel into the soil along both edges and at the far bend.
                const double edge = 0.487 - 0.065*mottling(u,v,8,112,seed+1);
                const double feather = unit((edge - std::abs(u-0.5) + fine*0.048)/0.084);
                const double distanceFade = unit((0.991-v)/0.17);
                alpha = feather*feather*(3-2*feather) * distanceFade*distanceFade*(3-2*distanceFade);
            }
            auto p = pixels+4*(y*w+x);
            p[0]=unit(color.r)*alpha*255; p[1]=unit(color.g)*alpha*255;
            p[2]=unit(color.b)*alpha*255; p[3]=alpha*255;
        }
    }
    if (scale) engraveScale(context, w, h);
    const auto image = CGBitmapContextCreateImage(context);
    auto result = [[NSImage alloc] initWithCGImage:image size:NSZeroSize];
    CGImageRelease(image);
    CGContextRelease(context);
    CGColorSpaceRelease(colorSpace);
    return result;
}

NSImage* contactShadowTexture() {
    const NSSize size = NSMakeSize(64, 64);
    return [NSImage imageWithSize:size flipped:NO drawingHandler:^BOOL(NSRect rect) {
        const auto context = NSGraphicsContext.currentContext.CGContext;
        const auto space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        const CGFloat colors[] = {0.08, 0.07, 0.05, 0.60, 0.10, 0.09, 0.07, 0.24, 0.10, 0.09, 0.07, 0};
        const CGFloat stops[] = {0, 0.56, 1};
        const auto gradient = CGGradientCreateWithColorComponents(space, colors, stops, 3);
        const auto center = CGPointMake(NSMidX(rect), NSMidY(rect));
        CGContextDrawRadialGradient(context, gradient, center, 0, center, NSWidth(rect)/2, 0);
        CGGradientRelease(gradient);
        CGColorSpaceRelease(space);
        return YES;
    }];
}

} // namespace sundial
