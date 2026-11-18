#pragma once

#include "Scene.hpp"

@interface Landscape : NSObject
- (instancetype)initWithRoot:(SCNNode*)root;
- (void)updateSnowCover:(double)cover;
- (void)updateGrassAt:(double)elapsed windSpeed:(double)speed downwind:(sundial::Vec)downwind preview:(BOOL)preview;
@end
