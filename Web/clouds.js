// The sky and its clouds are painted behind the terrain/building silhouette.
// A post-process stage can use Cesium's scene depth to distinguish sky pixels
// from geometry; a canvas painted over the viewport cannot make that distinction.
// The colours are composed for appearance from the Sun's real direction; they
// are not a physical scattering model, and cloud shapes are not forecast positions.
const cloudFragmentShader = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float cloudCover;
uniform float haze;
uniform vec2 cloudOffset;
in vec2 v_textureCoordinates;

float skyHash(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

float skyNoise(vec2 position) {
    vec2 cell = floor(position);
    vec2 part = fract(position);
    part = part * part * (3.0 - 2.0 * part);
    return mix(mix(skyHash(cell), skyHash(cell + vec2(1.0, 0.0)), part.x),
        mix(skyHash(cell + vec2(0.0, 1.0)), skyHash(cell + vec2(1.0, 1.0)), part.x), part.y);
}

float skyLayers(vec2 position) {
    float total = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 5; ++i) {
        total += weight * skyNoise(position);
        position = position * 2.03 + vec2(17.0, 9.0);
        weight *= 0.5;
    }
    return total;
}

void main() {
    vec4 sceneColor = texture(colorTexture, v_textureCoordinates);

    // Cesium clears its depth attachment to 1.0. Compare the raw depth, so
    // logarithmic depth and far-away geometry cannot be mistaken for empty sky
    // by an arbitrary distance threshold. Preserve all geometry pixels exactly.
    if (texture(depthTexture, v_textureCoordinates).r < 1.0) {
        out_FragColor = sceneColor;
        return;
    }

    // Reconstruct a viewing ray from the actual projection and view matrices.
    // This follows camera pitch, heading, field of view and viewport aspect,
    // without inventing a horizontal cut at a particular screen coordinate.
    vec4 rayPointEC = czm_inverseProjection *
        vec4(v_textureCoordinates * 2.0 - 1.0, -1.0, 1.0);
    vec3 rayWC = normalize(czm_inverseViewRotation * (rayPointEC.xyz / rayPointEC.w));
    vec3 observerUp = normalize(czm_viewerPositionWC *
        czm_ellipsoidInverseRadii * czm_ellipsoidInverseRadii);

    // Express the ray and the Sun as east, north, up at the observer.
    vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), observerUp));
    vec3 north = cross(observerUp, east);
    vec3 ray = vec3(dot(rayWC, east), dot(rayWC, north), dot(rayWC, observerUp));
    vec3 sun = vec3(dot(czm_sunDirectionWC, east), dot(czm_sunDirectionWC, north),
        dot(czm_sunDirectionWC, observerUp));

    float coverage = clamp(cloudCover, 0.0, 1.0);
    float sunHeight = sun.z;
    float day = smoothstep(-0.10, 0.12, sunHeight);
    float night = 1.0 - smoothstep(-0.30, -0.08, sunHeight);
    float twilight = smoothstep(-0.28, -0.03, sunHeight) * (1.0 - smoothstep(0.02, 0.32, sunHeight));
    float height = clamp(ray.z, 0.0, 1.0);
    float sunward = 0.5 + 0.5 * dot(normalize(ray.xy + 1e-5), normalize(sun.xy + 1e-5));
    float towardSun = max(dot(ray, sun), 0.0);

    // Clear sky: deep overhead, pale at the horizon by day; at dusk a warm
    // band toward the Sun and a pink band over a blue-grey shadow opposite it.
    vec3 warm = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.74, 0.44), smoothstep(-0.05, 0.2, sunHeight));
    vec3 zenith = mix(vec3(0.012, 0.018, 0.04), vec3(0.16, 0.38, 0.78), day);
    zenith = mix(zenith, vec3(0.11, 0.16, 0.36), twilight * 0.75);
    vec3 horizon = mix(vec3(0.03, 0.045, 0.08), vec3(0.66, 0.80, 0.93), day);
    horizon = mix(horizon, mix(vec3(0.62, 0.47, 0.58), warm, pow(sunward, 1.5)), twilight);
    vec3 sky = mix(zenith, horizon, pow(1.0 - height, 3.0));
    sky += twilight * pow(sunward, 3.0) * vec3(0.35, 0.22, 0.05) * exp(-height * 6.0);
    sky = mix(sky, vec3(0.20, 0.24, 0.38) * (0.4 + 0.6 * day),
        twilight * (1.0 - sunward) * (1.0 - smoothstep(0.0, 0.06, height)) * 0.6);

    // Overcast greys the whole sky; haze and fog wash it toward the horizon colour.
    vec3 grey = mix(vec3(0.045, 0.055, 0.075), vec3(0.60, 0.64, 0.69), day) * (0.85 + 0.25 * pow(1.0 - height, 2.0));
    float overcast = smoothstep(0.55, 1.0, coverage);
    sky = mix(sky, grey, overcast * 0.85);
    vec3 hazeColor = mix(horizon, grey, 0.5 + 0.5 * overcast);
    sky = mix(sky, hazeColor, clamp(haze, 0.0, 1.0) * (0.35 + 0.65 * pow(1.0 - height, 2.0)));

    // The Sun: a wide glow, a tight glow and the disc, dimmed by cloud and haze.
    float clearSun = (1.0 - overcast) * (1.0 - 0.8 * clamp(haze, 0.0, 1.0));
    sky += warm * (pow(towardSun, 8.0) * mix(0.10, 0.30, twilight) + pow(towardSun, 96.0) * 0.45) * (day * 0.6 + twilight) * clearSun;
    float disc = smoothstep(0.99990, 0.99996, towardSun) * step(-0.02, sunHeight) * clearSun;

    // Stars and the Moon come from Cesium's own night sky.
    sky += sceneColor.rgb * night * (1.0 - 0.9 * overcast) * (1.0 - clamp(haze, 0.0, 1.0));

    // Low clouds on a flat layer overhead. The pattern is fixed to compass
    // directions, drifts with the wind, and compresses toward the horizon.
    vec3 sunColor = mix(warm, vec3(1.0), smoothstep(0.0, 0.35, sunHeight));
    float sunPower = 0.06 + 0.94 * max(day, twilight * 0.7);
    vec2 layer = ray.xy / (max(ray.z, 0.0) + 0.12) * 0.8 + cloudOffset;
    float density = skyLayers(layer);
    float threshold = mix(0.72, 0.18, coverage);
    float cloud = smoothstep(threshold, threshold + 0.15, density) * smoothstep(0.0, 0.10, ray.z) *
        smoothstep(0.02, 0.12, coverage);
    // Thinner cloud toward the Sun means this side is lit; thicker means shaded.
    float lit = clamp(0.5 + (density - skyLayers(layer + normalize(sun.xy + 1e-5) * 0.12)) * 2.2, 0.0, 1.0);
    vec3 shade = mix(vec3(0.03, 0.035, 0.05), vec3(0.50, 0.55, 0.63), day) * mix(1.0, 0.62, coverage);
    shade = mix(shade, vec3(0.30, 0.24, 0.34), twilight * 0.6);
    vec3 cloudColor = mix(shade, sunColor * sunPower, clamp(0.45 + 0.55 * lit - 0.4 * cloud * coverage, 0.0, 1.0));
    cloudColor += sunColor * pow(towardSun, 10.0) * (1.0 - cloud) * 0.4 * sunPower;
    cloudColor = mix(hazeColor, cloudColor, smoothstep(0.0, 0.25, ray.z) * (1.0 - 0.7 * clamp(haze, 0.0, 1.0)));

    // High, thin streaks when the sky is partly covered.
    vec2 streaks = ray.xy / (max(ray.z, 0.0) + 0.2) * vec2(0.22, 0.75) + cloudOffset * 0.4 + vec2(40.0, 13.0);
    float veil = smoothstep(0.52, 0.86, skyLayers(streaks)) * 0.38 * smoothstep(0.08, 0.45, coverage) *
        (1.0 - overcast) * smoothstep(0.0, 0.15, ray.z);
    sky = mix(sky, mix(shade * 1.25, sunColor * sunPower, 0.7), veil);

    sky = mix(sky, vec3(1.0, 0.97, 0.88), disc * (1.0 - cloud));
    sky = mix(sky, cloudColor, cloud * 0.96);
    // Sky seen below the horizon, where no ground is drawn, stays dim.
    sky *= mix(0.7, 1.0, smoothstep(-0.15, 0.0, ray.z));
    out_FragColor = vec4(sky, sceneColor.a);
}
`;

const passThroughFragmentShader = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main() {
    out_FragColor = texture(colorTexture, v_textureCoordinates);
}
`;

/**
 * Create an unadded, initially disabled sky stage.
 *
 * const sky = scene.postProcessStages.add(createCloudStage(C, scene));
 * sky.uniforms.cloudCover = 0.85;   // fraction, 0..1
 * sky.uniforms.haze = 0.2;          // clear..fog, 0..1
 * sky.uniforms.cloudOffset = new C.Cartesian2(x, y); // drift, advanced by the wind
 * sky.enabled = scene.pickPositionSupported;
 * scene.requestRender();
 *
 * The Sun's position comes from the scene clock. The scene's stage collection
 * owns disposal after add(). On devices without scene-depth support, the stage
 * stays a harmless pass-through even if enabled; there is deliberately no
 * canvas fallback that paints sky over buildings.
 */
export function createCloudStage(C, scene) {
  const stage = new C.PostProcessStage({
    name: 'whenscape-sky-clouds',
    fragmentShader: scene.pickPositionSupported ? cloudFragmentShader : passThroughFragmentShader,
    uniforms: scene.pickPositionSupported ? { cloudCover: 0, haze: 0, cloudOffset: new C.Cartesian2(0, 0) } : {},
  });
  stage.enabled = false;
  return stage;
}
