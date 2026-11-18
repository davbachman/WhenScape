#include "Landscape.hpp"
#include "SceneMesh.hpp"

#include <array>

using namespace sundial;

namespace {

const Vec terrainForward = Vec{cameraForward.x, 0, cameraForward.z}.normalized();
constexpr Color straw{0.61, 0.53, 0.35};
constexpr Color grassShade{0.48, 0.44, 0.28};
constexpr Color sage{0.32, 0.39, 0.29};
constexpr Color sageTip{0.46, 0.49, 0.35};

Vec meadowPoint(double side, double distance) {
    return cameraRight*side + terrainForward*distance + up*groundHeight;
}

double randomFraction(uint32_t value) {
    value = (value ^ (value >> 16))*0x7feb352du;
    value = (value ^ (value >> 15))*0x846ca68bu;
    return (value ^ (value >> 16))/4294967296.0;
}

Mesh ridge(bool distant) {
    // The authored skyline rises toward the right, leaving a low opening in
    // the west where the fixed night view can catch the setting Moon.
    constexpr std::array<double, 15> farHeights{
        0.35, 0.49, 0.62, 0.92, 1.49, 2.22, 3.10, 3.79, 3.28, 5.45, 4.72, 5.73, 3.79, 3.15, 2.28
    };
    constexpr std::array<double, 15> nearHeights{
        0.16, 0.25, 0.26, 0.44, 0.63, 0.92, 1.32, 1.64, 1.12, 2.16, 3.42, 2.63, 2.83, 1.95, 1.54
    };
    const auto& heights = distant ? farHeights : nearHeights;
    auto position = [&](double bearing, double slope) {
        const double sample = (heights.size()-1)*unit((bearing+70)/140);
        const auto i = std::min(static_cast<size_t>(sample), heights.size()-2);
        const double t = sample-i;
        const double turn = radians(bearing);
        const auto direction = terrainForward*std::cos(turn) + cameraRight*std::sin(turn);
        const double outline = heights[i]*(1-t) + heights[i+1]*t;
        const double relief = (0.14*std::sin(turn*32)+0.075*std::sin(turn*67)) * unit((bearing+48)/40);
        const double crestDistance = (distant ? 83 : 52) + 3.5*std::sin(turn*5+0.8) + 1.7*std::cos(turn*14);
        const double run = (distant ? 18 : 13) + 2.7*std::sin(turn*17) + 1.5*std::sin(turn*37);
        const double distance = crestDistance - run*(1-slope);
        const double crest = cameraPosition.y + crestDistance*std::tan(radians(outline+relief));
        const double fold = std::sin(slope*sundial::pi) * (0.37*std::sin(turn*23) + 0.21*std::sin(turn*49));
        const double height = groundHeight + (crest-groundHeight)*std::pow(slope, 1.46) + fold;
        return Vec{cameraPosition.x, height, cameraPosition.z} + direction*distance;
    };

    constexpr uint32_t columns = 208, rows = 9;
    Mesh mesh;
    for (uint32_t i = 0; i <= columns; ++i) {
        const double bearing = -70.0 + 140.0*i/columns;
        for (uint32_t j = 0; j <= rows; ++j) {
            const double s = static_cast<double>(j)/rows;
            const auto along = position(bearing+0.09,s) - position(bearing-0.09,s);
            const auto across = position(bearing,unit(s+0.015)) - position(bearing,unit(s-0.015));
            mesh.texturedPoint(position(bearing,s), along.cross(across).normalized(),
                               static_cast<double>(i)/columns, s);
            const uint32_t k = i*(rows+1) + j;
            if (i && j) mesh.quad(k-rows-2,k-1,k,k-rows-1);
        }
    }
    return mesh;
}

constexpr double pathLength = 28;

Vec pathCenter(double distance) {
    const double side = 1.68 + 2.86*(1-std::exp(-distance/3.4)) + 0.72*std::sin(distance*0.28)
        - 0.23*distance/pathLength;
    return meadowPoint(side, 0.28+distance) + up*0.006;
}

Mesh gravelPath() {
    Mesh mesh;
    constexpr uint32_t sections = 126, across = 6;
    for (uint32_t i = 0; i <= sections; ++i) {
        const double distance = pathLength*i/sections;
        const auto point = pathCenter(distance);
        const auto tangent = (pathCenter(distance+0.025) - pathCenter(distance-0.025)).normalized();
        const auto side = tangent.cross(up);
        const double width = (0.58 + 0.033*std::sin(distance*1.52) + 0.017*std::sin(distance*3.1)) *
            unit((pathLength-distance+0.10)/3.2);
        for (uint32_t j = 0; j <= across; ++j) {
            const double u = static_cast<double>(j)/across;
            mesh.texturedPoint(point + side*(width*(2*u-1)), up, u, distance/pathLength);
            const uint32_t k = i*(across+1)+j;
            if (i && j) mesh.quad(k-across-2,k-across-1,k,k-1);
        }
    }
    return mesh;
}

struct Patch { double side, depth, spread, height; int count; };

constexpr std::array<Patch, 21> grassPatches{{
    {-2.77, 0.11, 0.47, 0.26, 24}, {-3.38, 0.69, 0.34, 0.25, 20}, {-4.24, 2.89, 0.52, 0.29, 24},
    {-2.43, 3.96, 0.41, 0.28, 20}, {-1.28, 4.91, 0.58, 0.18, 23}, {-6.15, 6.71, 0.76, 0.31, 30},
    {-4.41, 8.84, 0.68, 0.30, 27}, {-2.81,10.63, 0.54, 0.34, 27}, {0.14, 8.25, 0.65, 0.23, 20},
    {2.03, 2.51, 0.45, 0.24, 19}, {3.33, 0.21, 0.41, 0.27, 21}, {4.22, 0.95, 0.40, 0.32, 18},
    {5.91, 3.65, 0.54, 0.32, 22}, {5.88, 5.91, 0.54, 0.24, 23}, {3.20, 6.69, 0.48, 0.30, 22},
    {6.54, 8.72, 0.50, 0.33, 21}, {2.61,12.16, 0.58, 0.27, 25}, {6.82,13.38, 0.88, 0.37, 30},
    {-8.22,17.21, 1.10, 0.37, 36}, {0.10,16.34, 0.88, 0.33, 27}, {8.81,19.66, 1.20, 0.39, 34},
}};

constexpr std::array<Patch, 10> scrubPatches{{
    {-3.66, 2.56, 0.48, 0.32, 23}, {-3.03, 4.96, 0.42, 0.25, 20}, {-3.93, 8.27, 0.52, 0.34, 24},
    {-7.15, 9.60, 0.85, 0.41, 32}, {-0.66,10.37, 0.52, 0.35, 23}, {2.05, 5.31, 0.43, 0.31, 20},
    {5.18, 1.78, 0.66, 0.39, 28}, {6.33, 7.63, 0.60, 0.34, 26}, {2.28,15.98, 0.81, 0.35, 30},
    {6.97,19.84, 0.78, 0.45, 32},
}};

struct Blade { Vec root, spread, width; double height, phase; };

std::vector<Blade> grassBlades() {
    std::vector<Blade> blades;
    uint32_t seed = 866;
    auto next = [&] { return randomFraction(++seed); };
    for (const auto& patch : grassPatches) {
        for (int i = 0; i < patch.count; ++i) {
            const double angle = 2*sundial::pi*next(), distance = std::pow(next(),0.69)*patch.spread;
            const auto radial = cameraRight*std::cos(angle) + terrainForward*std::sin(angle);
            const auto root = meadowPoint(patch.side,patch.depth) + radial*distance;
            const double height = patch.height*(0.45+0.73*next());
            const double cut = angle + (next()-0.5)*1.9;
            const auto width = (cameraRight*std::cos(cut)+terrainForward*std::sin(cut))*(0.005+height*0.042);
            blades.push_back({root,radial*(height*(0.19+next()*0.53)),width,height,7*next()+patch.side});
        }
    }
    return blades;
}

void addBlade(Mesh& mesh, const Blade& blade, Vec wind, double elapsed, double strength) {
    const double wave = 0.8 + 0.2*std::sin(elapsed*2.6 + blade.phase) +
        0.14*std::sin(elapsed*4.4 + blade.phase*1.4);
    const auto deflection = wind*(blade.height*strength*wave);
    const auto middle = blade.root + up*(blade.height*0.61) + blade.spread*0.34 + deflection*0.33;
    const auto tip = blade.root + up*(blade.height*(1-strength*0.14)) + blade.spread + deflection;
    const auto normal = blade.width.cross(tip-blade.root).normalized();
    const uint32_t i = static_cast<uint32_t>(mesh.vertices.size());
    mesh.point(blade.root-blade.width,normal);
    mesh.point(blade.root+blade.width,normal);
    mesh.point(middle+blade.width*0.6,normal);
    mesh.point(middle-blade.width*0.6,normal);
    mesh.point(tip,normal);
    mesh.quad(i,i+1,i+2,i+3);
    mesh.indices.insert(mesh.indices.end(),{i+3,i+2,i+4});
}

void addLeaf(Mesh& mesh, Vec at, Vec axis, Vec width) {
    const auto normal = width.cross(axis).normalized();
    const uint32_t i = static_cast<uint32_t>(mesh.vertices.size());
    mesh.point(at-axis,normal);
    mesh.point(at+width,normal);
    mesh.point(at+axis,normal);
    mesh.point(at-width,normal);
    mesh.quad(i,i+1,i+2,i+3);
}

void makeScrub(SCNNode* root, SCNMaterial* green, SCNMaterial* tips) {
    std::array<Mesh,2> leaves;
    uint32_t seed = 7312;
    auto next = [&] { return randomFraction(++seed); };
    for (const auto& patch : scrubPatches) {
        const auto center = meadowPoint(patch.side,patch.depth);
        for (int i = 0; i < patch.count; ++i) {
            const double angle = next()*2*sundial::pi;
            const auto outward = cameraRight*std::cos(angle) + terrainForward*std::sin(angle);
            const auto tangent = up.cross(outward);
            const double reach = (0.25+0.72*next())*patch.spread;
            const auto branch = outward*reach + up*(patch.height*(1-reach/patch.spread*0.57));
            addLeaf(leaves[0],center+branch*0.51,branch*0.53,tangent*0.008);
            for (int j = 1; j <= 4; ++j) {
                const double side = j%2 == 0 ? 1 : -1;
                const auto at = center + branch*(0.23+0.17*j) + tangent*(side*reach*0.13);
                const auto leafAngle = (outward*0.52 + tangent*(side*0.59) + up*0.34).normalized();
                const double size = 0.031 + 0.026*next();
                addLeaf(leaves[j == 4 ? 1 : 0],at,leafAngle*size,
                        leafAngle.cross(up).normalized()*(size*0.39));
            }
        }
    }
    meshNode(root,leaves[0],green).castsShadow = NO;
    meshNode(root,leaves[1],tips).castsShadow = NO;
}

} // namespace

@implementation Landscape {
    SCNMaterial *_gravel, *_nearRidge, *_farRidge, *_dryGrass, *_shadedGrass, *_scrub, *_scrubTip;
    SCNNode *_nearHills, *_farHills, *_dryStems, *_shadedStems;
    std::vector<Blade> _blades;
    double _lastGrassUpdate;
    bool _grassInitialized, _wasWindy;
}

- (instancetype)initWithRoot:(SCNNode*)root {
    self = [super init];
    if (!self) return nil;
    _nearRidge = material({0.35, 0.40, 0.38});
    _farRidge = material({0.39, 0.45, 0.48});
    _nearRidge.multiply.contents = Color{0.90,0.95,1}.native();
    _nearHills = meshNode(root,ridge(false),_nearRidge);
    _farHills = meshNode(root,ridge(true),_farRidge);
    _nearHills.castsShadow = _farHills.castsShadow = NO;

    _gravel = material({0.65, 0.59, 0.47});
    _gravel.blendMode = SCNBlendModeAlpha;
    _gravel.writesToDepthBuffer = NO;
    meshNode(root,gravelPath(),_gravel).castsShadow = NO;

    _scrub = material(sage);
    _scrubTip = material(sageTip);
    makeScrub(root,_scrub,_scrubTip);
    _dryGrass = material(straw);
    _shadedGrass = material(grassShade);
    _dryStems = [SCNNode node];
    _shadedStems = [SCNNode node];
    _dryStems.castsShadow = _shadedStems.castsShadow = NO;
    [root addChildNode:_dryStems];
    [root addChildNode:_shadedStems];
    _blades = grassBlades();
    return self;
}

- (void)updateSnowCover:(double)cover {
    const Color frost{0.86, 0.90, 0.93};
    applyTexture(_gravel,surfaceTexture(Surface::gravel,cover*0.83));
    _gravel.diffuse.wrapS = _gravel.diffuse.wrapT = SCNWrapModeClamp;
    applyTexture(_nearRidge,surfaceTexture(Surface::earth,cover*0.82));
    _nearRidge.diffuse.contentsTransform = SCNMatrix4MakeScale(6,1.5,1);
    _farRidge.diffuse.contents = Color{0.39,0.45,0.48}.mix(frost,cover*0.60).native();
    _dryGrass.diffuse.contents = straw.mix(frost,cover*0.62).native();
    _shadedGrass.diffuse.contents = grassShade.mix(frost,cover*0.29).native();
    _scrub.diffuse.contents = sage.mix(frost,cover*0.24).native();
    _scrubTip.diffuse.contents = sageTip.mix(frost,cover*0.73).native();
}

- (void)updateFog:(double)fog {
    // Fog density already softens the geometry with distance. Fade the
    // skyline itself as visibility becomes too low to make out the ridges.
    const double near = unit((0.88-fog)/0.52), far = unit((0.71-fog)/0.53);
    _nearHills.opacity = near*near*(3-2*near);
    _farHills.opacity = far*far*(3-2*far);
}

- (void)updateGrassAt:(double)elapsed windSpeed:(double)speed downwind:(Vec)downwind preview:(BOOL)preview {
    const bool windy = speed > 0.25;
    if (_grassInitialized && windy == _wasWindy) {
        const double interval = preview ? 1.0/7 : 1.0/11;
        if (!windy || (elapsed >= _lastGrassUpdate && elapsed-_lastGrassUpdate < interval)) return;
    }
    const double strength = unit((speed-0.25)/9)*0.68;
    std::array<Mesh,2> blades;
    for (size_t i = 0; i < _blades.size(); ++i) {
        addBlade(blades[i%3 == 0 ? 1 : 0],_blades[i],downwind,elapsed,strength);
    }
    _dryStems.geometry = blades[0].geometry(_dryGrass);
    _shadedStems.geometry = blades[1].geometry(_shadedGrass);
    _wasWindy = windy;
    _grassInitialized = true;
    _lastGrassUpdate = elapsed;
}

@end
