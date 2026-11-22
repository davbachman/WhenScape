// Shows meteor showers in the sky. Each active shower's radiant, the point the
// meteors seem to come from, is marked with short rays and the shower's name,
// in the sky frame with the constellations. When the sky is dark enough,
// meteors streak away from the radiant across whatever part of the sky is in
// view.
//
// The streaks come far more often than real meteors do, so that a few show
// while you look, but in proportion to the rate a person would see: busy at a
// shower's peak on a dark night, sparse under moonlight or cloud, none by day.
// They are drawn translucent, so like the stars they stay behind buildings,
// the ground and cloud. With reduced motion only the radiants are shown.
import { SKY_RADIUS, skyDirection, skyPoint } from './skyframe.js';

/** How many times more often the streaks come than the meteors a person would see. */
export const SPEEDUP = 30;

/** A unit vector partway (angle in radians) along the great circle from `from` toward `toward` (unit, perpendicular). */
function along(from, toward, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: from.x * c + toward.x * s, y: from.y * c + toward.y * s, z: from.z * c + toward.z * s };
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const scaled = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = a => scaled(a, 1 / Math.hypot(a.x, a.y, a.z));

/** Two unit vectors perpendicular to `axis` and to each other. */
function around(axis) {
  const helper = Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const first = unit(minus(helper, scaled(axis, dot(helper, axis))));
  const second = { x: axis.y * first.z - axis.z * first.y, y: axis.z * first.x - axis.x * first.z, z: axis.x * first.y - axis.y * first.x };
  return [first, second];
}

/**
 * The path of one meteor that appears at `start` (a unit direction) and moves
 * directly away from `radiant` (a unit direction): the direction it travels,
 * its length in radians (longer further from the radiant) and how long it
 * lasts in seconds (shorter for faster showers). `random` is 0–1.
 */
export function meteorPath(start, radiant, speed, random = 0.5) {
  const away = minus(scaled(start, dot(start, radiant)), radiant);
  const distance = Math.acos(Math.min(1, Math.max(-1, dot(start, radiant))));
  const length = ((3 + 12 * Math.sin(distance)) * (0.6 + 0.6 * random) * Math.PI) / 180;
  const degreesPerSecond = 6 + speed * 0.25;
  return { toward: unit(away), length, duration: Math.min(1.2, Math.max(0.25, (length * 180) / Math.PI / degreesPerSecond)) };
}

export function createMeteors(C, viewer) {
  const scene = viewer.scene, camera = viewer.camera;
  const rays = scene.primitives.add(new C.PolylineCollection());
  const names = scene.primitives.add(new C.LabelCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
  const streaks = scene.primitives.add(new C.PolylineCollection());
  const rayColor = C.Color.fromCssColorString('#ffd9a0').withAlpha(0.55);
  let markedKey = '', showers = [], rotation, animate = false, clearSky = 1;
  let nextSpawn = 0, frame = 0, timer = 0;
  const live = [];

  // Each radiant: eight short rays around an empty centre, and the name below.
  function mark(list, frameMatrix) {
    rays.modelMatrix = frameMatrix;
    names.modelMatrix = frameMatrix;
    const key = list.map(s => `${s.name}:${s.ra.toFixed(1)},${s.dec.toFixed(1)}`).join('|');
    if (key === markedKey) return;
    markedKey = key;
    rays.removeAll();
    names.removeAll();
    for (const shower of list) {
      const center = skyDirection(shower.ra, shower.dec);
      const [first, second] = around(center);
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const out = unit({ x: first.x * Math.cos(angle) + second.x * Math.sin(angle), y: first.y * Math.cos(angle) + second.y * Math.sin(angle), z: first.z * Math.cos(angle) + second.z * Math.sin(angle) });
        const [inner, outer] = [1.6, 3.6].map(degrees => scaled(along(center, out, (degrees * Math.PI) / 180), SKY_RADIUS));
        rays.add({ positions: [new C.Cartesian3(inner.x, inner.y, inner.z), new C.Cartesian3(outer.x, outer.y, outer.z)], width: 1.5,
          material: C.Material.fromType('Color', { color: rayColor }) });
      }
      // Clear of the rays, toward the south celestial pole.
      names.add({ position: skyPoint(C, shower.ra, Math.max(-90, shower.dec - 6.5)), text: shower.name,
        font: '600 11px -apple-system, "Helvetica Neue", sans-serif', fillColor: C.Color.fromCssColorString('#ffe2b8').withAlpha(0.85),
        horizontalOrigin: C.HorizontalOrigin.CENTER, verticalOrigin: C.VerticalOrigin.CENTER });
    }
  }

  const totalRate = () => showers.reduce((sum, s) => sum + s.rate, 0) * clearSky * SPEEDUP / 3600;
  const wait = () => -Math.log(1 - Math.random()) / totalRate();

  // A meteor somewhere in view, above the horizon, moving away from a radiant
  // chosen in proportion to the showers' rates.
  function spawn(now) {
    let pick = Math.random() * showers.reduce((sum, s) => sum + s.rate, 0);
    const shower = showers.find(s => (pick -= s.rate) <= 0) ?? showers[0];
    const sky = skyDirection(shower.ra, shower.dec);
    const world = C.Matrix3.multiplyByVector(rotation, new C.Cartesian3(sky.x, sky.y, sky.z), new C.Cartesian3());
    const radiant = { x: world.x, y: world.y, z: world.z };
    const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(camera.positionWC, new C.Cartesian3());
    const canvas = viewer.canvas;
    for (let tries = 0; tries < 8; tries++) {
      const ray = camera.getPickRay(new C.Cartesian2(canvas.clientWidth * (0.05 + 0.9 * Math.random()), canvas.clientHeight * (0.05 + 0.9 * Math.random())));
      if (!ray) continue;
      const start = unit({ x: ray.direction.x, y: ray.direction.y, z: ray.direction.z });
      if (dot(start, up) < Math.sin((8 * Math.PI) / 180) || dot(start, radiant) > Math.cos((3 * Math.PI) / 180)) continue;
      const path = meteorPath(start, radiant, shower.speed, Math.random());
      const line = streaks.add({ positions: [camera.positionWC, camera.positionWC], width: 3,
        material: C.Material.fromType('PolylineGlow', { color: C.Color.WHITE.withAlpha(0), glowPower: 0.25, taperPower: 0.5 }) });
      live.push({ line, start, ...path, born: now, from: C.Cartesian3.clone(camera.positionWC) });
      return;
    }
  }

  function draw(now) {
    for (let i = live.length - 1; i >= 0; i--) {
      const meteor = live[i];
      const progress = (now - meteor.born) / meteor.duration;
      if (progress >= 1) { streaks.remove(meteor.line); live.splice(i, 1); continue; }
      const head = meteor.length * Math.min(1, progress * 1.15), tail = Math.max(0, head - meteor.length * 0.55);
      const point = angle => {
        const d = along(meteor.start, meteor.toward, angle);
        return new C.Cartesian3(meteor.from.x + d.x * SKY_RADIUS, meteor.from.y + d.y * SKY_RADIUS, meteor.from.z + d.z * SKY_RADIUS);
      };
      // Cesium's glow tapers from the line's first point, so the tail goes first and fades out behind the head.
      meteor.line.positions = [point(tail), point(head)];
      meteor.line.material.uniforms.color = C.Color.WHITE.withAlpha(0.95 * Math.sin(Math.PI * progress) ** 0.6);
    }
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    nextSpawn = 0;
    for (const meteor of live) streaks.remove(meteor.line);
    live.length = 0;
  }

  function step(time) {
    frame = 0;
    const now = time / 1000;
    const rate = totalRate();
    if (!animate || !(rate > 0) && !live.length) { stop(); return; }
    if (rate > 0) {
      // After a long pause (a hidden window), start afresh rather than catch up.
      if (!nextSpawn || now - nextSpawn > 2) nextSpawn = now + wait();
      while (now >= nextSpawn) { spawn(now); nextSpawn += wait(); }
    }
    draw(now);
    if (live.length) {
      scene.requestRender();
      frame = requestAnimationFrame(step);
    } else {
      // Nothing moving: sleep until the next meteor is due.
      timer = setTimeout(() => { timer = 0; frame = requestAnimationFrame(step); }, Math.max(16, (nextSpawn - now) * 1000));
    }
  }

  return {
    /** For the diagnostics readout: showers marked, streaks a second, streaks in flight, and whether they are animating. */
    stats: () => ({ showers: showers.length, perSecond: totalRate(), live: live.length, animate, waiting: !!(frame || timer) }),
    /**
     * Bring them to the moment. `frame` and `rotation` come from skyFrame();
     * `showers` from activeShowers(); `clouds` is the cloud cover, 0–1;
     * `animate` is false while the scene is hidden or motion is reduced.
     */
    update({ frame: frameMatrix, rotation: frameRotation, showers: list, clouds = 0, animate: moving }) {
      showers = list;
      rotation = frameRotation;
      clearSky = Math.max(0, 1 - clouds);
      animate = moving;
      mark(list, frameMatrix);
      if (!animate || !(totalRate() > 0)) { if (!live.length) stop(); }
      if (animate && totalRate() > 0 && !frame && !timer) frame = requestAnimationFrame(step);
    },
  };
}
