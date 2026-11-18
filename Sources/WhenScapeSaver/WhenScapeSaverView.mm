#import "WhenScapeSaverView.h"
#import "Scene.hpp"

#include <limits>

using namespace sundial;

namespace {

NSURL* weatherURL() {
    auto url = [NSURLComponents componentsWithString:@"https://api.open-meteo.com/v1/forecast"];
    url.queryItems = @[
        [NSURLQueryItem queryItemWithName:@"latitude" value:@"34.100"],
        [NSURLQueryItem queryItemWithName:@"longitude" value:@"-117.728"],
        [NSURLQueryItem queryItemWithName:@"current"
            value:@"cloud_cover,weather_code,rain,showers,snowfall,wind_speed_10m,wind_direction_10m"],
        [NSURLQueryItem queryItemWithName:@"hourly" value:@"visibility,snow_depth"],
        [NSURLQueryItem queryItemWithName:@"wind_speed_unit" value:@"ms"],
        [NSURLQueryItem queryItemWithName:@"precipitation_unit" value:@"mm"],
        [NSURLQueryItem queryItemWithName:@"timeformat" value:@"unixtime"],
        [NSURLQueryItem queryItemWithName:@"timezone" value:@"GMT"],
        [NSURLQueryItem queryItemWithName:@"forecast_hours" value:@"4"]
    ];
    return url.URL;
}

NSDictionary* dictionary(id value) { return [value isKindOfClass:NSDictionary.class] ? value : nil; }
NSArray* array(id value) { return [value isKindOfClass:NSArray.class] ? value : nil; }

std::optional<double> number(id value) {
    if (![value isKindOfClass:NSNumber.class] ||
        CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return std::nullopt;
    const double n = [value doubleValue];
    return std::isfinite(n) ? std::optional<double>{n} : std::nullopt;
}

std::optional<Weather> decodeWeather(NSData* data, double now) {
    if (data.length == 0) return std::nullopt;
    auto values = dictionary([NSJSONSerialization JSONObjectWithData:data options:0 error:nullptr]);
    const auto current = dictionary(values[@"current"]);
    const auto valid = number(current[@"time"]);
    if (!valid) return std::nullopt;
    Weather result;
    result.validAt = *valid;
    result.clouds = number(current[@"cloud_cover"]);
    result.code = number(current[@"weather_code"]);
    result.rain = number(current[@"rain"]);
    result.showers = number(current[@"showers"]);
    result.snowfall = number(current[@"snowfall"]);
    result.windSpeed = number(current[@"wind_speed_10m"]);
    result.windFrom = number(current[@"wind_direction_10m"]);

    const auto hourly = dictionary(values[@"hourly"]);
    std::vector<double> times;
    for (id time in array(hourly[@"time"])) {
        times.push_back(number(time).value_or(std::numeric_limits<double>::quiet_NaN()));
    }
    if (const auto index = currentHourIndex(times, result.validAt)) {
        auto sample = [&](NSString* key) -> std::optional<double> {
            auto samples = array(hourly[key]);
            return *index < samples.count ? number(samples[*index]) : std::nullopt;
        };
        result.visibility = sample(@"visibility");
        result.snowDepth = sample(@"snow_depth");
    }
    if (result.fresh(now) && result.hasData()) return result;
    return std::nullopt;
}

struct Fixture {
    double instant;
    std::optional<Weather> weather;
};

std::optional<Fixture> fixtureNamed(NSString* name) {
    static NSDictionary<NSString*,NSString*>* dates = @{
        @"clear": @"2024-11-03T20:00:00Z", @"summer": @"2024-06-20T20:00:00Z",
        @"morning": @"2026-02-12T16:30:00Z", @"afternoon": @"2026-11-05T23:30:00Z",
        @"overcast": @"2024-03-20T19:00:00Z", @"fog": @"2024-03-20T19:00:00Z",
        @"rain": @"2024-03-20T19:00:00Z", @"snow": @"2024-12-21T20:00:00Z",
        @"snow-cover": @"2024-12-21T20:00:00Z", @"calm": @"2024-11-03T20:00:00Z",
        @"twilight": @"2024-06-20T03:32:00Z", @"night": @"2024-07-01T06:00:00Z",
        @"moon": @"2024-06-10T05:45:00Z", @"cloudy-night": @"2024-07-01T06:00:00Z",
        @"offline": @"2024-11-03T20:00:00Z", @"stale": @"2024-11-03T20:00:00Z"
    };
    if (!dates[name]) return std::nullopt;
    const double instant = [[[NSISO8601DateFormatter alloc] init] dateFromString:dates[name]].timeIntervalSince1970;
    if ([name isEqualToString:@"offline"]) return Fixture{instant, std::nullopt};
    Weather weather;
    weather.validAt = instant;
    weather.clouds = 8;
    weather.windFrom = 270;
    weather.windSpeed = 6;
    if ([name isEqualToString:@"calm"]) weather.windSpeed = 0;
    if ([name isEqualToString:@"afternoon"]) weather.windFrom = 0;
    if ([name isEqualToString:@"overcast"] || [name isEqualToString:@"cloudy-night"]) weather.clouds = 98;
    if ([name isEqualToString:@"fog"]) {
        weather.clouds = 65;
        weather.visibility = 130;
    }
    if ([name isEqualToString:@"rain"]) {
        weather.clouds = 92;
        weather.rain = 1.3;
        weather.windFrom = 320;
    }
    if ([name hasPrefix:@"snow"]) {
        weather.clouds = [name isEqualToString:@"snow"] ? 86 : 28;
        weather.snowDepth = 0.052;
        weather.snowfall = [name isEqualToString:@"snow"] ? 0.35 : 0;
        weather.windFrom = 40;
    }
    if ([name isEqualToString:@"stale"]) weather.validAt -= staleSeconds + 1;
    return Fixture{instant, weather};
}

NSString* windLabel(const Weather& weather) {
    const auto wind = weather.wind();
    if (!wind) return @"";
    if (wind->speed <= 0.25) return @"Calm  ·  ";
    NSArray<NSString*>* compass = @[@"N", @"NE", @"E", @"SE", @"S", @"SW", @"W", @"NW"];
    const int sector = static_cast<int>(std::lround(*weather.windFrom/45)) % 8;
    return [NSString stringWithFormat:@"From %@ · %.0f mph  ·  ", compass[sector], wind->speed*2.23694];
}

} // namespace

@interface SaverCaption : NSView
@property(nonatomic, copy) NSString* event;
@property(nonatomic, copy) NSString* weather;
@end

@implementation SaverCaption
- (NSView*)hitTest:(NSPoint)point { (void)point; return nil; }

- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    const auto size = self.bounds.size;
    const bool compact = size.width < 600 || size.height < 350;
    const CGFloat margin = compact ? 10 : std::clamp(size.height*0.053, 20.0, 55.0);
    const CGFloat titleSize = compact ? 17 : std::clamp(size.height*0.037, 23.0, 44.0);
    const CGFloat labelSize = compact ? 9 : std::clamp(size.height*0.015, 12.0, 18.0);
    auto titleFont = [NSFont fontWithName:@"Baskerville" size:titleSize] ?: [NSFont systemFontOfSize:titleSize];
    auto labelFont = [NSFont monospacedSystemFontOfSize:labelSize weight:NSFontWeightMedium];
    auto shadow = [[NSShadow alloc] init];
    shadow.shadowColor = [NSColor colorWithWhite:0 alpha:0.93];
    shadow.shadowBlurRadius = compact ? 3 : 5;
    shadow.shadowOffset = NSMakeSize(0, -1);
    auto text = [NSColor colorWithSRGBRed:0.98 green:0.96 blue:0.90 alpha:0.96];
    NSDictionary* title = @{NSFontAttributeName:titleFont, NSForegroundColorAttributeName:text,
                             NSShadowAttributeName:shadow};
    NSDictionary* label = @{NSFontAttributeName:labelFont, NSForegroundColorAttributeName:text,
                             NSShadowAttributeName:shadow};
    [@"Claremont" drawAtPoint:NSMakePoint(margin, size.height-margin-titleSize-1) withAttributes:title];
    if (size.height >= 230 && size.width >= 300) {
        [@"Larkin Memorial Sundial" drawAtPoint:NSMakePoint(margin, size.height-margin-titleSize-labelSize-4)
                                 withAttributes:label];
    }
    NSString* event = self.event ?: @"";
    NSString* weather = self.weather ?: @"";
    const auto eventWidth = [event sizeWithAttributes:label].width;
    const auto weatherWidth = [weather sizeWithAttributes:label].width;
    const bool stacked = eventWidth + weatherWidth + margin*3 > size.width;
    [event drawAtPoint:NSMakePoint(margin, margin + (stacked ? labelSize+4 : 0)) withAttributes:label];
    [weather drawAtPoint:NSMakePoint(std::max(margin, size.width-margin-weatherWidth), margin) withAttributes:label];
}
@end

@implementation WhenScapeSaverView {
    SCNView *_view;
    SundialScene *_scene;
    SaverCaption *_caption;
    NSURLSession *_session;
    NSURLSessionDataTask *_request;
    NSDateFormatter *_timeFormat;
    std::optional<Weather> _sample;
    std::optional<Fixture> _fixture;
    std::optional<double> _sunrise;
    double _nextScene, _nextFetch, _started;
    unsigned _failures, _generation;
    BOOL _running, _preview;
}

- (instancetype)initWithFrame:(NSRect)frame isPreview:(BOOL)preview {
    self = [super initWithFrame:frame isPreview:preview];
    if (!self) return nil;
    _preview = preview;
    self.animationTimeInterval = preview ? 1.0/12 : 1.0/24;
    _scene = [[SundialScene alloc] init];
    _view = [[SCNView alloc] initWithFrame:self.bounds options:@{SCNPreferredRenderingAPIKey:@(SCNRenderingAPIMetal)}];
    _view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _view.scene = _scene.scene;
    _view.pointOfView = _scene.camera;
    _view.backgroundColor = NSColor.blackColor;
    _view.antialiasingMode = preview ? SCNAntialiasingModeNone : SCNAntialiasingModeMultisampling2X;
    _view.rendersContinuously = NO;
    _view.playing = NO;
    [self addSubview:_view];
    _caption = [[SaverCaption alloc] initWithFrame:self.bounds];
    _caption.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_caption];
    _timeFormat = [[NSDateFormatter alloc] init];
    _timeFormat.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US"];
    _timeFormat.timeZone = [NSTimeZone timeZoneWithName:@"America/Los_Angeles"];
    _timeFormat.dateFormat = @"h:mm a z";
    return self;
}

- (BOOL)hasConfigureSheet { return NO; }
- (NSWindow*)configureSheet { return nil; }

- (BOOL)setPreviewFixture:(NSString *)name {
    auto fixture = fixtureNamed(name);
    if (!fixture) return NO;
    ++_generation;
    [_request cancel];
    _request = nil;
    _fixture = fixture;
    _sunrise.reset();
    _nextScene = 0;
    return YES;
}

- (void)startAnimation {
    [super startAnimation];
    if (_running) return;
    _running = YES;
    _started = NSProcessInfo.processInfo.systemUptime;
    _nextScene = 0;
    [self animateOneFrame];
}

- (void)stopAnimation {
    _running = NO;
    ++_generation;
    [_request cancel];
    _request = nil;
    [_session invalidateAndCancel];
    _session = nil;
    [_view setPlaying:NO];
    [super stopAnimation];
}

- (void)dealloc {
    [_request cancel];
    [_session invalidateAndCancel];
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    if (_running && !self.window) [self stopAnimation];
}

- (void)setFrameSize:(NSSize)size {
    [super setFrameSize:size];
    _nextScene = 0;
}

- (void)fetchWeather:(double)uptime {
    if (_fixture || _request || uptime < _nextFetch) return;
    if (!_session) {
        auto config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.timeoutIntervalForRequest = 8;
        config.timeoutIntervalForResource = 12;
        config.URLCache = nil;
        _session = [NSURLSession sessionWithConfiguration:config];
    }
    _nextFetch = uptime + 30;
    const unsigned generation = _generation;
    __weak WhenScapeSaverView* weakSelf = self;
    _request = [_session dataTaskWithURL:weatherURL() completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
        auto http = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse*)response : nil;
        const auto sample = !error && http.statusCode == 200
            ? decodeWeather(data, NSDate.date.timeIntervalSince1970) : std::nullopt;
        dispatch_async(dispatch_get_main_queue(), ^{
            WhenScapeSaverView* strongSelf = weakSelf;
            if (!strongSelf || !strongSelf->_running || strongSelf->_generation != generation) return;
            strongSelf->_request = nil;
            if (sample) {
                strongSelf->_failures = 0;
                strongSelf->_sample = sample;
                strongSelf->_nextScene = 0;
            } else {
                strongSelf->_failures = std::min(strongSelf->_failures + 1, 6u);
            }
            strongSelf->_nextFetch = NSProcessInfo.processInfo.systemUptime + retrySeconds(strongSelf->_failures);
        });
    }];
    [_request resume];
}

- (void)animateOneFrame {
    if (!_running || self.bounds.size.width < 1 || self.bounds.size.height < 1) return;
    const double uptime = NSProcessInfo.processInfo.systemUptime;
    const double now = _fixture ? _fixture->instant : NSDate.date.timeIntervalSince1970;
    [self fetchWeather:uptime];
    [SCNTransaction begin];
    [SCNTransaction setAnimationDuration:0];
    const BOOL refreshScene = uptime >= _nextScene;
    if (refreshScene) {
        const auto sample = _fixture ? _fixture->weather : _sample;
        const bool available = sample && sample->fresh(now);
        const auto weather = available ? *sample : Weather{};
        [_scene updateAt:now weather:weather size:self.bounds.size preview:_preview];
        if (_scene.isNight) {
            if (!_sunrise || *_sunrise < now) _sunrise = nextSunrise(now);
            _caption.event = _sunrise ? [@"Sunrise  " stringByAppendingString:
                [_timeFormat stringFromDate:[NSDate dateWithTimeIntervalSince1970:*_sunrise]]] : @"";
        } else if (_scene.hasReadableShadow) {
            _caption.event = _scene.readingEdge == ReadingEdge::earlier
                ? @"Read earlier edge  ·  PST" : @"Read later edge  ·  PST";
        } else {
            _caption.event = @"";
        }
        _caption.weather = available ? [windLabel(weather) stringByAppendingString:@"Open-Meteo"] : @"Weather unavailable";
        _caption.needsDisplay = YES;
        _nextScene = uptime + (weather.cloudiness() > 0.05 && !_preview ? 5 : 12);
    }
    const BOOL motionChanged = [_scene updateMotion:uptime - _started];
    [SCNTransaction commit];
    if (refreshScene || motionChanged) _view.needsDisplay = YES;
}
@end
