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
    double variation, grainStrength, aggregateStrength;
};

Finish finishFor(Surface surface) {
    switch (surface) {
    case Surface::concrete: return {{0.66, 0.62, 0.55}, {0.47, 0.43, 0.37}, 0.16, 0.13, 0.35};
    case Surface::terrazzo: return {{0.84, 0.81, 0.74}, {0.48, 0.43, 0.36}, 0.07, 0.08, 0.42};
    case Surface::paving: return {{0.66, 0.61, 0.52}, {0.48, 0.43, 0.33}, 0.21, 0.12, 0.35};
    case Surface::earth: return {{0.39, 0.40, 0.34}, {0.33, 0.31, 0.24}, 0.24, 0.13, 0.50};
    case Surface::patina: return {{0.32, 0.33, 0.28}, {0.24, 0.36, 0.30}, 0.28, 0.09, 0.45};
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
    constexpr int mapHeight = 384;
    const int w = scale ? 3072 : mapHeight, h = mapHeight;
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
            const double coarse = mottling(u,v,scale ? 48 : 8,8,seed)-0.5;
            const double medium = mottling(u,v,scale ? 212 : 48,48,seed+11)-0.5;
            const double fine = grain(x,y,seed+29)-0.5;
            const double aggregate = unit(-0.70 + 2.9*mottling(u,v,scale ? 560 : 125,96,seed+53));
            const double variance = (coarse*finish.variation + medium*0.11 + fine*finish.grainStrength) *
                (1-snowCover*0.61);
            const auto color = base.mix(finish.aggregate, aggregate*finish.aggregateStrength*(1-snowCover*0.93))
                + Color{variance,variance,variance};
            auto p = pixels+4*(y*w+x);
            p[0]=unit(color.r)*255; p[1]=unit(color.g)*255; p[2]=unit(color.b)*255; p[3]=255;
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
