#import <ScreenSaver/ScreenSaver.h>

@interface WhenScapeSaverView : ScreenSaverView
// Used by the standalone preview and CI host. An unset fixture uses live data.
- (BOOL)setPreviewFixture:(NSString *)name;
@end
