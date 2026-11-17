// SOLMAR BAY — open-world crime game. Entry point + main loop.
import * as THREE from 'three';
import { RNG, clamp, lerp, angleLerp, dist2 } from './rng.js';
import { createCity, collideBuildings, CITY } from './world.js';
import { createEntities, updatePlayer, updateTraffic, updatePeds, updatePolice, enterCar, exitCar, damagePlayer, knockPed, addWanted, makeCarMesh } from './entities.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';

window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push(String(e.message || e.error));
  const d = document.getElementById('err');
  if (d) d.textContent = window.__errors.join(' | ');
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push('rejection: ' + String(e.reason));
});

const params = new URLSearchParams(location.search);
const AUTO = params.get('auto') === '1';
const SCENE = params.get('scene') || params.get('shot') || '';
const WANTED0 = parseInt(params.get('wanted') || '0', 10) || 0;
const MISSION0 = parseInt(params.get('mission') || '0', 10) || 0;
const TOD0 = params.get('tod') !== null ? parseFloat(params.get('tod')) : 0.3;

const G = {
  time: 0,
  state: 'menu', // menu | playing | paused | busted | wasted | complete
  money: 0,
  wanted: 0,
  lastCrimeAt: -999,
  decayTimer: 0,
  prompt: '',
  nearCar: null,
  storyDone: false,
  camYaw: Math.PI,   // camera behind player facing north (-z is forward when yaw=PI? see below)
  camPitch: 0.32,
  camDist: 10,
  tod: TOD0,         // 0..1, 0 = dawn, 0.5 = noon, 0.75 = dusk, 1 = midnight
  input: { f: false, b: false, l: false, r: false, sprint: false, e: false, handbrake: false },
  fps: 0,
};

G.player = {
  pos: new THREE.Vector3(-126, 0, 156),
  heading: Math.PI,
  health: 100,
  inCar: false,
  car: null,
  moving: false,
  damageFlash: 0,
  mesh: null,
};

G.audio = new AudioSys();

// ---------- save / load ----------
const SAVE_KEY = 'solmarbay-save-v1';
G.save = function () {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money, idx: G.missions ? G.missions.idx : 0,
      health: G.player.health, storyDone: G.storyDone,
      px: G.player.pos.x, pz: G.player.pos.z,
    }));
  } catch (e) { /* storage unavailable (file:// in some browsers) */ }
};
G.loadSave = function () {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return s;
  } catch (e) { return null; }
};
G.clearSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} };

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
G.scene = scene;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
G.camera = camera;

const hemi = new THREE.HemisphereLight(0xbfd8ee, 0x4a4f55, 1.0);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x4a5560, 0.85);
scene.add(amb);
const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 500;
scene.add(sun);
scene.add(sun.target);
G.sun = sun; G.hemi = hemi;

G.city = createCity(scene);
createEntities(G);
// guaranteed parked car near spawn so mission 1 is quick (on road x=-130)
{
  const mesh = makeCarMesh(0xc0392b);
  mesh.group.position.set(-125.4, 0, 148);
  mesh.group.rotation.y = 0;
  scene.add(mesh.group);
  G.parked.push({
    pos: new THREE.Vector3(-125.4, 0, 148), heading: 0, mesh,
    color: 0xc0392b, owned: false, speed: 0,
  });
}
G.missions = new Missions(G);
G.hud = new HUD(G);

// ---------- day / night ----------
const DAY_SKY = new THREE.Color(0x87b5d6);
const DUSK_SKY = new THREE.Color(0xe8905a);
const NIGHT_SKY = new THREE.Color(0x0a1220);
function updateDayNight(dt) {
  G.tod = (G.tod + dt / 240) % 1; // full cycle every 4 minutes
  const t = G.tod;
  // sun elevation from the cycle angle: 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
  const ang = t * Math.PI * 2 - Math.PI / 2;
  const elev = Math.sin(ang);
  const dayF = clamp((elev + 0.06) / 0.3, 0, 1);
  const nightF = 1 - dayF;
  const dir = new THREE.Vector3(Math.cos(ang), Math.max(0.12, elev), 0.55).normalize();
  const px = G.player ? G.player.pos.x : 0;
  const pz = G.player ? G.player.pos.z : 0;
  sun.position.set(px + dir.x * 220, dir.y * 220, pz + dir.z * 220);
  sun.target.position.set(px, 0, pz);
  sun.intensity = 0.3 + dayF * 1.6;
  sun.color.setHex(dayF > 0.5 ? 0xffe0b0 : 0xff9a5a);
  hemi.intensity = 0.35 + dayF * 0.65;
  const sky = new THREE.Color().copy(DAY_SKY);
  if (elev > -0.05 && elev < 0.25) sky.lerp(DUSK_SKY, clamp((0.25 - elev) / 0.3, 0, 0.7));
  else if (elev <= -0.05) sky.lerp(NIGHT_SKY, clamp((-elev - 0.05) / 0.2, 0, 1));
  scene.background = sky;
  G.city.setNight(nightF);
  scene.fog = new THREE.Fog(sky.getHex(), 260, 900);
}

// ---------- input ----------
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'e', Space: 'handbrake',
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  const k = KEYMAP[e.code];
  if (k) G.input[k] = true;
  if (e.repeat) return;
  if (e.code === 'KeyM') G.audio.setMuted(!G.audio.muted);
  if (e.code === 'KeyF') doPunch();
  if (e.code === 'KeyE') doInteract();
  if (e.code === 'KeyN') doNextMission();
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) G.input[k] = false;
});

function doPunch() {
  if (G.state !== 'playing' || G.player.inCar) return;
  const p = G.player;
  const targets = [...G.peds.filter((x) => x.state !== 'down'), ...G.cops];
  let best = null, bestD = 2.6;
  for (const t of targets) {
    const d = dist2(p.pos.x, p.pos.z, t.pos.x, t.pos.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  if (!best) return;
  G.audio.punch();
  if (best.state !== undefined && best.mesh) {
    knockPed(G, best, p.pos);
  } else {
    best.pos.x += Math.sin(p.heading) * 3;
    best.pos.z += Math.cos(p.heading) * 3;
  }
  addWanted(G, 1, 'assault');
  G.hud.toast('You threw a punch. Someone saw that.');
}

function doInteract() {
  if (G.state !== 'playing') return;
  const p = G.player;
  // robbing takes priority over exiting the car
  if (G.missions.holdTarget) return;
  if (p.inCar) { exitCar(G); return; }
  if (G.nearCar) { enterCar(G, G.nearCar); return; }
}

function doNextMission() {
  if (G.state !== 'playing') return;
  if (G.missions.pendingNext || G.missions.pendingRetry) {
    G.missions.pendingNext = false;
    G.missions.pendingRetry = false;
    G.missions.startMission(G.missions.idx);
  }
}

function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
    G.hud.showPaused();
  } else if (G.state === 'paused') {
    G.state = 'playing';
    G.hud.hidePaused();
  }
}

// mouse camera: drag to orbit; wheel zooms
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  G.camYaw -= (e.clientX - lastX) * 0.005;
  G.camPitch = clamp(G.camPitch + (e.clientY - lastY) * 0.004, 0.08, 1.1);
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('wheel', (e) => {
  G.camDist = clamp(G.camDist + e.deltaY * 0.01, 6, 18);
}, { passive: true });

// ---------- camera ----------
function updateCamera(dt) {
  const p = G.player;
  // when driving and not dragging, ease camera behind the car
  if (p.inCar && !dragging) {
    const targetYaw = p.heading + Math.PI;
    G.camYaw = angleLerp(G.camYaw, targetYaw, Math.min(1, dt * 1.2));
  }
  const dist = p.inCar ? G.camDist + 3 : G.camDist;
  const cx = p.pos.x + Math.sin(G.camYaw) * Math.cos(G.camPitch) * dist;
  const cz = p.pos.z + Math.cos(G.camYaw) * Math.cos(G.camPitch) * dist;
  const cy = 2.2 + Math.sin(G.camPitch) * dist;
  // pull the camera in if a building blocks the view (sample along the ray)
  const hx = p.pos.x, hy = 2.2, hz = p.pos.z;
  let t = 1;
  for (let s = 1; s >= 0.2; s -= 0.1) {
    const qx = hx + (cx - hx) * s, qy = hy + (cy - hy) * s, qz = hz + (cz - hz) * s;
    let inside = false;
    for (const b of G.city.buildings) {
      if (qx > b.minX - 0.4 && qx < b.maxX + 0.4 && qz > b.minZ - 0.4 && qz < b.maxZ + 0.4 && qy < b.h + 1) {
        inside = true; break;
      }
    }
    if (!inside) { t = s; break; }
    t = s;
  }
  const camPos = new THREE.Vector3(hx + (cx - hx) * t, hy + (cy - hy) * t, hz + (cz - hz) * t);
  // never leave the camera inside a building: push it out of any AABB
  collideBuildings(camPos, 1.2, G.city.buildings);
  camPos.y = Math.max(camPos.y, 1.6);
  camera.position.copy(camPos);
  camera.lookAt(p.pos.x, 2.0, p.pos.z);
}

// ---------- respawn ----------
function respawn(fine) {
  const p = G.player;
  if (p.inCar && p.car) { p.inCar = false; p.car = null; }
  p.pos.set(G.city.safehouse.x, 0, G.city.safehouse.z);
  p.heading = 0;
  p.health = 100;
  G.wanted = 0;
  G.money = Math.max(0, G.money - fine);
  G.audio.setEngine(0, false);
  G.audio.setSiren(false, 0);
  p.mesh.position.copy(p.pos);
  G.hud.hideBusted(); G.hud.hideWasted();
  G.state = 'playing';
  if (G.missions.active) {
    const idx = G.missions.idx;
    G.missions.active = null;
    G.missions.clearMarker();
    G.missions.startMission(idx);
  }
  G.hud.toast('Back on the streets. Mara is not impressed.');
  G.save();
}

// ---------- menu wiring ----------
const hasSave = !!G.loadSave();
G.hud.showMenu(hasSave);
document.getElementById('btn-start').addEventListener('click', () => startFresh());
document.getElementById('btn-continue').addEventListener('click', () => continueSave());
document.getElementById('btn-resume').addEventListener('click', () => {
  G.hud.hidePaused(); G.state = 'playing';
});
document.getElementById('btn-retry').addEventListener('click', () => respawn(100));
document.getElementById('btn-retry2').addEventListener('click', () => respawn(50));
document.getElementById('btn-freeroam').addEventListener('click', () => {
  G.hud.hideComplete(); G.state = 'playing';
});
document.getElementById('btn-restart').addEventListener('click', () => {
  G.clearSave();
  location.reload();
});

function startFresh() {
  G.clearSave();
  G.money = 0;
  G.player.health = 100;
  G.player.pos.set(-126, 0, 156);
  G.player.heading = Math.PI;
  G.wanted = 0;
  G.storyDone = false;
  G.audio.init();
  G.hud.hideMenu();
  G.state = 'playing';
  G.missions.startMission(0);
  G.hud.toast('Welcome to Solmar Bay, Rook. Mara is calling.');
}

function continueSave() {
  const s = G.loadSave();
  if (!s) return startFresh();
  G.money = s.money || 0;
  G.player.health = s.health || 100;
  G.player.pos.set(s.px || -126, 0, s.pz || 156);
  G.storyDone = !!s.storyDone;
  G.audio.init();
  G.hud.hideMenu();
  G.state = 'playing';
  if (s.storyDone) {
    G.missions.idx = G.missions.list.length;
    G.hud.toast('Welcome back. The city is still yours.');
  } else {
    G.missions.startMission(s.idx || 0);
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let frames = 0, fpsTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  frames++; fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    G.fps = Math.round(frames / fpsTimer);
    frames = 0; fpsTimer = 0;
    document.title = 'SOLMAR BAY | ' + G.fps + 'fps | err ' + window.__errors.length + ' | ' + G.state;
  }
  if (G.state === 'playing') {
    G.time += dt;
    updatePlayer(G, dt, G.input);
    updateTraffic(G, dt);
    updatePeds(G, dt);
    updatePolice(G, dt);
    G.missions.update(dt);
    // health regen after 10s without damage
    if (G.player.health < 100 && G.time - (G.lastDamageAt || 0) > 10) {
      G.player.health = Math.min(100, G.player.health + dt * 2);
    }
    updateDayNight(dt);
    updateCamera(dt);
    G.hud.update(dt);
  } else if (G.state === 'menu') {
    // slow attract orbit around the city
    G.time += dt;
    const a = G.time * 0.05;
    camera.position.set(Math.cos(a) * 180, 90, Math.sin(a) * 180);
    camera.lookAt(0, 0, 0);
    updateDayNight(dt * 0.2);
  }
  renderer.render(scene, camera);
}

// ---------- debug / test hooks ----------
function applyScene() {
  const p = G.player;
  if (SCENE === 'drive') {
    // put player in the nearest parked car on a road
    const car = G.parked[0];
    p.pos.set(-26, 0, -78);
    enterCar(G, car);
    p.car.speed = 18;
  } else if (SCENE === 'chase') {
    p.pos.set(-26, 0, 0);
    G.wanted = 2;
    G.lastCrimeAt = G.time;
  } else if (SCENE === 'street') {
    p.pos.set(-26, 0, -26);
  } else if (SCENE === 'mission') {
    p.pos.set(-126, 0, 156);
  }
  if (WANTED0 > 0) { G.wanted = WANTED0; G.lastCrimeAt = G.time; }
}

if (AUTO) {
  G.audio.init();
  G.hud.hideMenu();
  G.state = 'playing';
  applyScene();
  if (MISSION0 > 0) G.missions.startMission(MISSION0 - 1);
  else if (SCENE === 'mission') G.missions.startMission(0);
  else if (SCENE === 'drive' || SCENE === 'street' || SCENE === 'chase') G.missions.startMission(0);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// expose for headless checks + scripted playtests
window.__game = G;
window.__debug = {
  pressE: () => doInteract(),
  pressN: () => doNextMission(),
  punch: () => doPunch(),
  holdW: (secs) => { G.input.f = true; setTimeout(() => { G.input.f = false; }, secs * 1000); },
  holdKeys: (keys, secs) => {
    for (const k of keys) G.input[k] = true;
    setTimeout(() => { for (const k of keys) G.input[k] = false; }, secs * 1000);
  },
  teleport: (x, z) => {
    G.player.pos.set(x, 0, z);
    if (G.player.inCar && G.player.car) {
      G.player.car.pos.set(x, 0, z);
      G.player.car.mesh.group.position.set(x, 0, z);
    }
    G.player.mesh.position.copy(G.player.pos);
  },
  state: () => ({
    state: G.state, money: G.money, wanted: G.wanted, health: Math.round(G.player.health),
    inCar: G.player.inCar, mission: G.missions.idx, missionActive: !!G.missions.active,
    pos: [Math.round(G.player.pos.x), Math.round(G.player.pos.z)],
    police: G.police.length, traffic: G.traffic.length, peds: G.peds.length,
    fps: G.fps, errors: window.__errors.length,
  }),
};

animate();
