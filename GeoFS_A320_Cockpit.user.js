// ==UserScript==
// @name         GeoFS A320 Cockpit (WIP) 9
// @namespace    https://github.com/
// @version      9
// @description  Replaces the cockpit of the community A320-214 in GeoFS with the "A320 Cockpit 2" model.
// @match        https://beta.geo-fs.com/geofs.php?a=22*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * Cockpit model: "A320 Cockpit 2" by davidmarton1987 (https://sketchfab.com/davidmarton1987)
 * https://sketchfab.com/3d-models/a320-cockpit-2-5fb0c671a91042c1a9d8f2cf3e2df021
 * License: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/
 * Changes: node animations, instrument screens, levers, lights and sound added for GeoFS; the model may be optimized.
 */

(function () {
  'use strict';

  var MODEL_URL = 'https://sketchfab.com/3d-models/a320-cockpit-2-5fb0c671a91042c1a9d8f2cf3e2df021';
  var LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
  var CREATOR = 'davidmarton1987';
  var CREATOR_URL = 'https://sketchfab.com/davidmarton1987';
  var CREDIT = 'Cockpit model "A320 Cockpit 2" by ' + CREATOR + ', licensed under CC BY 4.0. Changes: animations, instrument screens, levers, lights and sound added for GeoFS.';
  // A318 / A319 / A320 / A321 family (ceo and neo)
  var DEFAULT_IDS = ['22', '5156', '2878', '2879', '3140', '5847', '3534', '3011', '2871', '2865', '5086', '2870', '242', '4646'];
  // ex/ey/ez: pilot eye point in the model's own axes (X right, Y up, -Z forward), as shown in the labeler.
  // rx/ry/rz: rotation in degrees; 180/180/270 was found in GeoFS to give the right orientation.
  // dx/dy/dz: extra offset in GeoFS meters (X right, Y forward, Z up).
  var DEFAULT_TUNE = { scale: 3.3, ex: -0.12, ey: 0.18, ez: 0.64, rx: 180, ry: 180, rz: 270, dx: 0, dy: 0, dz: 0 };
  // Screens: positions are model coordinates (same axes as the labeler). cs converts them to GeoFS part
  // coordinates, ss is the panel size, tilt/yaw turn the panel.
  // Child parts sit in the cockpit frame, which is turned -90 degrees around Z compared with the world,
  // so a model point (x, y, z) becomes the part position (z, x, y) * cs, and a panel needs yaw +90 to face the pilot.
  var DEFAULT_SCREENS = { on: true, ss: 0.2, cs: 3.3, tilt: 16, yaw: 270, pfd1: [-0.134, 0.087, 0.435], pfd2: [0.127, 0.087, 0.435] };
  // Throttle and flap levers are generated here (the model has none). Positions are model coordinates of the pivot.
  var DEFAULT_LEVERS = { on: true, ls: 0.3, lrot: [0, 0, 0], thrL: [-0.011, -0.012, 0.5256], thrR: [0.011, -0.012, 0.5256], flaps: [0.040, -0.010, 0.545], thrAngle: 40, thrIdle: 8, flapStep: 12 };
  // Two ceiling spotlights in model coordinates, both aiming at "aim". i: strength, r: reach.
  var DEFAULT_LIGHTS = { on: true, i: 1, r: 3.75, l1: [-0.03, -0.84, 0.62], l2: [0.12, 0.31, 0.62], aim: [0.04, 0.03, 0.5] };
  var DEFAULT_SOUND = { on: true, cutoff: 1800, vol: 0.9, wind: 0.6, ac: 0.6, rumble: 3 };

  function lsGet(k) { try { var s = localStorage.getItem('a320cp-' + k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem('a320cp-' + k, JSON.stringify(v)); } catch (e) {} }
  function log() { var a = ['[A320CP]'].concat([].slice.call(arguments)); console.log.apply(console, a); }
  function merge(def, saved) {
    var o = JSON.parse(JSON.stringify(def)); saved = saved || {};
    Object.keys(saved).forEach(function (k) { o[k] = saved[k]; });
    return o;
  }

  var state = {
    url: null,
    ids: DEFAULT_IDS.concat((lsGet('ids') || []).filter(function (x) { return DEFAULT_IDS.indexOf(x) === -1; })),
    tune: merge(DEFAULT_TUNE, lsGet('tune2')),
    screens: merge(DEFAULT_SCREENS, lsGet('screens2')),
    levers: merge(DEFAULT_LEVERS, lsGet('levers2')),
    lights: merge(DEFAULT_LIGHTS, lsGet('lights10')),
    sound: merge(DEFAULT_SOUND, lsGet('sound')),
    loaded: false, pickLog: false
  };
  function saveOpts() { lsSet('tune2', state.tune); lsSet('screens2', state.screens); lsSet('levers2', state.levers); lsSet('lights10', state.lights); lsSet('sound', state.sound); }
  function rad(d) { return d * Math.PI / 180; }

  // ---------- audio: muffle GeoFS sound in the cockpit and add cabin ambience ----------
  // Must run before GeoFS connects its sounds, hence @run-at document-start. Everything GeoFS sends to the
  // speakers goes through one low-pass filter that we control.
  var audioFx = (function () {
    var fx = { chain: null, ctx: null, connect: null, amb: null };
    if (!window.AudioNode || !(window.AudioContext || window.webkitAudioContext)) return fx;
    var chains = new WeakMap(), orig = AudioNode.prototype.connect;
    fx.connect = orig;
    function chainFor(ctx) {
      var c = chains.get(ctx); if (c) return c;
      c = { input: ctx.createGain(), lp: ctx.createBiquadFilter(), out: ctx.createGain() };
      c.lp.type = 'lowpass'; c.lp.frequency.value = 22000; c.lp.Q.value = 0.7;
      orig.call(c.input, c.lp); orig.call(c.lp, c.out); orig.call(c.out, ctx.destination);
      chains.set(ctx, c); fx.chain = c; fx.ctx = ctx;
      return c;
    }
    AudioNode.prototype.connect = function (dest) {
      if (dest && typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
        var c = chainFor(dest.context);
        orig.apply(this, [c.input].concat([].slice.call(arguments, 1)));
        return dest;
      }
      return orig.apply(this, arguments);
    };
    return fx;
  })();

  function buildAmbience(ctx) {
    var o = audioFx.connect, len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), i;
    for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    function layer(type, freq, q) {
      var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
      o.call(src, f); o.call(f, g); o.call(g, ctx.destination); src.start();
      return { filter: f, gain: g };
    }
    return { ac: layer('bandpass', 3200, 0.4), wind: layer('lowpass', 900, 0.5), rumble: layer('lowpass', 160, 0.7) };
  }

  function tickAudio() {
    if (!audioFx.chain) return;
    var ctx = audioFx.ctx, now = ctx.currentTime, s = state.sound, v = (window.geofs && geofs.animation && geofs.animation.values) || {};
    var inside = !!(window.geofs && geofs.camera && geofs.camera.currentModeName === 'cockpit');
    var on = !!(s.on && inside);
    if (!audioFx.amb && ctx.state === 'running') { try { audioFx.amb = buildAmbience(ctx); } catch (e) { log('ambience failed', e); } }
    audioFx.chain.lp.frequency.setTargetAtTime(on ? s.cutoff : 22000, now, 0.12);
    audioFx.chain.out.gain.setTargetAtTime(on ? s.vol : 1, now, 0.12);
    var a = audioFx.amb; if (!a) return;
    var kias = Math.max(0, v.kias || 0), air = Math.min(1, kias / 350), eng = v.enginesOn ? 1 : 0, thr = Math.max(0, v.smoothThrottle || v.throttle || 0);
    a.ac.gain.gain.setTargetAtTime(on ? 0.03 * s.ac * (eng ? 1 : 0.4) : 0, now, 0.3);
    a.wind.gain.gain.setTargetAtTime(on ? air * air * 0.12 * s.wind : 0, now, 0.3);
    a.wind.filter.frequency.setTargetAtTime(500 + kias * 3, now, 0.3);
    a.rumble.gain.gain.setTargetAtTime(on ? eng * (0.04 + 0.12 * thr) * s.rumble : 0, now, 0.3);
  }

  // ---------- parts (node names come from the labeling export) ----------
  function rot(axis, value, ratio, extra) { return Object.assign({ type: 'rotate', axis: axis, value: value, ratio: ratio, offset: 0 }, extra || {}); }

  // Merge a GeoFS include (e.g. the Airbus PFD) into a part ourselves so our position, scale and rotation win.
  function includeParts(name, inc, over) {
    var list = window.geofs && geofs.includes && geofs.includes[inc];
    if (!list) { log('include missing:', inc); return []; }
    var main = $.extend(true, {}, list[0], over, { name: name }), out = [main];
    for (var i = 1; i < list.length; i++) { var u = Object.assign({}, list[i], { parent: name }); u.name = name + u.name; out.push(u); }
    return out;
  }
  // Model point (x, y, z) -> part coordinates inside the cockpit frame.
  function partPos(p) { var k = state.screens.cs; return [p[2] * k, p[0] * k, p[1] * k]; }
  var SCREEN_NAMES = ['a320PFD1', 'a320PFD2'];
  function screenOver(p) {
    var s = state.screens;
    return { parent: 'cockpit', type: 'none', position: partPos(p), rotation: [s.tilt, 0, s.yaw], scale: [s.ss, s.ss, s.ss] };
  }

  // ---------- generated levers (a tiny GLB built in memory) ----------
  // Boxes are [cx, cy, cz, sx, sy, sz] in meters, glTF axes (Y up). The pivot is the origin.
  function buildGLB(nodeName, boxes, color) {
    var pos = [], nor = [], idx = [];
    var faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    boxes.forEach(function (b) {
      var h = [b[3] / 2, b[4] / 2, b[5] / 2];
      faces.forEach(function (f) {
        var n = f[0], u = f[1], v = f[2], base = pos.length / 3;
        var hn = Math.abs(n[0]) * h[0] + Math.abs(n[1]) * h[1] + Math.abs(n[2]) * h[2];
        var hu = Math.abs(u[0]) * h[0] + Math.abs(u[1]) * h[1] + Math.abs(u[2]) * h[2];
        var hv = Math.abs(v[0]) * h[0] + Math.abs(v[1]) * h[1] + Math.abs(v[2]) * h[2];
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
          for (var a = 0; a < 3; a++) pos.push(b[a] + n[a] * hn + u[a] * hu * s[0] + v[a] * hv * s[1]);
          nor.push(n[0], n[1], n[2]);
        });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    });
    var P = new Float32Array(pos), N = new Float32Array(nor), I = new Uint16Array(idx);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], i, a;
    for (i = 0; i < pos.length; i += 3) for (a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
    var idxPad = (4 - I.byteLength % 4) % 4, binLen = P.byteLength + N.byteLength + I.byteLength + idxPad;
    var json = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: nodeName, mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
      materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [color[0], color[1], color[2], 1], metallicFactor: 0.2, roughnessFactor: 0.6 } }],
      buffers: [{ byteLength: binLen }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 },
        { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: I.byteLength, target: 34963 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: min, max: max },
        { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' }]
    };
    var js = JSON.stringify(json); while (js.length % 4) js += ' ';
    var jb = new TextEncoder().encode(js), total = 12 + 8 + jb.length + 8 + binLen, out = new ArrayBuffer(total), dv = new DataView(out), o = 0;
    dv.setUint32(o, 0x46546C67, true); dv.setUint32(o + 4, 2, true); dv.setUint32(o + 8, total, true); o = 12;
    dv.setUint32(o, jb.length, true); dv.setUint32(o + 4, 0x4E4F534A, true); new Uint8Array(out, o + 8, jb.length).set(jb); o += 8 + jb.length;
    dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004E4942, true); o += 8;
    new Uint8Array(out, o, P.byteLength).set(new Uint8Array(P.buffer)); o += P.byteLength;
    new Uint8Array(out, o, N.byteLength).set(new Uint8Array(N.buffer)); o += N.byteLength;
    new Uint8Array(out, o, I.byteLength).set(new Uint8Array(I.buffer));
    return URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
  }
  var LEVER_NAMES = ['a320ThrottleL', 'a320ThrottleR', 'a320Flaps'];
  var leverUrls = {};
  function leverUrl(name) {
    if (leverUrls[name]) return leverUrls[name];
    var throttle = [[0, 0.05, 0, 0.010, 0.10, 0.010], [0, 0.118, 0, 0.026, 0.044, 0.016]];
    var flaps = [[0, 0.045, 0, 0.010, 0.09, 0.012], [0, 0.105, 0, 0.012, 0.036, 0.034]];
    leverUrls[name] = buildGLB(name, name === 'a320Flaps' ? flaps : throttle, name === 'a320Flaps' ? [0.08, 0.08, 0.09] : [0.1, 0.1, 0.11]);
    return leverUrls[name];
  }
  // The levers swing around the cockpit frame's Y axis (side to side in the aircraft). Positive turns the top aft.
  function leverParts() {
    var L = state.levers, s = [L.ls, L.ls, L.ls];
    function part(name, key, anim, manip) {
      var url = leverUrl(name);
      return { name: name, parent: 'cockpit', type: 'none', model: url, forceZup: true, gltf2model: { url: url, forceZup: true },
        position: partPos(L[key]), rotation: L.lrot.map(rad), scale: s, points: {}, animations: [anim], manipulator: manip, clickNodes: [name] };
    }
    return [
      part('a320ThrottleL', 'thrL', rot('Y', 'smoothThrottleLeft', -L.thrAngle, { offset: L.thrIdle, min: 0 }), { control: 'throttleLeft', input: 'iyr', ratio: 2, min: 0.001 }),
      part('a320ThrottleR', 'thrR', rot('Y', 'smoothThrottleRight', -L.thrAngle, { offset: L.thrIdle, min: 0 }), { control: 'throttleRight', input: 'iyr', ratio: 2, min: 0.001 }),
      part('a320Flaps', 'flaps', rot('Y', 'flapsTarget', L.flapStep), { control: 'flapsPositionTarget', input: 'iyr', ratio: 3 })
    ];
  }

  function buildParts(url, inst) {
    var P = function (name, node, animations, extra) { return Object.assign({ name: name, parent: 'cockpit', node: node, animations: animations || [] }, extra || {}); };
    var parts = [
      {
        name: 'cockpit', parent: 'root', type: 'frame', model: url,
        forceZup: true, gltf2model: { url: url, forceZup: true },
        position: cockpitPosition(inst), doNotScalePosition: true,
        rotation: [state.tune.rx, state.tune.ry, state.tune.rz],
        scale: [state.tune.scale, state.tune.scale, state.tune.scale],
        // Visibility is controlled by reassert() so the custom cockpit cannot remain visible externally.
        animations: []
      },
      // Pitch (X) works. Roll moves on Z for the stick; the tiller wheel spins on Y.
      P('stickLeft', 'node27_002_145', [rot('X', 'pitch', -20), rot('Z', 'roll', 20)]),
      P('stickRight', 'node31_002_149', [rot('X', 'pitch', -20), rot('Z', 'roll', 20)]),
      P('tilerLeft', 'node41_001_158', [rot('Y', 'yaw', 30)]),
      P('tilerRight', 'node35_002_152', [rot('Y', 'yaw', 30)]),
      // The modeled pose is the normal (up) position. Positive rotation turns the lever up, negative turns it down.
      // Gear: target 1 = retracted = normal (0 deg), target 0 = extended = down (-40 deg).
      // Engines: enginesOn 1 = ON = normal (0 deg), 0 = OFF = down (-50 deg).
      // clickNodes: the mesh nodes under each animated node. Clicks may report the mesh node, not the animated one.
      P('gearLever', 'node37_002_156', [rot('X', 'gearTarget', 40, { offset: -40 })], { manipulator: { setter: 'setGear' }, clickNodes: ['Object_65', 'Object_214'] }),
      P('engineSwitchLeft', 'node9_002_125', [rot('X', 'enginesOn', 50, { offset: -50 })], { manipulator: { setter: 'toggleEngines' }, clickNodes: ['Object_54', 'Object_180'] }),
      P('engineSwitchRight', 'node11_002_95', [rot('X', 'enginesOn', 50, { offset: -50 })], { manipulator: { setter: 'toggleEngines' }, clickNodes: ['Object_45', 'Object_147'] })
    ];
    if (state.levers.on) parts = parts.concat(leverParts());
    if (state.screens.on) {
      parts = parts.concat(includeParts(SCREEN_NAMES[0], '3d-AirbusPFD', screenOver(state.screens.pfd1)));
      parts = parts.concat(includeParts(SCREEN_NAMES[1], '3d-AirbusPFD', screenOver(state.screens.pfd2)));
    }
    return parts;
  }

  // Rotate a vector: X first, then Y, then Z (degrees). Used for the orientation list.
  function rotateVec(v, rx, ry, rz) {
    var d = Math.PI / 180, x = v[0], y = v[1], z = v[2], c, s, t;
    c = Math.cos(rx * d); s = Math.sin(rx * d); t = y * c - z * s; z = y * s + z * c; y = t;
    c = Math.cos(ry * d); s = Math.sin(ry * d); t = x * c + z * s; z = -x * s + z * c; x = t;
    c = Math.cos(rz * d); s = Math.sin(rz * d); t = x * c - y * s; y = x * s + y * c; x = t;
    return [x, y, z];
  }
  // Place the model so its eye point lands on GeoFS's cockpit camera position.
  // With the orientation that looks right, model (x, y, z) ends up at GeoFS (x, -z, y) * scale.
  function cockpitPosition(inst) {
    var t = state.tune, cam = inst.definition.cameras.cockpit.position, S = t.scale;
    var e = [t.ex * S, -t.ez * S, t.ey * S];
    return [cam[0] - e[0] + t.dx, cam[1] - e[1] + t.dy, cam[2] - e[2] + t.dz];
  }

  function applyTune(inst) {
    inst = inst || geofs.aircraft.instance;
    var p = inst.parts && inst.parts.cockpit;
    if (!p || !p.object3d) return false;
    var S = state.tune.scale;
    p.scale = [S, S, S];
    p.originalScale = [S, S, S];
    p.position = cockpitPosition(inst);
    p.rotation = [state.tune.rx, state.tune.ry, state.tune.rz].map(rad);
    inst.definition.cockpitScaleFix = 1;
    try { inst.fixCockpitScale(1); } catch (e) { log('fixCockpitScale failed', e); }
    try { inst.object3d.compute(inst.llaLocation); inst.placeParts(); inst.render(); } catch (e) { log('place/render failed', e); }
    saveOpts();
    return true;
  }

  // Try to move the cockpit without reloading. GeoFS keeps the base transform in the Object3D
  // (setInitialPosition / setInitialRotation), so the part definition alone is not enough.
  function applyLive() {
    var inst = geofs.aircraft.instance, p = inst.parts && inst.parts.cockpit;
    if (!p || !p.object3d) return;
    p.position = cockpitPosition(inst);
    p.rotation = [state.tune.rx, state.tune.ry, state.tune.rz].map(rad);
    try { p.object3d.setInitialPosition(p.position); p.object3d.setInitialRotation(p.rotation); } catch (e) { log('live placement failed', e); }
    try { inst.object3d.compute(inst.llaLocation); inst.placeParts(); inst.render(); } catch (e) { log('place/render failed', e); }
  }

  function applyScreens() {
    var inst = geofs.aircraft.instance, s = state.screens, L = state.levers;
    [[SCREEN_NAMES[0], s.pfd1], [SCREEN_NAMES[1], s.pfd2]].forEach(function (d) {
      var p = inst.parts && inst.parts[d[0]]; if (!p || !p.object3d) return;
      var pos = partPos(d[1]), r = [s.tilt, 0, s.yaw].map(rad);
      var ss = Math.max(0.02, s.ss || 0.2); p.position = pos; p.rotation = r; p.scale = [ss, ss, ss]; p.originalScale = [ss, ss, ss];
      try { p.object3d.setScale(p.scale); p.object3d.setInitialPosition(pos); p.object3d.setInitialRotation(r); } catch (e) { log('screen placement failed', e); }
    });
    [['a320ThrottleL', 'thrL'], ['a320ThrottleR', 'thrR'], ['a320Flaps', 'flaps']].forEach(function (d) {
      var p = inst.parts && inst.parts[d[0]]; if (!p || !p.object3d) return;
      var pos = partPos(L[d[1]]), r = L.lrot.map(rad);
      var ls = Math.max(0.02, L.ls || 0.3); p.position = pos; p.rotation = r; p.scale = [ls, ls, ls]; p.originalScale = [ls, ls, ls];
      try { p.object3d.setScale(p.scale); p.object3d.setInitialPosition(pos); p.object3d.setInitialRotation(r); p.object3d.setVisibility(true); } catch (e) { log('lever placement failed', e); }
    });
    try { inst.placeParts(); inst.render(); } catch (e) { log('place/render failed', e); }
    saveOpts();
  }

  // Many A318-A321 variants already carry their own cockpit model and instrument screens. Hide those so only ours shows.
  // A part is "stock cockpit" when it is only visible in the cockpit view, is an instrument renderer / HUD,
  // or is a child of such a part. Our own parts are named "cockpit" or "a320...".
  function isOurPart(n) { return n === 'cockpit' || /^a320/.test(n); }
  function hideStockCockpit(inst) {
    var parts = inst && inst.parts; if (!parts) return;
    var names = Object.keys(parts), hide = {};
    names.forEach(function (n) {
      var p = parts[n]; if (!p || isOurPart(n)) return;
      if (p.__a320hidden) { hide[n] = 1; return; }
      var an = p.animations || [];
      var only = an.some(function (a) { return a.value === 'view' && (((a.type === 'hide' || a.type === 'justhide') && a.notEq === 'cockpit') || ((a.type === 'show' || a.type === 'justshow') && a.eq === 'cockpit')); });
      var instr = an.some(function (a) { return a.type === 'render'; }) || /hud|pfd|ecam|eicas|mcdu/i.test(n);
      if (only || instr) hide[n] = 1;
    });
    for (var again = true; again;) {
      again = false;
      names.forEach(function (n) { var p = parts[n]; if (p && !hide[n] && !isOurPart(n) && p.parent && hide[p.parent]) { hide[n] = 1; again = true; } });
    }
    var count = 0;
    Object.keys(hide).forEach(function (n) {
      var p = parts[n]; if (!p || !p.object3d) return;
      if (!p.__a320hidden) {
        p.animations = (p.animations || []).filter(function (a) { return a.type !== 'hide' && a.type !== 'show' && a.type !== 'justshow' && a.type !== 'render'; });
        p.__a320hidden = true; count++;
      }
      // Some stock models finish loading after we hide them and switch themselves back on, so keep hiding them.
      if (p.object3d.visible !== false) { try { p.object3d.setVisibility(false); p.visible = false; } catch (e) {} }
    });
    if (count) log('hid ' + count + ' stock cockpit/instrument parts');
  }

  // The PFD renderers load asynchronously, so they sometimes came up late or not at all.
  // Re-apply after load, then keep a watchdog that restores visibility and the renderer.
  function reassert() {
    var inst = geofs.aircraft.instance; if (!inst || !inst.parts) return;
    try { hideStockCockpit(inst); } catch (e) {}

    // The custom GLB is placed at the cockpit camera position. Explicitly hide/show
    // the complete model according to the active camera instead of relying on a
    // GeoFS view animation, which can leave the cockpit shell visible externally.
    try {
      var cockpitPart = inst.parts.cockpit;
      if (cockpitPart && cockpitPart.object3d) {
        var showCockpit = !!(geofs.camera && geofs.camera.currentModeName === 'cockpit');
        if (cockpitPart.object3d.visible !== showCockpit) {
          cockpitPart.object3d.setVisibility(showCockpit);
        }
        cockpitPart.visible = showCockpit;
      }
    } catch (e) { log('cockpit visibility update failed', e); }

    SCREEN_NAMES.forEach(function (n) {
      var p = inst.parts[n]; if (!p || !p.object3d) return;
      try {
        var cockpit = geofs.camera.currentModeName === 'cockpit';
        if (cockpit && p.object3d.visible === false) p.object3d.setVisibility(true);
        if (p.rendererInstance && !p.rendererInstance.exported && p.animations) {
          var a = p.animations.filter(function (x) { return x.type === 'render'; })[0];
          if (a && a.currentValue == null) a.currentValue = undefined;
        }
      } catch (e) {}
    });
  }
  var watchdog = null;
  function startWatchdog() {
    if (watchdog) clearInterval(watchdog);
    watchdog = setInterval(function () { try { reassert(); } catch (e) {} }, 1000);
  }
  function scheduleReapply() {
    [0, 400, 1500, 4000].forEach(function (ms) { setTimeout(function () { try { hideStockCockpit(geofs.aircraft.instance); applyScreens(); reassert(); } catch (e) {} }, ms); });
    var inst = geofs.aircraft.instance, p = inst.parts && inst.parts[SCREEN_NAMES[0]];
    var rdy = p && p.object3d && p.object3d.getModel && p.object3d.getModel();
    if (rdy && rdy.readyPromise) rdy.readyPromise.then(function () { applyScreens(); reassert(); }).catch(function () {});
  }

  // ---------- clicks on gear / engine switches / levers ----------
  var clickLog = [], clickEl = null;
  function registerClicks(inst) {
    if (!(window.controls && controls.addNodeClickHandler)) return;
    var done = {};
    (inst.parts ? Object.keys(inst.parts) : []).forEach(function (k) {
      var p = inst.parts[k]; if (!p) return;
      var man = p.manipulator; if (!man) return;
      var names = (p.clickNodes || []).concat(p.node ? [p.node] : []);
      names.forEach(function (nm) {
        if (done[nm]) return; done[nm] = 1;
        try {
          controls.addNodeClickHandler(nm, function () {
            try {
              if (man.setter && typeof geofs.aircraft.instance[man.setter] === 'function') geofs.aircraft.instance[man.setter]();
              else if (man.setter && geofs.aircraft.instance.definition && typeof controls[man.setter] === 'function') controls[man.setter]();
            } catch (e) { log('click failed', e); }
          });
        } catch (e) { log('addNodeClickHandler failed', nm, e); }
      });
    });
  }
  // Log which node is under the mouse so unknown parts can be identified.
  function installPickLog() {
    document.addEventListener('mousedown', function (ev) {
      if (!state.pickLog) return;
      try {
        var v = geofs.api && geofs.api.viewer; if (!v) return;
        var picked = v.scene.pick(new Cesium.Cartesian2(ev.clientX, ev.clientY));
        var nm = picked && picked.node && picked.node.name || (picked && picked.primitive && picked.primitive.constructor && picked.primitive.constructor.name) || 'inget';
        clickLog.push(nm); if (clickLog.length > 20) clickLog.shift();
        if (clickEl) clickEl.textContent = 'Last clicked: ' + clickLog.slice(-5).join(', ');
      } catch (e) {}
    }, true);
  }

  // ---------- cockpit spotlights (custom shader on the cockpit model) ----------
  var lightShader = null, lightMsgEl = null;
  var LIGHT_GLSL =
    'void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {\n' +
    '  vec3 p = fsInput.attributes.positionMC;\n' +
    '  vec3 v1 = p - u_p1; float a1 = max(0.0, 1.0 - length(v1) / u_r); float c1 = smoothstep(0.15, 0.65, dot(normalize(v1), u_d1));\n' +
    '  vec3 v2 = p - u_p2; float a2 = max(0.0, 1.0 - length(v2) / u_r); float c2 = smoothstep(0.15, 0.65, dot(normalize(v2), u_d2));\n' +
    '  vec3 glow = vec3(1.0, 0.92, 0.78) * (a1 * a1 * c1 + a2 * a2 * c2) * u_i;\n' +
    '  material.emissive += material.diffuse * glow * 3.0;\n' +
    '}';
  function c3(a) { return new Cesium.Cartesian3(a[0], a[1], a[2]); }
  function dir(from, to) {
    var d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }
  function lightMsg(t) { if (lightMsgEl) lightMsgEl.textContent = t; }
  function updateLights() {
    if (!lightShader) return;
    var L = state.lights;
    lightShader.setUniform('u_p1', c3(L.l1)); lightShader.setUniform('u_p2', c3(L.l2));
    lightShader.setUniform('u_d1', c3(dir(L.l1, L.aim))); lightShader.setUniform('u_d2', c3(dir(L.l2, L.aim)));
    lightShader.setUniform('u_r', L.r); lightShader.setUniform('u_i', L.i);
    saveOpts();
  }
  function setLights(on) {
    state.lights.on = on; saveOpts();
    var inst = geofs.aircraft.instance, p = inst.parts && inst.parts.cockpit, m = p && p['3dmodel'] && p['3dmodel']._model;
    if (!m) { lightMsg('Cockpit is not loaded.'); return false; }
    if (!window.Cesium || !Cesium.CustomShader || !('customShader' in m)) { lightMsg('This GeoFS version does not support cockpit lights.'); return false; }
    try {
      if (on) {
        var L = state.lights, U = Cesium.UniformType;
        lightShader = new Cesium.CustomShader({
          uniforms: {
            u_p1: { type: U.VEC3, value: c3(L.l1) }, u_p2: { type: U.VEC3, value: c3(L.l2) },
            u_d1: { type: U.VEC3, value: c3(dir(L.l1, L.aim)) }, u_d2: { type: U.VEC3, value: c3(dir(L.l2, L.aim)) },
            u_r: { type: U.FLOAT, value: L.r }, u_i: { type: U.FLOAT, value: L.i }
          },
          fragmentShaderText: LIGHT_GLSL
        });
        m.customShader = lightShader;
        lightMsg('Lights on.');
      } else {
        m.customShader = undefined; lightShader = null; lightMsg('Lights off.');
      }
    } catch (e) { log('lights failed', e); lightMsg('Error: ' + e.message); return false; }
    return true;
  }

  // ---------- cockpit loader ----------
  function loadOurCockpit(inst) {
    return new Promise(function (resolve) {
      if (inst._cockpitLoaded) { resolve(); return; }
      var parts = buildParts(state.url, inst);
      inst.cockpitSetup = { parts: parts };
      inst._cockpitLoaded = true;
      try {
        // A stale PFD renderer left in GeoFS's registry makes our screens reuse a canvas nobody draws into (frozen display).
        try { var RI = instruments.rendererInstancesByName; if (RI) ['PFDAirbus', 'PFDBoeing'].forEach(function (n) { if (RI[n]) delete RI[n]; }); } catch (e) { log('renderer registry reset failed', e); }
        inst.addParts(parts, '', 1, inst.definition.orientation);
        inst.object3d.compute(inst.llaLocation);
        inst.placeParts();
        inst.render();
        applyTune(inst);
        // Apply the correct initial visibility immediately; the watchdog keeps it in sync
        // when the user changes between cockpit and external camera views.
        try { reassert(); } catch (e) { log('initial visibility update failed', e); }
        try { inst.loadLivery(inst.liveryId); inst.updateEmission(geofs.isNight); } catch (e) {}
        state.loaded = true;
        try { hideStockCockpit(inst); } catch (e) { log('hideStockCockpit failed', e); }
        try { registerClicks(inst); } catch (e) { log('registerClicks failed', e); }
        try { scheduleReapply(); startWatchdog(); } catch (e) {}
        lightShader = null;
        if (state.lights.on) setLights(true);
        log('cockpit loaded for', inst.aircraftRecord.id);
      } catch (e) {
        log('cockpit load failed', e);
      }
      setStatus();
      resolve();
    });
  }

  function install() {
    var inst = geofs.aircraft.instance, proto = Object.getPrototypeOf(inst);
    if (proto.__a320cp) return;
    var orig = proto.loadCockpit;
    proto.loadCockpit = function () {
      var id = String(this.aircraftRecord && this.aircraftRecord.id);
      if (state.url && state.ids.indexOf(id) !== -1) return loadOurCockpit(this);
      return orig.apply(this, arguments);
    };
    proto.__a320cp = true;
    log('loader installed');
  }

  // ---------- recolor sticks (patch the GLB materials before loading) ----------
  var BLACK_NODES = ['Object_61', 'Object_63'];
  function patchGLB(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      if (dv.getUint32(0, true) !== 0x46546C67) return blob;
      var jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
      var mi = (json.materials = json.materials || []).length;
      mi = json.materials.push({ name: 'a320cp-black', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.012, 0.012, 0.014, 1], metallicFactor: 0.55, roughnessFactor: 0.16 } }) - 1;
      var n = 0;
      function fix(ni) {
        var nd = json.nodes[ni]; if (!nd) return;
        if (nd.mesh != null) {
          var m = JSON.parse(JSON.stringify(json.meshes[nd.mesh]));
          m.primitives.forEach(function (pr) { pr.material = mi; });
          nd.mesh = json.meshes.push(m) - 1; n++;
        }
        (nd.children || []).forEach(fix);
      }
      json.nodes.forEach(function (nd, i) { if (BLACK_NODES.indexOf(nd.name) !== -1) fix(i); });
      if (!n) return blob;
      var js = JSON.stringify(json); while (js.length % 4) js += ' ';
      var jb = new TextEncoder().encode(js), rest = buf.slice(20 + jl);
      var head = new ArrayBuffer(20), hv = new DataView(head);
      hv.setUint32(0, 0x46546C67, true); hv.setUint32(4, 2, true); hv.setUint32(8, 20 + jb.length + rest.byteLength, true);
      hv.setUint32(12, jb.length, true); hv.setUint32(16, 0x4E4F534A, true);
      return new Blob([head, jb, rest], { type: 'model/gltf-binary' });
    }).catch(function (e) { log('patchGLB failed', e); return blob; });
  }
  function setGlbBlob(b) { return patchGLB(b).then(function (pb) { state.url = URL.createObjectURL(pb); }); }

  // ---------- storage for the GLB (so it survives reloads) ----------
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('a320cp', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('f'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res, rej) { var q = db.transaction('f').objectStore('f').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }
  function idbPut(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('f', 'readwrite'); tx.objectStore('f').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }

  // ---------- panel ----------
  var panel, statusEl, pending = false;
  function setStatus() {
    if (!statusEl) return;
    var inst = window.geofs && geofs.aircraft && geofs.aircraft.instance;
    var id = inst && inst.aircraftRecord ? String(inst.aircraftRecord.id) : '?';
    var match = state.ids.indexOf(id) !== -1;
    statusEl.textContent = 'Model: ' + (state.url ? 'loaded' : 'missing') + ' · Aircraft ID: ' + id + (match ? ' (supported)' : ' (not enabled)') + ' · Cockpit: ' + (state.loaded ? 'loaded' : 'not loaded') + (pending ? ' · Press Apply to reload' : '');
  }
  function mk(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'style') e.style.cssText = props[k]; else e[k] = props[k]; });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function flash(btn, txt) { var o = btn.textContent; btn.textContent = txt; setTimeout(function () { btn.textContent = o; }, 1500); }
  function copyText(txt, btn) {
    var ok = function () { flash(btn, 'Copied'); };
    var fallback = function () { var t = mk('textarea', { value: txt }); document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) { flash(btn, 'Failed'); } t.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fallback); else fallback();
  }

  function diagnostics() {
    var inst = geofs.aircraft.instance, out = [];
    ['placePart', 'addOffsets', 'render', 'unloadAircraft'].forEach(function (n) { out.push('// instance.' + n + '\n' + String(inst[n])); });
    try { out.push('// Object3D methods\n' + Object.getOwnPropertyNames(Object3D.prototype).join(', ')); } catch (e) {}
    try { out.push('// version\n' + String(geofs.version) + ' | ' + location.href + ' | isCommunity ' + inst.aircraftRecord.isCommunity); } catch (e) {}
    try {
      var rows = Object.keys(inst.parts || {}).map(function (k) {
        var q = inst.parts[k] || {}, m = q.model, url = (m && (m.url || (typeof m === 'string' ? m : ''))) || (q.gltf2model && q.gltf2model.url) || '';
        return { n: k, parent: q.parent, type: q.type, url: String(url).slice(0, 80), vis: q.object3d && q.object3d.visible, an: (q.animations || []).slice(0, 3).map(function (a) { return a.type + ':' + a.value + (a.notEq != null ? '!=' + a.notEq : '') + (a.eq != null ? '=' + a.eq : ''); }) };
      });
      out.push('// ALL PARTS (' + rows.length + ')\n' + JSON.stringify(rows).slice(0, 16000));
      var d = inst.definition || {};
      out.push('// definition keys\n' + Object.keys(d).join(', ') + '\n// cockpitSetup\n' + JSON.stringify(d.cockpitSetup) + '\n// cockpit def\n' + String(JSON.stringify(d.cockpit)).slice(0, 1500));
    } catch (e) { out.push('// parts dump error ' + e.message); }
    try {
      var dom = Array.prototype.slice.call(document.querySelectorAll('[class*="instrument"],[id*="instrument"],[class*="hud"],[id*="hud"],[class*="Hud"],[id*="Hud"]')).filter(function (e) { return e.offsetWidth || e.offsetHeight; })
        .slice(0, 25).map(function (e) { var r = e.getBoundingClientRect(); return { tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 80), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
      out.push('// visible instrument/HUD DOM elements\n' + JSON.stringify(dom));
      var dd = inst.definition || {};
      out.push('// definition.instruments / hud\n' + JSON.stringify({ instruments: dd.instruments, hud: dd.hud, HUD: dd.HUD, panel: dd.panel }).slice(0, 2000));
      out.push('// geofs.instruments keys\n' + (geofs.instruments ? Object.keys(geofs.instruments).slice(0, 40).join(', ') : 'none'));
    } catch (e) { out.push('// dom diag error ' + e.message); }
    var p = inst.parts && inst.parts.cockpit;
    out.push('// cockpit part\n' + JSON.stringify(p ? { position: p.position, scale: p.scale, rotation: p.rotation } : null));
    out.push('// screens\n' + JSON.stringify(SCREEN_NAMES.map(function (n) { var q = inst.parts && inst.parts[n]; return q ? { name: n, position: q.position, scale: q.scale, rotation: q.rotation, hasRenderer: !!q.rendererInstance } : { name: n, missing: true }; })));
    out.push('// screen animations (read while flying)\n' + JSON.stringify(SCREEN_NAMES.map(function (n) {
      var q = inst.parts && inst.parts[n]; if (!q) return { name: n, missing: true };
      var r = q.rendererInstance;
      return { name: n, visible: q.object3d && q.object3d.visible, anims: (q.animations || []).map(function (a) { var v; try { v = geofs.animation.filter(a); } catch (e) { v = 'err'; } return { type: a.type, value: a.value, current: a.currentValue, now: v }; }),
        rendererKeys: r ? Object.keys(r) : null, rendererExported: r && r.exported };
    })));
    try {
      var rq = inst.parts && inst.parts[SCREEN_NAMES[0]] && inst.parts[SCREEN_NAMES[0]].rendererInstance;
      if (rq) {
        var pr = Object.getPrototypeOf(rq);
        out.push('// renderer\n' + JSON.stringify({ own: Object.keys(rq), proto: Object.getOwnPropertyNames(pr), definition: rq.definition && Object.keys(rq.definition), reuse: rq.reuseExistingRenderer }));
        out.push('// renderer.update\n' + String(rq.update).slice(0, 2500));
        if (pr.init) out.push('// renderer.init\n' + String(pr.init).slice(0, 2500));
      }
      var ap = String(inst.addParts), ri = ap.indexOf('renderer');
      out.push('// addParts around renderer\n' + (ri >= 0 ? ap.slice(Math.max(0, ri - 600), ri + 1800) : 'no renderer mention; len ' + ap.length));
    } catch (e) { out.push('// renderer diag error ' + e.message); }
    out.push('// airbus PFD include\n' + (function () { try { return JSON.stringify(geofs.includes['3d-AirbusPFD'], function (k, v) { return typeof v === 'function' ? 'fn' : v; }).slice(0, 3000); } catch (e) { return 'err ' + e.message; } })());
    out.push('// child parts of screens\n' + JSON.stringify(Object.keys(inst.parts || {}).filter(function (k) { return k.indexOf('a320PFD') === 0; })));
    out.push('// lights\n' + JSON.stringify({ shader: !!lightShader, lights: state.lights }));
    out.push('// levers\n' + JSON.stringify(LEVER_NAMES.map(function (n) { var q = inst.parts && inst.parts[n]; return q ? { name: n, position: q.position, rotation: q.rotation, scale: q.scale } : { name: n, missing: true }; })));
    out.push('// clicklog\n' + JSON.stringify(clickLog));
    out.push('// includes\n' + JSON.stringify(window.geofs && geofs.includes ? Object.keys(geofs.includes).filter(function (k) { return /pfd|nd|ecam|airbus/i.test(k); }) : null));
    out.push('// audio\n' + JSON.stringify({ chain: !!audioFx.chain, ambience: !!audioFx.amb, ctxState: audioFx.ctx && audioFx.ctx.state, mode: geofs.camera.currentModeName, audioKeys: window.audio ? Object.keys(audio) : null }));
    try { var m = p && p['3dmodel'] && p['3dmodel']._model; out.push('// cesium\n' + JSON.stringify({ customShader: !!(window.Cesium && Cesium.CustomShader), modelHasCustomShader: !!(m && 'customShader' in m), cesium: window.Cesium && Cesium.VERSION })); } catch (e) {}
    out.push('// state\n' + JSON.stringify({ tune: state.tune, screens: state.screens, levers: state.levers, lights: state.lights, sound: state.sound, ids: state.ids, loaded: state.loaded, cam: inst.definition.cameras.cockpit }));
    return out.join('\n\n');
  }

  var INPUT_STYLE = 'width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #555;padding:2px';
  function numField(grid, label, obj, key, idx, step, onchange) {
    var cur = idx == null ? obj[key] : obj[key][idx];
    var inp = mk('input', { type: 'number', value: cur, step: step, style: INPUT_STYLE });
    inp.oninput = function () {
      var v = parseFloat(inp.value); if (isNaN(v)) return;
      if (idx == null) obj[key] = v; else obj[key][idx] = v;
      onchange();
    };
    grid.appendChild(mk('label', { textContent: label })); grid.appendChild(inp);
    return inp;
  }
  function section(title, kids) {
    var d = mk('details', { style: 'margin-top:8px;border-top:1px solid #444;padding-top:6px' }, [mk('summary', { textContent: title, style: 'cursor:pointer;font-weight:600' })]);
    kids.forEach(function (k) { d.appendChild(k); });
    return d;
  }
  function gridEl() { return mk('div', { style: 'display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px 6px;align-items:center;margin-top:6px' }); }

  function buildPanel() {
    statusEl = mk('div', { style: 'margin:4px 0 6px;opacity:.85' });
    var fileIn = mk('input', { type: 'file', accept: '.glb', style: 'display:none' });
    var pick = mk('button', { textContent: 'Choose cockpit.glb' });
    pick.onclick = function () { fileIn.click(); };
    fileIn.onchange = function () {
      var f = fileIn.files[0]; if (!f) return;
      idbPut('glb', f).catch(function (e) { log('could not store GLB', e); });
      setGlbBlob(f).then(function () { setStatus(); flash(pick, 'Done. Re-select the aircraft'); });
    };
    var useId = mk('button', { textContent: 'Enable for this aircraft' });
    useId.onclick = function () {
      var id = String(geofs.aircraft.instance.aircraftRecord.id);
      if (state.ids.indexOf(id) === -1) state.ids.push(id);
      lsSet('ids', state.ids); setStatus();
    };

    // --- cockpit placement ---
    var grid = gridEl(), inputs = {};
    [['scale', 'Scale', 0.05], ['rx', 'Rot X°', 90], ['ex', 'Eye X', 0.01], ['ry', 'Rot Y°', 90], ['ey', 'Eye Y', 0.01], ['rz', 'Rot Z°', 90], ['ez', 'Eye Z', 0.01], ['dx', 'Offset X', 0.1], ['dy', 'Offset Y', 0.1], ['dz', 'Offset Z', 0.1]].forEach(function (d) {
      inputs[d[0]] = numField(grid, d[1], state.tune, d[0], null, d[2], function () {
        saveOpts();
        if (d[0] === 'scale') applyTune(); else { applyLive(); pending = true; setStatus(); }
      });
    });
    function setRot(rx, ry, rz) {
      state.tune.rx = rx; state.tune.ry = ry; state.tune.rz = rz; saveOpts();
      inputs.rx.value = rx; inputs.ry.value = ry; inputs.rz.value = rz;
    }
    function applyAndReload() {
      var inst = geofs.aircraft.instance;
      saveOpts(); pending = false; state.loaded = false; setStatus();
      try { inst.change(inst.id, null, true); } catch (e) { log('reload failed', e); statusEl.textContent = 'Could not reload automatically. Switch to another aircraft and back.'; }
    }
    // All 24 ways to turn the model by multiples of 90 degrees; the right one is among them.
    var ORIENTS = (function () {
      var seen = {}, list = [], a, b, c;
      for (a = 0; a < 4; a++) for (b = 0; b < 4; b++) for (c = 0; c < 4; c++) {
        var key = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(function (v) { return rotateVec(v, a * 90, b * 90, c * 90).map(Math.round).join(','); }).join('|');
        if (!seen[key]) { seen[key] = 1; list.push([a * 90, b * 90, c * 90]); }
      }
      return list;
    })();
    var oi = 0;
    ORIENTS.forEach(function (o, i) { if (o[0] === state.tune.rx && o[1] === state.tune.ry && o[2] === state.tune.rz) oi = i; });
    var oLabel = mk('span', { style: 'align-self:center' });
    function showO() { oLabel.textContent = 'Orientation ' + (oi + 1) + '/' + ORIENTS.length; }
    function stepO(d) { oi = (oi + d + ORIENTS.length) % ORIENTS.length; setRot(ORIENTS[oi][0], ORIENTS[oi][1], ORIENTS[oi][2]); showO(); applyAndReload(); }
    showO();
    var prevO = mk('button', { textContent: '◀ Prev' }); prevO.onclick = function () { stepO(-1); };
    var nextO = mk('button', { textContent: 'Next ▶' }); nextO.onclick = function () { stepO(1); };
    var presets = mk('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center' }, [oLabel, prevO, nextO]);
    var applyBtn = mk('button', { textContent: 'Apply (reloads aircraft)', style: 'font-weight:600' });
    applyBtn.onclick = applyAndReload;

    var outside = mk('button', { textContent: 'Show cockpit from outside: off' });
    var showOut = false;
    outside.onclick = function () {
      var p = geofs.aircraft.instance.parts && geofs.aircraft.instance.parts.cockpit; if (!p || !p.animations[0]) return;
      showOut = !showOut;
      var a = p.animations[0];
      if (showOut) { delete a.notEq; a.eq = '__never__'; } else { delete a.eq; a.notEq = 'cockpit'; }
      outside.textContent = 'Show cockpit from outside: ' + (showOut ? 'on' : 'off');
    };
    var placement = section('Placement', [presets, grid, mk('div', { style: 'margin-top:6px' }, [applyBtn]), mk('div', { style: 'margin-top:6px' }, [outside])]);
    placement.open = true;

    // --- screens ---
    var sg = gridEl(), scr = state.screens;
    var sChange = function () { applyScreens(); pending = true; setStatus(); };
    numField(sg, 'Size', scr, 'ss', null, 0.01, sChange);
    numField(sg, 'Posfaktor', scr, 'cs', null, 0.1, sChange);
    numField(sg, 'Lutning°', scr, 'tilt', null, 5, sChange);
    numField(sg, 'Vridning°', scr, 'yaw', null, 90, sChange);
    ['x', 'y', 'z'].forEach(function (a, i) { numField(sg, 'PFD left ' + a, scr, 'pfd1', i, 0.01, sChange); numField(sg, 'PFD right ' + a, scr, 'pfd2', i, 0.01, sChange); });
    var scrToggle = mk('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px' }, [mk('input', { type: 'checkbox', checked: scr.on }), 'Show PFD screens (needs Apply)']);
    scrToggle.firstChild.onchange = function () { scr.on = this.checked; saveOpts(); pending = true; setStatus(); };
    var screensSec = section('Screens (PFD)', [scrToggle, sg, mk('div', { style: 'margin-top:4px;opacity:.7' }, ['Position in model coordinates.'])]);

    // --- lights ---
    var lg = gridEl(), L = state.lights;
    lightMsgEl = mk('div', { style: 'margin-top:4px;opacity:.8' });
    var lChange = function () { updateLights(); };
    numField(lg, 'Strength', L, 'i', null, 0.1, lChange);
    numField(lg, 'Reach', L, 'r', null, 0.05, lChange);
    ['x', 'y', 'z'].forEach(function (a, i) { numField(lg, 'Light 1 ' + a, L, 'l1', i, 0.01, lChange); numField(lg, 'Light 2 ' + a, L, 'l2', i, 0.01, lChange); });
    ['x', 'y', 'z'].forEach(function (a, i) { numField(lg, 'Aim ' + a, L, 'aim', i, 0.01, lChange); });
    var lightBtn = mk('button', { textContent: 'Cockpit lights: ' + (L.on ? 'ON' : 'OFF') });
    lightBtn.onclick = function () { var want = !state.lights.on; if (setLights(want)) lightBtn.textContent = 'Cockpit lights: ' + (want ? 'ON' : 'OFF'); };
    var lightsSec = section('Ceiling lights', [mk('div', { style: 'margin-top:6px' }, [lightBtn]), lg, lightMsgEl]);

    // --- move objects: pick one, drag sliders ---
    var MOVABLE = [['Ceiling light 1', state.lights, 'l1'], ['Ceiling light 2', state.lights, 'l2'], ['Ceiling light: aim point', state.lights, 'aim'],
      ['PFD left', state.screens, 'pfd1'], ['PFD right', state.screens, 'pfd2'],
      ['Throttle left', state.levers, 'thrL'], ['Throttle right', state.levers, 'thrR'], ['Flap lever', state.levers, 'flaps']];
    var mvSel = mk('select', { style: INPUT_STYLE }), mvBox = mk('div', { style: 'margin-top:6px' });
    MOVABLE.forEach(function (m, i) { mvSel.appendChild(mk('option', { value: i, textContent: m[0] })); });
    var mvRows = [];
    function mvApply(m) { if (m[1] === state.lights) updateLights(); else applyScreens(); }
    ['x (left/right)', 'y (up/down)', 'z (fwd/aft)'].forEach(function (lab, ax) {
      var lbl = mk('span', { textContent: lab, style: 'min-width:78px' });
      var rng = mk('input', { type: 'range', style: 'width:100%' }), num = mk('input', { type: 'number', step: 'any', style: 'width:70px;background:#111;color:#eee;border:1px solid #555' });
      var row = mk('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:4px' }, [lbl, rng, num]);
      function set(v) { var m = MOVABLE[mvSel.value]; m[1][m[2]][ax] = v; num.value = m[3] ? String(Math.round(v)) : v.toFixed(3); mvApply(m); }
      rng.oninput = function () { set(parseFloat(rng.value)); };
      num.oninput = function () { var v = parseFloat(num.value); if (!isNaN(v)) { set(v); rng.value = v; } };
      mvRows.push({ rng: rng, num: num, lbl: lbl, row: row, pos: lab, rot: ['vrid x°', 'vrid y°', 'vrid z°'][ax] });
      mvBox.appendChild(row);
    });
    function mvLoad(init) {
      var m = MOVABLE[mvSel.value];
      mvRows.forEach(function (r, ax) {
        var v = m[1][m[2]][ax], deg = !!m[3];
        r.lbl.textContent = deg ? (m[3] === 2 ? 'lutning°' : r.rot) : r.pos;
        r.row.style.display = (m[3] === 2 && ax !== 1) ? 'none' : 'flex';
        r.rng.min = deg ? -180 : v - 0.6; r.rng.max = deg ? 180 : v + 0.6; r.rng.step = deg ? 1 : 0.002; r.rng.value = v; r.num.value = deg ? String(Math.round(v)) : v.toFixed(3);
      });
    }
    mvSel.onchange = function () { mvLoad(false); }; mvLoad(true);
    var moveSec = section('Move objects (select + drag)', [mk('div', { style: 'margin-top:6px' }, [mvSel]), mvBox,
      mk('div', { style: 'margin-top:4px;opacity:.7' }, ['Applies to lights, screens and levers.'])]);
    moveSec.open = true;

    // --- levers ---
    var vg = gridEl(), V = state.levers;
    var vChange = function () { applyScreens(); };
    function leverAnim() {
      saveOpts();
      var inst = geofs.aircraft.instance, q;
      [['a320ThrottleL', -V.thrAngle, V.thrIdle], ['a320ThrottleR', -V.thrAngle, V.thrIdle], ['a320Flaps', V.flapStep, 0]].forEach(function (d) {
        q = inst.parts && inst.parts[d[0]]; if (q && q.animations && q.animations[0]) { q.animations[0].ratio = d[1]; q.animations[0].offset = d[2]; }
      });
    }
    numField(vg, 'Size', V, 'ls', null, 0.05, vChange);
    numField(vg, 'Throttle max°', V, 'thrAngle', null, 5, leverAnim);
    numField(vg, 'Throttle idle°', V, 'thrIdle', null, 1, leverAnim);
    numField(vg, 'Flap step°', V, 'flapStep', null, 2, leverAnim);
    ['x', 'y', 'z'].forEach(function (a, i) {
      numField(vg, 'Throttle L ' + a, V, 'thrL', i, 0.005, vChange); numField(vg, 'Throttle R ' + a, V, 'thrR', i, 0.005, vChange);
      numField(vg, 'Flaps ' + a, V, 'flaps', i, 0.005, vChange); numField(vg, 'Rotate ' + a + '°', V, 'lrot', i, 90, vChange);
    });
    var levToggle = mk('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px' }, [mk('input', { type: 'checkbox', checked: V.on }), 'Show throttle and flap levers (needs Apply)']);
    levToggle.firstChild.onchange = function () { V.on = this.checked; saveOpts(); pending = true; setStatus(); };
    var pickBtn = mk('button', { textContent: 'Click log: off' });
    clickEl = mk('div', { style: 'margin-top:4px;opacity:.8' });
    pickBtn.onclick = function () { state.pickLog = !state.pickLog; pickBtn.textContent = 'Click log: ' + (state.pickLog ? 'on' : 'off'); };
    var leverSec = section('Throttle, flaps, clicks', [levToggle, vg, mk('div', { style: 'margin-top:6px' }, [pickBtn]), clickEl]);

    // --- sound ---
    var ag = gridEl(), S = state.sound;
    var aChange = function () { saveOpts(); };
    numField(ag, 'Muffling Hz', S, 'cutoff', null, 100, aChange);
    numField(ag, 'Volume', S, 'vol', null, 0.05, aChange);
    numField(ag, 'Wind', S, 'wind', null, 0.1, aChange);
    numField(ag, 'Air conditioning', S, 'ac', null, 0.1, aChange);
    numField(ag, 'Engine rumble', S, 'rumble', null, 0.1, aChange);
    var soundToggle = mk('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px' }, [mk('input', { type: 'checkbox', checked: S.on }), 'Cockpit sound (muffles outside sound in the cockpit view)']);
    soundToggle.firstChild.onchange = function () { S.on = this.checked; saveOpts(); };
    var soundSec = section('Sound', [soundToggle, ag, mk('div', { style: 'margin-top:4px;opacity:.7' }, ['Lower Hz gives a more muffled sound.'])]);

    var copyTune = mk('button', { textContent: 'Copy settings' });
    copyTune.onclick = function () { copyText(JSON.stringify({ tune: state.tune, screens: state.screens, levers: state.levers, lights: state.lights, sound: state.sound }), copyTune); };
    var copyDiag = mk('button', { textContent: 'Copy diagnostics' });
    copyDiag.onclick = function () { try { copyText(diagnostics(), copyDiag); } catch (e) { flash(copyDiag, 'Error: ' + e.message); } };

    // ---- simple controls (what a normal user sees) ----
    var rowStyle = 'display:flex;gap:8px;align-items:center;margin-top:8px';
    var simpleLight = mk('button', { textContent: 'Cockpit light: ' + (state.lights.on ? 'ON' : 'OFF') });
    simpleLight.onclick = function () {
      var want = !state.lights.on;
      if (setLights(want)) { simpleLight.textContent = 'Cockpit light: ' + (want ? 'ON' : 'OFF'); lightBtn.textContent = 'Cockpit lights: ' + (want ? 'ON' : 'OFF'); }
    };
    var bright = mk('input', { type: 'range', min: 0.1, max: 3, step: 0.05, value: state.lights.i, style: 'flex:1' });
    bright.oninput = function () { state.lights.i = parseFloat(bright.value); updateLights(); };
    var vol = mk('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: state.sound.vol, style: 'flex:1' });
    vol.oninput = function () { state.sound.vol = parseFloat(vol.value); saveOpts(); };
    var simpleSound = mk('label', { style: rowStyle }, [mk('input', { type: 'checkbox', checked: state.sound.on }), 'Cockpit sound']);
    simpleSound.firstChild.onchange = function () { state.sound.on = this.checked; saveOpts(); };
    var credit = mk('div', { style: 'margin-top:10px;font-size:10px;opacity:.75;line-height:1.4' }, [
      'Cockpit model "A320 Cockpit 2" by ',
      mk('a', { href: CREATOR_URL, target: '_blank', rel: 'noopener', textContent: CREATOR, style: 'color:#8cc8ff' }), ' (',
      mk('a', { href: MODEL_URL, target: '_blank', rel: 'noopener', textContent: 'Sketchfab', style: 'color:#8cc8ff' }), '), licensed under ',
      mk('a', { href: LICENSE_URL, target: '_blank', rel: 'noopener', textContent: 'CC BY 4.0', style: 'color:#8cc8ff' }),
      '. Changes: animations, instrument screens, levers, lights and sound added for GeoFS.'
    ]);

    var advanced = mk('details', { style: 'margin-top:10px;border-top:1px solid #444;padding-top:6px' }, [mk('summary', { textContent: 'Advanced / calibration', style: 'cursor:pointer;font-weight:600' })]);
    [mk('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px' }, [pick, useId, fileIn]), statusEl, placement, moveSec, screensSec, leverSec, lightsSec, soundSec,
      mk('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' }, [copyTune, copyDiag])].forEach(function (k) { advanced.appendChild(k); });

    var body = mk('div', { style: 'max-height:70vh;overflow:auto' }, [
      mk('div', { style: 'font-weight:600;font-size:13px' }, ['A320 Cockpit']),
      mk('div', { style: rowStyle }, [simpleLight]),
      mk('div', { style: rowStyle }, [mk('span', { textContent: 'Brightness', style: 'min-width:70px' }), bright]),
      simpleSound,
      mk('div', { style: rowStyle }, [mk('span', { textContent: 'Volume', style: 'min-width:70px' }), vol]),
      credit, advanced
    ]);
    panel = mk('div', { style: 'position:fixed;display:none;z-index:1000001;background:rgba(20,24,24,.95);color:#eee;font:12px system-ui,sans-serif;padding:10px;border:1px solid #444;border-radius:6px;width:320px;max-width:92vw;box-shadow:0 4px 18px rgba(0,0,0,.5)' }, [body]);
    panel.querySelectorAll('button').forEach(function (b) { b.style.cssText += ';font:inherit;background:#2a3330;color:#eee;border:1px solid #556;border-radius:3px;padding:3px 8px;cursor:pointer'; });
    document.body.appendChild(panel);
    setStatus();
    createMenuButton();
  }

  // Menu button next to the GeoFS menu buttons (same place and style as the A350 STARTUP button).
  function positionPanel(btn) {
    var r = btn.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 336)) + 'px';
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
  }
  function createMenuButton() {
    var tries2 = 0;
    var t = setInterval(function () {
      tries2++;
      if (document.getElementById('a320-cockpit-menu-button')) { clearInterval(t); return; }
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
      var find = function (txt) { return buttons.filter(function (b) { return (b.textContent || '').trim().toLowerCase() === txt; })[0]; };
      var ref = document.getElementById('a350-startup-menu-button') || find('camera') || find('location') || find('aircraft');
      if (ref) {
        clearInterval(t);
        var btn = document.createElement('button');
        btn.id = 'a320-cockpit-menu-button'; btn.type = 'button'; btn.className = 'mdl-button mdl-js-button';
        btn.textContent = 'COCKPIT'; btn.style.cssText = 'position:relative;z-index:1000000;white-space:nowrap';
        btn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var open = panel.style.display === 'none';
          panel.style.display = open ? 'block' : 'none';
          if (open) positionPanel(btn);
        });
        ref.insertAdjacentElement('afterend', btn);
        if (window.componentHandler && window.componentHandler.upgradeElement) { try { window.componentHandler.upgradeElement(btn); } catch (e) {} }
        document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') panel.style.display = 'none'; });
      } else if (tries2 > 120) { clearInterval(t); }
    }, 500);
  }

  // ---------- start ----------
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.geofs && geofs.aircraft && geofs.aircraft.instance && geofs.aircraft.instance.loadCockpit && document.body) {
      clearInterval(timer);
      install();
      idbGet('glb').then(function (b) { if (b) return setGlbBlob(b); }).catch(function () {}).then(function () { buildPanel(); });
      setInterval(function () { try { tickAudio(); } catch (e) {} }, 200);
      installPickLog();
      window.A320CP = { state: state, applyTune: applyTune, diagnostics: diagnostics, audio: audioFx };
    } else if (tries > 240) { clearInterval(timer); }
  }, 500);
})();
