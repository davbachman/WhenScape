// Illustrative cloud cover belongs behind the terrain/building silhouette.
// A post-process stage can use Cesium's scene depth to distinguish sky pixels
// from geometry; a canvas painted over the viewport cannot make that distinction.
const cloudFragmentShader = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float cloudCover;
uniform float daylight;
in vec2 v_textureCoordinates;

float cloudHash(vec3 cell) {
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float cloudNoise(vec3 position) {
    vec3 cell = floor(position);
    vec3 part = fract(position);
    part = part * part * (3.0 - 2.0 * part);
    float lower = mix(
        mix(cloudHash(cell), cloudHash(cell + vec3(1.0, 0.0, 0.0)), part.x),
        mix(cloudHash(cell + vec3(0.0, 1.0, 0.0)),
            cloudHash(cell + vec3(1.0, 1.0, 0.0)), part.x), part.y);
    float upper = mix(
        mix(cloudHash(cell + vec3(0.0, 0.0, 1.0)),
            cloudHash(cell + vec3(1.0, 0.0, 1.0)), part.x),
        mix(cloudHash(cell + vec3(0.0, 1.0, 1.0)),
            cloudHash(cell + vec3(1.0, 1.0, 1.0)), part.x), part.y);
    return mix(lower, upper, part.z);
}

void main() {
    vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
    float coverage = clamp(cloudCover, 0.0, 1.0);

    // Cesium clears its depth attachment to 1.0. Compare the raw depth, so
    // logarithmic depth and far-away geometry cannot be mistaken for empty sky
    // by an arbitrary distance threshold. Preserve all geometry pixels exactly.
    if (coverage <= 0.0 || texture(depthTexture, v_textureCoordinates).r < 1.0) {
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
    float elevation = dot(rayWC, observerUp);

    // A fixed, broad pattern describes cloudiness rather than predicted cloud
    // locations. World-space directions keep the pattern stable while looking
    // around, and a smooth angular fade avoids a hard band near the horizon.
    float pattern = 0.68 * cloudNoise(rayWC * 5.0) +
        0.32 * cloudNoise(rayWC * 13.0 + vec3(7.0, 11.0, 3.0));
    float cloud = smoothstep(0.86 - coverage, 1.18 - coverage, pattern);
    float horizonFade = smoothstep(-0.06, 0.12, elevation);
    float opacity = min(0.94, (0.12 * coverage + 0.82 * cloud) *
        min(1.0, coverage * 3.0)) * horizonFade;
    vec3 cloudColor = mix(vec3(0.045, 0.055, 0.075),
        vec3(0.72, 0.75, 0.79), clamp(daylight, 0.0, 1.0));
    cloudColor *= mix(0.78, 1.04, pattern);
    out_FragColor = vec4(mix(sceneColor.rgb, cloudColor, opacity), sceneColor.a);
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
 * Create an unadded, initially disabled sky-cloud stage.
 *
 * const clouds = scene.postProcessStages.add(createCloudStage(C, scene));
 * clouds.uniforms.cloudCover = 0.85; // fraction, 0..1
 * clouds.uniforms.daylight = 1.0;    // night..day, 0..1
 * clouds.enabled = scene.pickPositionSupported && weatherEnabled;
 * scene.requestRender();
 *
 * The scene's stage collection owns disposal after add(). On devices without
 * scene-depth support, the stage stays a harmless pass-through even if enabled;
 * there is deliberately no canvas fallback that paints clouds over buildings.
 */
export function createCloudStage(C, scene) {
  const stage = new C.PostProcessStage({
    name: 'whenscape-sky-clouds',
    fragmentShader: scene.pickPositionSupported ? cloudFragmentShader : passThroughFragmentShader,
    uniforms: { cloudCover: 0, daylight: 1 },
  });
  stage.enabled = false;
  return stage;
}
