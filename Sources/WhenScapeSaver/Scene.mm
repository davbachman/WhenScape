#include "Landscape.hpp"
#include "SceneMesh.hpp"

#include <array>
#include <cstdint>

using namespace sundial;

namespace {

constexpr Color stone{0.66, 0.62, 0.55};
constexpr Color inlay{0.21, 0.18, 0.13};
constexpr Color bronze{0.46, 0.36, 0.23};
constexpr Color blueGreen{0.15, 0.34, 0.31};
constexpr Vec flagBase{-2.0, 0, -0.77};
constexpr Vec flagTop = {flagBase.x, 2.82, flagBase.z};
constexpr int scaleSegments = 240;

double frac(double x) { return x - std::floor(x); }

SCNMaterial* polishedMetal(Color color) {
    auto metal = material(color);
    metal.lightingModelName = SCNLightingModelBlinn;
    metal.specular.contents = Color{0.41, 0.36, 0.28}.native();
    metal.shininess = 0.32;
    return metal;
}

SCNNode* attach(SCNNode* parent, SCNGeometry* shape, SCNMaterial* surface, Vec at) {
    shape.firstMaterial = surface;
    auto node = [SCNNode nodeWithGeometry:shape];
    node.position = sceneVector(at);
    [parent addChildNode:node];
    return node;
}

SCNNode* post(SCNNode* parent, Vec a, Vec b, double radius, SCNMaterial* mat) {
    const auto axis = b-a;
    auto shape = [SCNCylinder cylinderWithRadius:radius height:std::sqrt(axis.dot(axis))];
    shape.radialSegmentCount = 16;
    auto node = attach(parent, shape, mat, (a+b)*0.5);
    const auto dir = axis.normalized();
    const auto side = up.cross(dir);
    const double length = std::sqrt(side.dot(side));
    if (length > 1e-8) {
        const auto v = side * (1/length);
        node.rotation = SCNVector4Make(v.x, v.y, v.z, std::atan2(length, dir.y));
    }
    return node;
}

void basis(SCNNode* node, Vec x, Vec y, Vec z, Vec at) {
    SCNMatrix4 matrix = SCNMatrix4Identity;
    matrix.m11 = x.x; matrix.m12 = x.y; matrix.m13 = x.z;
    matrix.m21 = y.x; matrix.m22 = y.y; matrix.m23 = y.z;
    matrix.m31 = z.x; matrix.m32 = z.y; matrix.m33 = z.z;
    matrix.m41 = at.x; matrix.m42 = at.y; matrix.m43 = at.z;
    node.transform = matrix;
}

void aimLight(SCNNode* light, Vec direction) {
    const auto right = std::abs(direction.y) > 0.9999 ? east : up.cross(direction).normalized();
    basis(light, right, direction.cross(right), direction, center + direction*6);
}

void contactShadow(SCNNode* root, SCNMaterial* ink, Vec position, double width, double length) {
    auto plane = [SCNPlane planeWithWidth:width height:length];
    auto shadow = attach(root, plane, ink, position);
    shadow.eulerAngles = SCNVector3Make(-sundial::pi/2, 0, 0);
    shadow.castsShadow = NO;
    shadow.renderingOrder = 1;
}

void lettering(SCNNode* parent, NSString* text, double height, Vec at, Vec x, Vec vertical,
               SCNMaterial* ink, BOOL serif) {
    auto glyph = [SCNText textWithString:text extrusionDepth:0];
    glyph.font = serif ? ([NSFont fontWithName:@"Baskerville-SemiBold" size:1] ?: [NSFont systemFontOfSize:1])
                       : [NSFont systemFontOfSize:1 weight:NSFontWeightSemibold];
    glyph.flatness = 0.015;
    glyph.firstMaterial = ink;
    auto node = [SCNNode nodeWithGeometry:glyph];
    SCNVector3 min, max;
    if (![node getBoundingBoxMin:&min max:&max] || max.y <= min.y) return;
    const double size = height / (max.y - min.y);
    basis(node, x*size, vertical*size, x.cross(vertical)*size,
          at-x*(0.5*(max.x+min.x)*size)-vertical*(0.5*(max.y+min.y)*size));
    node.castsShadow = NO;
    [parent addChildNode:node];
}

Vec inward(double angle, double q) { return (center - scalePoint(angle, q)).normalized(); }

Mesh scaleSurface(double q1, double q2, double inset1, double inset2, bool outside = false) {
    Mesh mesh;
    const int rows = q2 - q1 > 0.03 ? 18 : 1;
    for (int i = 0; i <= scaleSegments; ++i) {
        const double a = startAngle + (endAngle-startAngle)*i/scaleSegments;
        for (int j = 0; j <= rows; ++j) {
            const double f = static_cast<double>(j)/rows;
            const double q = q1 + (q2-q1)*f;
            const auto n = q1 == q2 ? pole * (inset2 < inset1 ? 1 : -1)
                                   : inward(a, q) * (outside ? -1 : 1);
            const auto at = scalePoint(a, q, inset1 + (inset2-inset1)*f);
            mesh.texturedPoint(at, n, static_cast<double>(i)/scaleSegments, 1-f);
            if (i && j) {
                const uint32_t k = i*(rows+1)+j;
                if (outside) mesh.quad(k-rows-2,k-1,k,k-rows-1);
                else mesh.quad(k-rows-2,k-rows-1,k,k-1);
            }
        }
    }
    return mesh;
}

Mesh annulus(double inner, double outer, double height) {
    Mesh mesh;
    for (int i = 0; i <= 120; ++i) {
        const double a = 2*sundial::pi*i/120;
        const Vec direction{std::sin(a), 0, std::cos(a)};
        for (const double r : {inner, outer}) {
            const auto at = direction*r + up*height;
            mesh.texturedPoint(at, up, 0.5+at.x/4.1, 0.5+at.z/4.1);
        }
        if (i) mesh.quad(2*i-2, 2*i-1, 2*i+1, 2*i);
    }
    return mesh;
}

Mesh shadowMesh(const ShadowBand& shadow) {
    Mesh mesh;
    for (const auto& row : shadow.rows) {
        const double first = std::clamp(row.earlier, startAngle, endAngle);
        const double last = std::clamp(row.later, startAngle, endAngle);
        // Subdivide across the shadow so wide spans remain above the spherical face.
        constexpr uint32_t slices = 8;
        uint32_t i = static_cast<uint32_t>(mesh.vertices.size());
        for (uint32_t j = 0; j <= slices; ++j) {
            const double angle = first + (last-first)*j/slices;
            mesh.point(scalePoint(angle, row.axial, 0.004), inward(angle, row.axial));
            if (i && j) mesh.quad(i+j-slices-2, i+j-slices-1, i+j, i+j-1);
        }
    }
    return mesh;
}

void makeDial(SCNNode* root, const Dial& dial, SCNMaterial* rim, SCNMaterial* stoneMaterial,
              SCNMaterial* snowMaterial, SCNMaterial* metal, SCNMaterial* contact) {
    auto scale = material(stone);
    applyTexture(scale, surfaceTexture(Surface::terrazzo));
    scale.diffuse.wrapS = scale.diffuse.wrapT = SCNWrapModeClamp;
    meshNode(root, scaleSurface(-halfWidth, halfWidth, 0, 0), scale);
    meshNode(root, scaleSurface(-halfWidth, halfWidth, -0.12, -0.12, true), stoneMaterial);
    meshNode(root, scaleSurface(-halfWidth, -halfWidth, -0.12, 0), rim);
    meshNode(root, scaleSurface(halfWidth, halfWidth, 0, -0.12), rim);
    for (double a : {startAngle, endAngle}) {
        Mesh end;
        const auto n = (east*std::cos(a)-trough*std::sin(a)) * (a == startAngle ? -1 : 1);
        end.texturedPoint(scalePoint(a, -halfWidth), n, 0, 0);
        end.texturedPoint(scalePoint(a, halfWidth), n, 1, 0);
        end.texturedPoint(scalePoint(a, halfWidth, -0.12), n, 1, 1);
        end.texturedPoint(scalePoint(a, -halfWidth, -0.12), n, 0, 1);
        end.quad(0, 1, 2, 3);
        meshNode(root, end, rim);
    }
    const Vec southAnchor = center - pole*1.10, northAnchor = center + pole*1.40;
    post(root, southAnchor, northAnchor, 0.0035, metal).castsShadow = NO;
    for (int i : {-1, 1}) {
        const Vec at = i < 0 ? southAnchor : northAnchor;
        const double foot = at.z + i * -0.18;
        auto pedestal = [SCNBox boxWithWidth:i < 0 ? 0.34 : 0.48
                                      height:at.y length:i < 0 ? 0.28 : 0.40 chamferRadius:0.055];
        pedestal.materials = @[stoneMaterial, stoneMaterial, stoneMaterial, stoneMaterial, snowMaterial, stoneMaterial];
        auto pier = [SCNNode nodeWithGeometry:pedestal];
        pier.position = sceneVector({0, at.y*0.5 + 0.02, foot});
        [root addChildNode:pier];
        contactShadow(root, contact, {0, 0.034, foot}, i < 0 ? 0.77 : 1.01, i < 0 ? 0.68 : 0.87);
        post(root, at, at + Vec{0, -0.075, foot-at.z}, 0.054, metal);
    }
    auto block = [SCNBox boxWithWidth:0.34 height:0.45 length:0.38 chamferRadius:0.038];
    attach(root, block, stoneMaterial, {0, 0.25, -0.64});
    contactShadow(root, contact, {0, 0.034, -0.64}, 0.75, 0.79);

    Mesh spindle;
    constexpr uint32_t facets = 40;
    uint32_t i = 0;
    for (auto ring : dial.spindle()) {
        for (uint32_t j = 0; j <= facets; ++j) {
            const double a = 2*sundial::pi*j/facets;
            const auto radial = east*std::cos(a) + trough*std::sin(a);
            spindle.texturedPoint(center + pole*ring.axial + radial*ring.radius, radial,
                                  static_cast<double>(j)/facets, 0.5+ring.axial);
            if (i && j) spindle.quad(i+j-facets-2, i+j-facets-1, i+j, i+j-1);
        }
        i += facets+1;
    }
    auto spindleSurface = polishedMetal(bronze);
    applyTexture(spindleSurface, surfaceTexture(Surface::patina));
    meshNode(root, spindle, spindleSurface).castsShadow = NO;
}

void makeMonthGuide(SCNNode* root, SCNMaterial* ink) {
    // Engraved outline of the annual analemma, as on the original dial.
    const Vec plaque{0.92, 0.056, 1.14};
    auto plaqueFace = polishedMetal({0.68, 0.56, 0.36});
    attach(root, [SCNBox boxWithWidth:0.32 height:0.03 length:0.43 chamferRadius:0.009],
           plaqueFace, plaque - up*0.015);
    const Vec chart = plaque + up*0.002;
    const auto point = [&](double day) {
        constexpr double noonOnJanuaryFirst = 1704139200; // 2024-01-01 12:00 PST.
        const auto sun = skyAt(noonOnJanuaryFirst + 86400*day).sun;
        const double hour = std::atan2(-sun.dot(east), -sun.dot(trough));
        const double equation = markMinute(hour) - 720;
        const double declination = std::asin(sun.dot(pole));
        return chart + east*(equation * 0.0062) + north*(declination * 0.39);
    };
    Mesh groove;
    for (int day = 0; day <= 366; day += 3) {
        const auto at = point(day);
        const auto tangent = point(day+0.1) - point(day-0.1);
        const auto cross = tangent.cross(up).normalized()*0.0015;
        const uint32_t i = static_cast<uint32_t>(groove.vertices.size());
        groove.point(at-cross, up); groove.point(at+cross, up);
        if (i) groove.quad(i-2, i-1, i+1, i);
    }
    meshNode(root, groove, ink).castsShadow = NO;
    constexpr std::array<const char*, 12> initials = {"J","F","M","A","M","J","J","A","S","O","N","D"};
    constexpr std::array<int, 12> monthDays = {14, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349};
    for (size_t i = 0; i < initials.size(); ++i) {
        const auto at = point(monthDays[i]);
        lettering(root, @(initials[i]), 0.017, at + east*(i >= 2 && i <= 7 ? 0.021 : -0.021),
                  east, north, ink, NO);
    }
}

void makePad(SCNNode* root, SCNMaterial* top, SCNMaterial* engrave) {
    auto disk = [SCNCylinder cylinderWithRadius:2.03 height:0.07];
    disk.radialSegmentCount = 120;
    auto edge = material(stone);
    applyTexture(edge, surfaceTexture(Surface::paving), 4);
    attach(root, disk, edge, {0, -0.014, 0});
    auto bevel = [SCNCone coneWithTopRadius:2.004 bottomRadius:2.03 height:0.017];
    bevel.radialSegmentCount = 120;
    attach(root, bevel, edge, {0, 0.016, 0});
    meshNode(root, annulus(0, 2.003, 0.026), top);
    for (double r : {1.46, 1.93}) meshNode(root, annulus(r, r+0.008, 0.028), engrave).castsShadow = NO;
    Mesh marks;
    for (int i = 0; i < 72; ++i) {
        const double a = radians(i*5);
        const Vec along = east*std::sin(a) + north*std::cos(a);
        const Vec cross = east*std::cos(a) - north*std::sin(a);
        const Vec far = along*1.927 + up*0.029;
        const Vec near = along*(i%6 == 0 ? 1.81 : 1.87) + up*0.029;
        const auto d = cross*(i%6 == 0 ? 0.008 : 0.004);
        const uint32_t j = static_cast<uint32_t>(marks.vertices.size());
        marks.point(far-d, up); marks.point(far+d, up);
        marks.point(near+d, up); marks.point(near-d, up);
        marks.quad(j, j+1, j+2, j+3);
    }
    meshNode(root, marks, engrave).castsShadow = NO;
    NSArray<NSString*> *cardinals = @[@"N", @"E", @"S", @"W"];
    for (NSUInteger i = 0; i < cardinals.count; ++i) {
        const double a = i*sundial::pi/2;
        const Vec at = (east*std::sin(a) + north*std::cos(a))*1.63 + up*0.031;
        lettering(root, cardinals[i], 0.145, at, east, north, engrave, YES);
    }
}

} // namespace

@implementation SundialScene {
    SCNScene *_scene;
    Landscape *_landscape;
    SCNNode *_camera, *_key, *_ambient, *_skyFill, *_moonlight, *_flag, *_shadow, *_rain, *_snow;
    SCNMaterial *_ground, *_pad, *_stoneTop, *_rim, *_fabric, *_shadowInk, *_rainInk, *_snowInk;
    Dial _dial;
    Weather _weather;
    double _daylight, _rainfall, _flakes;
    int _coverStep;
    bool _night, _readable, _motionInitialized;
    BOOL _preview;
    ReadingEdge _readingEdge;
}

- (instancetype)init {
    self = [super init];
    if (!self) return nil;
    _scene = [SCNScene scene];
    SCNNode *root = _scene.rootNode;
    _camera = [SCNNode node];
    _camera.camera = [SCNCamera camera];
    _camera.camera.fieldOfView = frameFOV(16.0/9);
    _camera.camera.projectionDirection = SCNCameraProjectionDirectionVertical;
    _camera.camera.zNear = 0.1;
    _camera.camera.zFar = 115;
    basis(_camera, cameraRight, cameraUp, cameraForward*-1, cameraPosition);
    [root addChildNode:_camera];

    _key = [SCNNode node];
    _key.light = [SCNLight light];
    _key.light.type = SCNLightTypeDirectional;
    _key.light.shadowMode = SCNShadowModeForward;
    _key.light.shadowMapSize = CGSizeMake(1024, 1024);
    _key.light.shadowSampleCount = 8;
    _key.light.shadowBias = 0.025;
    _key.light.orthographicScale = 6;
    [root addChildNode:_key];
    _ambient = [SCNNode node];
    _ambient.light = [SCNLight light];
    _ambient.light.type = SCNLightTypeAmbient;
    [root addChildNode:_ambient];

    _skyFill = [SCNNode node];
    _skyFill.light = [SCNLight light];
    _skyFill.light.type = SCNLightTypeDirectional;
    aimLight(_skyFill, Vec{-0.32, 0.78, 0.50}.normalized());
    [root addChildNode:_skyFill];
    _moonlight = [SCNNode node];
    _moonlight.light = [SCNLight light];
    _moonlight.light.type = SCNLightTypeDirectional;
    _moonlight.light.color = Color{0.70, 0.79, 1.0}.native();
    [root addChildNode:_moonlight];

    _coverStep = -1;
    _ground = material(stone);
    _pad = material(stone);
    _stoneTop = material(stone);
    _rim = material(stone);
    auto stoneMaterial = material(stone);
    applyTexture(stoneMaterial, surfaceTexture(Surface::concrete));
    auto ink = material(inlay);
    auto metal = polishedMetal(bronze);
    auto contact = material({0.16, 0.15, 0.12}, YES);
    contact.diffuse.contents = contactShadowTexture();
    contact.writesToDepthBuffer = NO;
    contact.blendMode = SCNBlendModeAlpha;
    auto plane = attach(root, [SCNPlane planeWithWidth:220 height:220], _ground, up*groundHeight);
    plane.eulerAngles = SCNVector3Make(-sundial::pi/2, 0, 0);
    plane.castsShadow = NO;
    _landscape = [[Landscape alloc] initWithRoot:root];
    makePad(root, _pad, ink);
    makeMonthGuide(root, ink);
    makeDial(root, _dial, _rim, stoneMaterial, _stoneTop, metal, contact);
    contactShadow(root, contact, flagBase-up*0.040, 0.48, 0.48);

    post(root, flagBase, flagTop + up*0.045, 0.022, metal);
    attach(root, [SCNSphere sphereWithRadius:0.036], metal, flagTop + up*0.043);
    attach(root, [SCNCylinder cylinderWithRadius:0.116 height:0.15], stoneMaterial, flagBase+up*0.075);
    _flag = [SCNNode node];
    _fabric = material(blueGreen);
    [root addChildNode:_flag];

    _shadow = [SCNNode node];
    _shadow.castsShadow = NO;
    _shadow.renderingOrder = 2;
    [root addChildNode:_shadow];
    _shadowInk = material({0.014, 0.022, 0.031}, YES);
    _shadowInk.writesToDepthBuffer = NO;
    _shadowInk.blendMode = SCNBlendModeAlpha;

    _rain = [SCNNode node];
    _snow = [SCNNode node];
    _rain.castsShadow = _snow.castsShadow = NO;
    _rain.renderingOrder = _snow.renderingOrder = 4;
    [root addChildNode:_rain];
    [root addChildNode:_snow];
    _rainInk = material({0.67, 0.79, 0.88}, YES);
    _rainInk.transparent.contents = @0.44;
    _rainInk.transparency = 0.53;
    _rainInk.writesToDepthBuffer = NO;
    _snowInk = material({0.94, 0.96, 1}, YES);
    _snowInk.writesToDepthBuffer = NO;
    return self;
}

- (SCNScene *)scene { return _scene; }
- (SCNNode *)camera { return _camera; }
- (BOOL)isNight { return _night; }
- (BOOL)hasReadableShadow { return _readable; }
- (ReadingEdge)readingEdge { return _readingEdge; }

- (void)updateAt:(double)seconds weather:(const Weather&)weather size:(CGSize)size preview:(BOOL)preview {
    _weather = weather;
    _preview = preview;
    _motionInitialized = false;
    _rainfall = weather.rainfall();
    _flakes = weather.flakes();
    const auto sky = skyAt(seconds);
    const auto air = atmosphere(sky, weather);
    _daylight = air.daylight;
    _night = sky.sun.y < std::sin(radians(-0.833));
    const double sunlight = std::sqrt(unit(sky.sun.y*4)) * std::pow(1-air.cloud, 1.6) * (1-air.fog*0.8);
    _key.light.intensity = 1010*sunlight;
    _key.light.color = air.sunlight.native();
    _key.light.castsShadow = !preview && sunlight > 0.1;
    _key.light.shadowRadius = 2.1 + air.cloud*4.5;
    _key.light.shadowColor = [NSColor colorWithSRGBRed:0.10 green:0.12 blue:0.16 alpha:0.52 * sunlight];
    aimLight(_key, sky.sun);
    _ambient.light.intensity = 296 + air.daylight*(251 + 125*air.cloud) + air.twilight*94;
    _ambient.light.color = Color{0.50, 0.61, 0.83}.mix({0.91, 0.94, 0.99}, air.daylight).native();
    _skyFill.light.intensity = (140 + air.daylight*102)*(1-air.fog*0.34);
    _skyFill.light.color = Color{0.51, 0.63, 0.86}.mix({0.78, 0.85, 0.97}, air.daylight).native();
    const double lunarElevation = std::sqrt(unit(sky.moon.y*3.5));
    _moonlight.light.intensity = 245 * lunarElevation * sky.moonFraction * (1-air.daylight) *
        std::pow(1-air.cloud, 1.5) * (1-air.fog);
    if (sky.moon.y > 0) aimLight(_moonlight, sky.moon);

    const auto band = _dial.shadow(sky.sun, seconds);
    _readable = false;
    _shadow.hidden = !band || sunlight < 0.035;
    if (!_shadow.hidden) {
        _shadowInk.transparency = std::min(0.78, sunlight*0.88);
        _shadow.geometry = shadowMesh(*band).geometry(_shadowInk);
        _readingEdge = band->readingEdge;
        const auto row = band->rows[24];
        const double a = _readingEdge == ReadingEdge::earlier ? row.earlier : row.later;
        _readable = a >= startAngle && a <= endAngle &&
            inward(a, 0).dot(cameraPosition - scalePoint(a, 0)) > 0.05;
    }

    const int coverStep = std::lround(weather.cover()*12);
    if (_coverStep != coverStep) {
        _coverStep = coverStep;
        const double cover = coverStep/12.0;
        applyTexture(_ground, surfaceTexture(Surface::earth, cover*0.92), 34);
        applyTexture(_pad, surfaceTexture(Surface::paving, cover*0.83));
        applyTexture(_stoneTop, surfaceTexture(Surface::concrete, cover));
        applyTexture(_rim, surfaceTexture(Surface::concrete, cover*0.62), 3);
        [_landscape updateSnowCover:cover];
    }
    _scene.fogColor = air.horizon.native();
    _scene.fogStartDistance = (1-air.fog)*7.8 + 0.8;
    _scene.fogEndDistance = 91*std::pow(1-air.fog, 2.6) + 7;
    _scene.fogDensityExponent = 1.45;
    [_landscape updateFog:air.fog];

    if (size.width > 0 && size.height > 0) {
        const auto aspect = size.width/size.height;
        _camera.camera.fieldOfView = frameFOV(aspect);
        const auto h = preview ? 200.0 : 414.0;
        const auto w = std::clamp(h*aspect, 80.0, 1440.0);
        auto bitmap = skyImage(sky, air, seconds, CGSizeMake(w, h), aspect);
        _scene.background.contents = (__bridge id)bitmap.CGImage;
    }
}

- (BOOL)updateMotion:(double)t {
    const auto wind = _weather.wind();
    const double speed = wind ? wind->speed : 0;
    const double extension = unit((speed - 0.25)/8.0);
    if (_motionInitialized && extension == 0 && _rainfall == 0 && _flakes == 0) return NO;
    _motionInitialized = true;
    Vec direction = speed > 0.25 ? wind->downwind : east;
    [_landscape updateGrassAt:t windSpeed:speed downwind:direction preview:_preview];
    const auto across = direction.cross(up);
    Mesh flag;
    constexpr int columns = 24, rows = 6;
    std::array<Vec, (columns+1)*(rows+1)> cloth;
    const auto index = [=](int i, int j) { return j*(columns+1)+i; };
    for (int j = 0; j <= rows; ++j) {
        double v = static_cast<double>(j)/rows;
        for (int i = 0; i <= columns; ++i) {
            const double u = static_cast<double>(i)/columns;
            const double wave = std::sin(9*u - t*(3.0+speed*0.32) + 2*v);
            const double stream = 0.79*u*(0.035+0.965*extension);
            const double drop = 0.24*v + (1-extension)*u*(0.62-0.18*v);
            const auto at = flagTop + direction*(stream + 0.021) - up*(drop + 0.09)
                + across*(0.12*extension*wave*u + 0.054*(1-extension)*std::sin(8*(u+v))*u)
                + up*(wave*u*extension*0.045)-(across*0.024*v*(1-extension));
            cloth[index(i,j)] = at;
        }
    }
    for (int j = 0; j <= rows; ++j) {
        for (int i = 0; i <= columns; ++i) {
            const auto alongCloth = cloth[index(std::min(i+1,columns),j)] - cloth[index(std::max(i-1,0),j)];
            const auto downCloth = cloth[index(i,std::min(j+1,rows))] - cloth[index(i,std::max(j-1,0))];
            const uint32_t k = index(i,j);
            flag.point(cloth[k], downCloth.cross(alongCloth).normalized());
            if (i && j) flag.quad(k-columns-2, k-columns-1, k, k-1);
        }
    }
    _flag.geometry = flag.geometry(_fabric);
    _flag.castsShadow = NO;

    const double rainSpeed = 6.4, snowSpeed = 0.68;
    for (bool flakes : {false, true}) {
        const auto node = flakes ? _snow : _rain;
        double intensity = flakes ? _flakes : _rainfall;
        if (intensity <= 0) {
            node.hidden = YES;
            continue;
        }
        node.hidden = NO;
        const int count = static_cast<int>((_preview ? 100 : 320) * intensity) + 4;
        const double falling = flakes ? snowSpeed : rainSpeed;
        const auto drift = direction * (std::min(speed, 14.0)*(flakes ? 0.25 : 0.16));
        Mesh precipitation;
        for (int i = 0; i < count; ++i) {
            const double n = i+0.75;
            const double age = frac(n*0.585786 + t*falling/5.4);
            const double x = 15*(frac(n*0.618034 + t*drift.x/15)-0.5);
            const double z = 15*(frac(n*0.414214 + t*drift.z/15)-0.62);
            const Vec at{x + (flakes ? 0.22*std::sin(n+t*1.8) : 0), 5.4*(1-age), z};
            if (flakes) {
                const double radius = 0.008 + 0.012*frac(n*0.7264);
                const auto x = cameraRight*radius, y = cameraUp*radius;
                const uint32_t j = static_cast<uint32_t>(precipitation.vertices.size());
                precipitation.point(at+y, cameraForward); precipitation.point(at+x, cameraForward);
                precipitation.point(at-y, cameraForward); precipitation.point(at-x, cameraForward);
                precipitation.quad(j,j+1,j+2,j+3);
            } else {
                const uint32_t j = static_cast<uint32_t>(precipitation.vertices.size());
                precipitation.point(at, cameraForward);
                precipitation.point(at+(up*falling-drift)*(0.012+0.011*frac(n*0.77)), cameraForward);
                precipitation.indices.insert(precipitation.indices.end(), {j,j+1});
            }
        }
        auto ink = flakes ? _snowInk : _rainInk;
        ink.transparency = flakes ? 0.53+0.32*_daylight : 0.28+0.30*_daylight;
        node.geometry = precipitation.geometry(ink, !flakes);
    }
    return YES;
}
@end
