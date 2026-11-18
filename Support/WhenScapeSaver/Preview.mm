#import <AppKit/AppKit.h>

#import "WhenScapeSaverView.h"

namespace {
WhenScapeSaverView* loadSaver(NSString* path, NSRect frame, BOOL preview) {
    auto bundle = [NSBundle bundleWithPath:path];
    NSError* error = nil;
    if (![bundle loadAndReturnError:&error]) {
        NSLog(@"Cannot load %@ (%@)", path, error);
        return nil;
    }
    Class entry = bundle.principalClass;
    if (![entry isSubclassOfClass:ScreenSaverView.class]) {
        NSLog(@"The principal class must inherit ScreenSaverView");
        return nil;
    }
    return [[entry alloc] initWithFrame:frame isPreview:preview];
}
}

int main(int argc, const char* argv[]) {
    @autoreleasepool {
        NSString* fixture = nil;
        BOOL smoke = NO, preview = NO;
        for (int i = 1; i < argc; ++i) {
            NSString* option = @(argv[i]);
            if ([option isEqualToString:@"--fixture"] && i+1 < argc) fixture = @(argv[++i]);
            else if ([option isEqualToString:@"--system-size"]) preview = YES;
            else if ([option isEqualToString:@"--smoke"]) smoke = YES;
            else {
                NSLog(@"Usage: WhenScapePreview [--fixture name] [--system-size] [--smoke]");
                return 2;
            }
        }
        [NSApplication sharedApplication];
        NSString* executable = [NSFileManager.defaultManager stringWithFileSystemRepresentation:argv[0]
                                                                                        length:strlen(argv[0])];
        NSString* path = [executable.stringByStandardizingPath.stringByDeletingLastPathComponent
            stringByAppendingPathComponent:@"WhenScape.saver"];
        if (![path isAbsolutePath]) path = [NSFileManager.defaultManager.currentDirectoryPath
            stringByAppendingPathComponent:path];
        NSRect frame = NSMakeRect(0, 0, preview ? 430 : 1152, preview ? 242 : 648);
        auto view = loadSaver(path, frame, preview);
        if (!view) return 1;
        if (smoke) {
            // Load the real bundle, exercise both lifecycle callbacks repeatedly,
            // and advance deterministic scene states without contacting the network.
            for (NSString* state in @[@"clear", @"summer", @"morning", @"afternoon", @"overcast", @"fog",
                 @"rain", @"snow", @"snow-cover", @"calm", @"twilight", @"night", @"moon",
                 @"cloudy-night", @"offline", @"stale"]) {
                @autoreleasepool {
                    if (![view setPreviewFixture:state]) return 1;
                    [view startAnimation];
                    if (!view.isAnimating) return 1;
                    [view animateOneFrame];
                    [view stopAnimation];
                    if (view.isAnimating) return 1;
                }
            }
            NSLog(@"Loaded the saver and exercised 16 fixed scene fixtures");
            return 0;
        }
        if (fixture && ![view setPreviewFixture:fixture]) {
            NSLog(@"Unknown fixture %@", fixture);
            return 2;
        }
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        auto window = [[NSWindow alloc] initWithContentRect:frame
            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable
            backing:NSBackingStoreBuffered defer:NO];
        window.title = @"WhenScape Preview";
        window.releasedWhenClosed = NO;
        window.contentView = view;
        [window center];
        auto observer = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
            object:window queue:nil usingBlock:^(NSNotification* note) {
                (void)note;
                [view stopAnimation];
                [NSApp terminate:nil];
            }];
        id wakeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidDeminiaturizeNotification
            object:window queue:nil usingBlock:^(NSNotification* note) { (void)note; [view startAnimation]; }];
        id hideObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidMiniaturizeNotification
            object:window queue:nil usingBlock:^(NSNotification* note) { (void)note; [view stopAnimation]; }];
        [window makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        [view startAnimation];
        [NSApp run];
        for (id token in @[observer, wakeObserver, hideObserver]) {
            [NSNotificationCenter.defaultCenter removeObserver:token];
        }
        [view stopAnimation];
    }
    return 0;
}
