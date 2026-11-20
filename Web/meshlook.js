// The look of the photorealistic mesh. It was photographed in daylight and has
// no usable normals, so it cannot be relit; instead a shader multiplies it by
// an approximate light colour and adds haze, cloud shadows, wet or snowy
// ground and a night tone. All of it is illustrative.
import { clamp } from './astronomy.js';

const TINT_SHADER = `
float groundHash(vec2 cell) { return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453); }
float groundNoise(vec2 position) {
  vec2 cell = floor(position);
  vec2 part = fract(position);
  part = part * part * (3.0 - 2.0 * part);
  return mix(mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), part.x),
    mix(groundHash(cell + vec2(0.0, 1.0)), groundHash(cell + vec2(1.0, 1.0)), part.x), part.y);
}
float groundLayers(vec2 position) {
  float total = 0.0;
  float weight = 0.5;
  for (int i = 0; i < 5; ++i) {
    total += weight * groundNoise(position);
    position = position * 2.03 + vec2(17.0, 9.0);
    weight *= 0.5;
  }
  return total;
}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 photo = material.diffuse;
  float brightness = dot(photo, vec3(0.299, 0.587, 0.114));
  vec3 color = mix(photo, vec3(0.92, 0.94, 0.97), u_snow);
  // Wet ground darkens, and grey surfaces such as roads and paving pick up a
  // sheen of the sky's colour, as wet asphalt does.
  float chroma = max(photo.r, max(photo.g, photo.b)) - min(photo.r, min(photo.g, photo.b));
  float paving = 1.0 - smoothstep(0.05, 0.18, chroma);
  color *= 1.0 - 0.2 * u_wet;
  color = mix(color, u_hazeColor, u_wet * 0.24 * paving * (1.0 - brightness));
  // Under heavy cloud the light is flat: less colour, not just less light.
  color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), 0.3 * smoothstep(0.55, 1.0, u_cloudCover));
  // The cloud pattern repeats the sky stage's, laid over the ground at the
  // cloud layer's scale, so shadows drift with the clouds overhead.
  vec3 offset = fsInput.attributes.positionWC - u_pin;
  vec2 ground = vec2(dot(offset, u_east), dot(offset, u_north)) / 1500.0 + u_cloudOffset;
  float threshold = mix(0.72, 0.18, u_cloudCover);
  float shadow = smoothstep(threshold, threshold + 0.15, groundLayers(ground)) * smoothstep(0.02, 0.12, u_cloudCover);
  color *= 1.0 - u_cloudShadow * shadow;
  color *= u_light;
  // After dark, pale surfaces pick up a warm tone, as if lit by lamps.
  // Most of the glow falls on grey paving, where street lamps would be.
  color += u_glow * vec3(1.0, 0.74, 0.44) * smoothstep(0.22, 0.7, brightness) * (0.35 + 0.65 * paving) * photo;
  float distance = length(fsInput.attributes.positionEC);
  material.diffuse = mix(color, u_hazeColor, 1.0 - exp(-distance * u_hazeDensity));
}`;

export function createTintShader(C) {
  const vec3 = value => ({ type: C.UniformType.VEC3, value });
  const float = value => ({ type: C.UniformType.FLOAT, value });
  return new C.CustomShader({
    lightingModel: C.LightingModel.UNLIT,
    uniforms: {
      u_light: vec3(new C.Cartesian3(1, 1, 1)), u_hazeColor: vec3(new C.Cartesian3(0.7, 0.8, 0.9)), u_hazeDensity: float(0),
      u_pin: vec3(new C.Cartesian3()), u_east: vec3(new C.Cartesian3(1, 0, 0)), u_north: vec3(new C.Cartesian3(0, 1, 0)),
      u_cloudOffset: { type: C.UniformType.VEC2, value: new C.Cartesian2() },
      u_cloudCover: float(0), u_cloudShadow: float(0), u_wet: float(0), u_snow: float(0), u_glow: float(0),
    },
    fragmentShaderText: TINT_SHADER,
  });
}

/** White on upward-facing surfaces, for the plain OSM buildings. */
export function createSnowShader(C) {
  return new C.CustomShader({
    uniforms: { u_snowAmount: { type: C.UniformType.FLOAT, value: 0.72 } },
    fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 normalWC = normalize(czm_inverseViewRotation * fsInput.attributes.normalEC);
      vec3 upWC = normalize(fsInput.attributes.positionWC);
      float facingUp = smoothstep(0.4, 0.85, dot(normalWC, upWC));
      material.diffuse = mix(material.diffuse, vec3(0.88, 0.91, 0.94), facingUp * u_snowAmount);
      material.roughness = 1.0;
    }`,
  });
}

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Approximate colour of the light falling on the scene, as [r, g, b]: dark
 * blue at night, warm near sunrise and sunset, dimmer and greyer under cloud.
 * `clouds` is cover from 0 to 1.
 */
export function meshLight(sunAltitude, clouds) {
  const daylight = clamp((sunAltitude + 8) / 20, 0, 1);
  const warmth = clamp(1 - Math.abs(sunAltitude - 2) / 12, 0, 1) * (1 - clouds * 0.8);
  const mix = (night, day, warm) => {
    const base = night + (day - night) * daylight;
    return (base + (warm - base) * warmth * 0.6) * (1 - clouds * 0.2 * daylight);
  };
  // Night is a deep blue, lifted enough that streets and roofs still read.
  return [mix(0.045, 1, 1.0), mix(0.058, 1, 0.76), mix(0.1, 1, 0.56)];
}

/** Approximate sky colour at the horizon, matching the painted sky, as [r, g, b]. */
export function horizonColor(sunAltitude, clouds) {
  const sunHeight = Math.sin(sunAltitude * Math.PI / 180);
  const day = smooth(-0.10, 0.12, sunHeight);
  const twilight = smooth(-0.28, -0.03, sunHeight) * (1 - smooth(0.02, 0.32, sunHeight));
  const overcast = smooth(0.55, 1, clouds);
  let color = blend([0.03, 0.045, 0.08], [0.66, 0.80, 0.93], day);
  color = blend(color, [0.80, 0.52, 0.42], twilight);
  return blend(color, blend([0.045, 0.055, 0.075], [0.60, 0.64, 0.69], day), overcast * 0.85);
}

/**
 * The shader's weather- and sky-dependent settings, apart from where the pin
 * is. Inputs are the Sun's and Moon's altitudes in degrees, the lit fraction
 * of the Moon, cloud cover from 0 to 1, visibility in metres (or null),
 * precipitation in mm per hour (0 when none is shown) and snow depth in metres.
 */
export function meshTone({ sunAltitude = 45, moonAltitude = null, moonFraction = 0, clouds = 0,
  visibility = null, precipitation = 0, snowDepth = 0 } = {}) {
  const daylight = clamp((sunAltitude + 8) / 20, 0, 1);
  const light = meshLight(sunAltitude, clouds);
  // Moonlight lifts the night a little, more for a fuller, higher Moon.
  const moonlight = moonAltitude > 0 ? clamp(Math.sin(moonAltitude * Math.PI / 180) * 2.5, 0, 1) *
    moonFraction * (1 - daylight) * (1 - clouds * 0.8) : 0;
  light[0] += 0.07 * moonlight; light[1] += 0.095 * moonlight; light[2] += 0.15 * moonlight;
  const direct = sunAltitude > 2 ? Math.pow(1 - clamp((clouds - 0.55) / 0.45, 0, 1), 1.5) : 0;
  return {
    light,
    hazeColor: horizonColor(sunAltitude, clouds),
    hazeDensity: clamp(visibility > 0 ? 1.6 / visibility : 1 / 18000, 1 / 18000, 1 / 120),
    cloudCover: clouds,
    cloudShadow: 0.38 * direct,
    wet: clamp(precipitation / 3, 0, 1),
    snow: clamp(snowDepth / 0.05, 0, 1) * 0.7,
    glow: (1 - daylight) * 0.3,
  };
}
