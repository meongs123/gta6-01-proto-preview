// Player, cars, traffic, pedestrians, police + wanted system.
import * as THREE from 'three';
import { RNG, clamp, angleLerp, dist2 } from './rng.js';
import { collideBuildings, CITY } from './world.js';

const CAR_COLORS = [0xc0392b, 0x2e6fb0, 0xe0a83c, 0x3fae6a, 0xd8d8d8, 0x22262c, 0x7a4a9e, 0xc96a2b, 0x4aa8a0, 0xb03a5b];
const PED_SHIRTS = [0xd8d8d8, 0x3a6ea8, 0xc96a2b, 0x4a9e5c, 0x9e4a6a, 0x6a6a6a, 0xd8c93a];

// nearest road coordinate to a value (waypoint lookup)
function nearestRoad(v) {
  let best = CITY.roads[0];
  for (const r of CITY.roads) if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  return best;
}

// Extruded side-profile car body: rounded/beveled, sloped nose, glass cabin.
// profile points are [x = length (nose at +x), y = height]; extruded across the width.
function extrudeProfile(points, width, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, steps: 1,
  });
  // length (shape x) -> +Z (nose forward), width (extrude z) -> X, centered
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

const CAR_TYPES = ['sedan', 'sedan', 'hatch', 'van', 'truck'];
export function randomCarType(rng) { return rng.pick(CAR_TYPES); }

export function makeCarMesh(color, isPolice = false, type = 'sedan') {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101c26, roughness: 0.12, metalness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.6, metalness: 0.3 });

  // per-type silhouettes: [body profile, glass profile, half-length, wheel radius, wheel z]
  let bodyPts, glassPts, halfLen, wheelR, wheelZ;
  if (type === 'hatch') {
    bodyPts = [[-1.9, 0.28], [1.9, 0.28], [1.9, 0.58], [1.2, 0.85], [-1.5, 0.85], [-1.9, 0.6]];
    glassPts = [[0.9, 0.85], [0.2, 1.55], [-1.2, 1.55], [-1.6, 0.85]];
    halfLen = 1.9; wheelR = 0.36; wheelZ = 1.2;
  } else if (type === 'van') {
    bodyPts = [[-2.3, 0.28], [2.3, 0.28], [2.3, 0.9], [1.6, 1.15], [-2.0, 1.15], [-2.3, 0.9]];
    glassPts = [[1.5, 0.9], [1.05, 1.35], [-1.9, 1.35], [-1.9, 0.9]];
    halfLen = 2.3; wheelR = 0.4; wheelZ = 1.45;
  } else if (type === 'truck') {
    // cab up front, flatbed + cargo box behind
    bodyPts = [[-0.6, 0.3], [1.9, 0.3], [1.9, 0.7], [1.3, 1.05], [0.9, 1.5], [-0.6, 1.5]];
    glassPts = [[1.75, 0.75], [1.3, 1.45], [0.75, 1.45], [0.75, 0.75]];
    halfLen = 2.3; wheelR = 0.42; wheelZ = 1.45;
  } else { // sedan
    bodyPts = [[-2.2, 0.28], [2.2, 0.28], [2.2, 0.58], [1.5, 0.82], [-1.7, 0.82], [-2.2, 0.6]];
    glassPts = [[0.95, 0.82], [0.15, 1.48], [-0.95, 1.48], [-1.55, 0.82]];
    halfLen = 2.2; wheelR = 0.38; wheelZ = 1.45;
  }
  const bodyW = type === 'van' ? 2.05 : 2.0;
  const body = new THREE.Mesh(extrudeProfile(bodyPts, bodyW, 0.09), bodyMat);
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(extrudeProfile(glassPts, bodyW - 0.35, 0.05), glassMat);
  cabin.castShadow = true;
  g.add(cabin);
  if (type === 'truck') {
    // flatbed + cargo box behind the cab
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 2.4), trimMat);
    bed.position.set(0, 0.62, -1.25);
    g.add(bed);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.25, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x6a7a5a, roughness: 0.85, metalness: 0.05 }));
    cargo.position.set(0, 1.3, -1.25);
    cargo.castShadow = true;
    g.add(cargo);
  }
  // bumpers
  for (const z of [halfLen + 0.02, -halfLen - 0.02]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 0.28), trimMat);
    b.position.set(0, 0.36, z);
    g.add(b);
  }
  // grille + chrome strip (front)
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.08), trimMat);
  grille.position.set(0, 0.62, halfLen + 0.06);
  g.add(grille);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.3, metalness: 0.8 }));
  strip.position.set(0, 0.62, halfLen + 0.07);
  g.add(strip);
  // license plates (front + rear, on the bumper face)
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.2 });
  for (const z of [halfLen + 0.18, -halfLen - 0.18]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.04), plateMat);
    plate.position.set(0, 0.32, z);
    g.add(plate);
  }
  // wheel arches (body-color half-torus over each wheel)
  const archGeo = new THREE.TorusGeometry(wheelR + 0.1, 0.1, 6, 12, Math.PI);
  for (const [x, z] of [[-1.0, wheelZ], [1.0, wheelZ], [-1.0, -wheelZ], [1.0, -wheelZ]]) {
    const arch = new THREE.Mesh(archGeo, bodyMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(x, wheelR, z);
    g.add(arch);
  }
  // headlights / taillights (emissive)
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.1), hl);
    h.position.set(x, 0.58, halfLen + 0.08);
    g.add(h);
  }
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const x of [-0.7, 0.7]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.1), tl);
    t.position.set(x, 0.58, -halfLen - 0.08);
    g.add(t);
  }
  // wheels: tire + hubcap + spokes in a group (spins around the axle)
  const tireGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 12);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9, metalness: 0 });
  const hubGeo = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.32, 10);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.35, metalness: 0.7 });
  const spokeGeo = new THREE.BoxGeometry(0.34, wheelR * 0.9, 0.06);
  const wheels = [];
  for (const [x, z] of [[-1.0, wheelZ], [1.0, wheelZ], [-1.0, -wheelZ], [1.0, -wheelZ]]) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    wg.add(tire);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    wg.add(hub);
    // single spoke bar on the outer face — spins visibly with the wheel
    const spoke = new THREE.Mesh(spokeGeo, hubMat);
    spoke.position.x = x > 0 ? 0.17 : -0.17;
    wg.add(spoke);
    wg.position.set(x, wheelR, z);
    g.add(wg);
    wheels.push(wg);
  }
  let lightBar = null;
  if (isPolice) {
    // black-and-white livery: white door band
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.38, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 }));
    door.position.set(0, 0.58, -0.3);
    g.add(door);
    const barGeo = new THREE.BoxGeometry(1.2, 0.18, 0.4);
    const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const blue = new THREE.MeshBasicMaterial({ color: 0x2040ff });
    const r = new THREE.Mesh(barGeo, red); r.position.set(-0.32, 1.58, -0.2); g.add(r);
    const b = new THREE.Mesh(barGeo, blue); b.position.set(0.32, 1.58, -0.2); g.add(b);
    lightBar = { red, blue, t: 0 };
  }
  return { group: g, wheels, lightBar, bodyMat };
}

const HAIR_COLORS = [0x1c1410, 0x3a2a18, 0x111111, 0x6a4a2a, 0x8a8a8a];
const SKIN_TONES = [0xd9a986, 0xc98e6a, 0x8a5a3a, 0xe8b898, 0x6a4530];
const HAT_COLORS = [0x2a2a2e, 0x5c3a1e, 0x3a3a3a, 0x6e2a2a];

// capsule person: capsule torso, sphere head + hair, capsule arms/legs — no cube people
// scale = [sx, sy, sz] body proportions; hat = wide-brim hat (some peds)
function makePersonMesh({ shirt, pants = 0x2c3240, skin = 0xd9a986, hair = null, scale = null, hat = false }) {
  const g = new THREE.Group();
  if (scale) g.scale.set(scale[0], scale[1], scale[2]);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85, metalness: 0 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9, metalness: 0 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7, metalness: 0 });
  const hairMat = new THREE.MeshStandardMaterial({
    color: hair ?? HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    roughness: 0.95, metalness: 0,
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 4, 8), shirtMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.78;
  g.add(head);
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), hairMat);
  hairMesh.scale.set(1, 0.62, 1);
  hairMesh.position.y = 1.92;
  g.add(hairMesh);
  if (hat) {
    // wide-brim hat (replaces the hair cap visually)
    const hatMat = new THREE.MeshStandardMaterial({
      color: HAT_COLORS[Math.floor(Math.random() * HAT_COLORS.length)],
      roughness: 0.9, metalness: 0,
    });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 12), hatMat);
    brim.position.y = 1.98;
    g.add(brim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), hatMat);
    dome.scale.set(1, 0.75, 1);
    dome.position.y = 2.03;
    g.add(dome);
  }
  // arms (slightly out, hang naturally)
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.45, 3, 6);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.position.set(s * 0.42, 1.05, 0);
    arm.rotation.z = s * 0.12;
    g.add(arm);
  }
  // legs
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.5, 3, 6);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(s * 0.14, 0.36, 0);
    g.add(leg);
  }
  return g;
}

export function makePedMesh(shirtColor) {
  // varied silhouettes: height 0.88–1.15, width 0.85–1.25, skin tones, 30% hats
  return makePersonMesh({
    shirt: shirtColor,
    skin: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    scale: [0.85 + Math.random() * 0.4, 0.88 + Math.random() * 0.27, 0.85 + Math.random() * 0.4],
    hat: Math.random() < 0.3,
  });
}

export function makePlayerMesh() {
  const g = makePersonMesh({ shirt: 0x8a2f2f, hair: 0x1c1410 });
  // flat cap + brim (Rook's signature)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.85, metalness: 0 }));
  cap.position.y = 2.0;
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.85, metalness: 0 }));
  brim.position.set(0, 1.96, 0.3);
  g.add(brim);
  return g;
}

export function createEntities(G) {
  const rng = new RNG(4242);
  // player
  const p = G.player;
  p.mesh = makePlayerMesh();
  p.mesh.position.copy(p.pos);
  G.scene.add(p.mesh);

  // parked cars along road edges
  G.parked = [];
  for (let i = 0; i < 12; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const road = rng.pick(CITY.roads);
    const along = rng.range(-190, 190);
    const side = rng.chance(0.5) ? 1 : -1;
    const pos = axis === 'x'
      ? { x: along, z: road + side * 4.6 }
      : { x: road + side * 4.6, z: along };
    const heading = axis === 'x' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const color = rng.pick(CAR_COLORS);
    const mesh = makeCarMesh(color, false, randomCarType(rng));
    mesh.group.position.set(pos.x, 0, pos.z);
    mesh.group.rotation.y = heading;
    G.scene.add(mesh.group);
    G.parked.push({ pos: new THREE.Vector3(pos.x, 0, pos.z), heading, mesh, color, owned: false, speed: 0 });
  }

  // traffic
  G.traffic = [];
  for (let i = 0; i < 14; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const road = rng.pick(CITY.roads);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = dir > 0 ? 2.8 : -2.8;
    const along = rng.range(-200, 200);
    const pos = axis === 'x'
      ? new THREE.Vector3(along, 0, road + lane)
      : new THREE.Vector3(road + lane, 0, along);
    const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const color = rng.pick(CAR_COLORS);
    const mesh = makeCarMesh(color, false, randomCarType(rng));
    mesh.group.position.copy(pos);
    mesh.group.rotation.y = heading;
    G.scene.add(mesh.group);
    G.traffic.push({
      pos, heading, mesh, color, axis, road, lane, dir,
      speed: rng.range(9, 13), baseSpeed: 0, isPolice: false, isCourier: false,
      lastCross: null,
    });
    G.traffic[i].baseSpeed = G.traffic[i].speed;
  }

  // pedestrians
  G.peds = [];
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-190, 190), z = rng.range(-190, 190);
    const mesh = makePedMesh(rng.pick(PED_SHIRTS));
    mesh.position.set(x, 0, z);
    G.scene.add(mesh);
    const ped = {
      pos: new THREE.Vector3(x, 0, z), heading: rng.range(0, Math.PI * 2),
      mesh, speed: rng.range(1.2, 2.2), state: 'walk', timer: rng.range(2, 6),
      downTimer: 0, fleeX: 0, fleeZ: 0,
    };
    mesh.userData.ref = { kind: 'ped', obj: ped };
    G.peds.push(ped);
  }

  G.police = [];
  G.cops = [];
  createPickups(G);
}

function nearestCar(G, pos, list, maxD) {
  let best = null, bestD = maxD;
  for (const c of list) {
    const d = dist2(pos.x, pos.z, c.pos.x, c.pos.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function updatePlayer(G, dt, input) {
  const p = G.player;
  p.damageFlash = Math.max(0, p.damageFlash - dt * 1.6);
  if (p.inCar && p.car) {
    updateDriving(G, dt, input);
    return;
  }
  // on foot
  const speed = input.sprint ? 11 : 7;
  let mx = 0, mz = 0;
  if (input.f) mz -= 1;
  if (input.b) mz += 1;
  if (input.l) mx -= 1;
  if (input.r) mx += 1;
  if (mx !== 0 || mz !== 0) {
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    const cy = G.camYaw;
    // camera-relative: forward = -Z rotated by camYaw
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    const wx = fx * -mz + rx * mx;
    const wz = fz * -mz + rz * mx;
    p.pos.x += wx * speed * dt;
    p.pos.z += wz * speed * dt;
    const targetHeading = Math.atan2(wx, wz);
    p.heading = angleLerp(p.heading, targetHeading, Math.min(1, dt * 10));
    p.moving = true;
  } else {
    p.moving = false;
  }
  collideBuildings(p.pos, 0.9, G.city.buildings);
  // bump into cars (soft push)
  for (const c of [...G.traffic, ...G.parked]) {
    const d = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
    if (d < 2.6 && d > 0.01) {
      const push = (2.6 - d);
      p.pos.x += ((p.pos.x - c.pos.x) / d) * push;
      p.pos.z += ((p.pos.z - c.pos.z) / d) * push;
    }
  }
  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.heading;
  // walk bob
  p.mesh.position.y = p.moving ? Math.abs(Math.sin(performance.now() / 130)) * 0.08 : 0;

  // nearest enterable car for prompt
  const car = nearestCar(G, p.pos, [...G.parked, ...G.traffic], 4.2);
  G.nearCar = car;
  G.prompt = car ? '[E] Enter car' : (G.missions.holdTarget ? '[E] Hold to rob' : '');
}

function updateDriving(G, dt, input) {
  const p = G.player, car = p.car;
  const maxSpeed = car.isPolice ? 44 : 38;
  const accel = input.f ? 16 : 0;
  const brake = input.b ? 26 : 0;
  if (input.f) car.speed = Math.min(car.speed + accel * dt, maxSpeed);
  else if (input.b) {
    if (car.speed > 0.5) car.speed = Math.max(0, car.speed - brake * dt);
    else car.speed = Math.max(-10, car.speed - 8 * dt);
  } else {
    car.speed -= car.speed * 0.6 * dt; // drag
    if (Math.abs(car.speed) < 0.2) car.speed = 0;
  }
  if (input.handbrake) car.speed -= car.speed * 2.2 * dt;
  const steerInput = (input.l ? 1 : 0) - (input.r ? 1 : 0);
  const spd = Math.abs(car.speed);
  const steerMax = 0.55 * clamp(1 - spd / 55, 0.35, 1);
  car.steer = angleLerp(car.steer || 0, steerInput * steerMax, Math.min(1, dt * 8));
  if (spd > 0.1) {
    car.heading += (car.steer * (car.speed / 8)) * dt * (car.speed < 0 ? -1 : 1);
  }
  const nx = p.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = p.pos.z + Math.cos(car.heading) * car.speed * dt;
  const before = { x: p.pos.x, z: p.pos.z };
  p.pos.x = nx; p.pos.z = nz;
  const hitWall = collideBuildings(p.pos, 2.2, G.city.buildings);
  if (hitWall) {
    const impact = Math.abs(car.speed);
    if (impact > 12) {
      damagePlayer(G, impact * 0.55);
      G.audio.thud();
      G.hud.toast('Crash!');
    }
    car.speed *= 0.35;
  }
  // car vs car
  for (const o of [...G.traffic, ...G.parked, ...G.police]) {
    if (o === car || o.removed) continue;
    const d = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
    if (d < 4.4 && d > 0.01) {
      const rel = Math.abs(car.speed - (o.speed || 0));
      const push = (4.4 - d) / 2;
      const ux = (p.pos.x - o.pos.x) / d, uz = (p.pos.z - o.pos.z) / d;
      p.pos.x += ux * push; p.pos.z += uz * push;
      if (!o.isPolice) { o.pos.x -= ux * push; o.pos.z -= uz * push; }
      if (rel > 10) {
        // one crash event per second max (no multi-frame shredding), and
        // ramming only counts as YOUR crime when you are the aggressor:
        // a police car rear-ending your stopped car must not raise wanted.
        if (G.time - (car.lastCrashAt || -99) > 1) {
          car.lastCrashAt = G.time;
          damagePlayer(G, rel * 0.4);
          G.audio.thud();
          if (o.isPolice && Math.abs(car.speed) > 10 && Math.abs(car.speed) >= Math.abs(o.speed || 0)) {
            addWanted(G, 1, 'hit a cop car');
          }
        }
      }
      car.speed *= 0.6;
    }
  }
  // car vs peds
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    const d = dist2(p.pos.x, p.pos.z, ped.pos.x, ped.pos.z);
    if (d < 2.4 && Math.abs(car.speed) > 3) {
      knockPed(G, ped, p.pos);
      addWanted(G, 1, 'hit a pedestrian');
      damagePlayer(G, 2);
    }
  }
  car.pos.copy(p.pos);
  car.mesh.group.position.copy(p.pos);
  car.mesh.group.rotation.y = car.heading;
  // wheel spin
  for (const w of car.mesh.wheels) w.rotation.x += car.speed * dt * 0.9;
  p.heading = car.heading;
  p.mesh.position.set(p.pos.x, -10, p.pos.z); // hidden while driving
  G.prompt = '[E] Exit car';
  G.audio.setEngine(clamp(Math.abs(car.speed) / 38, 0, 1), true);
}

export function enterCar(G, car) {
  const p = G.player;
  // remove from its list
  const li = G.parked.indexOf(car); if (li >= 0) G.parked.splice(li, 1);
  const ti = G.traffic.indexOf(car); if (ti >= 0) G.traffic.splice(ti, 1);
  p.inCar = true;
  p.car = car;
  p.pos.copy(car.pos);
  car.speed = 0; car.steer = 0;
  if (!car.owned) {
    car.owned = true;
    addWanted(G, 1, 'stole a car');
    G.hud.toast('You stole the car — the cops noticed!');
  } else {
    G.hud.toast('Your car.');
  }
  G.audio.blip(520, 0.08);
}

export function exitCar(G) {
  const p = G.player, car = p.car;
  if (!car) return;
  p.inCar = false;
  p.car = null;
  // step out to the side
  p.pos.x = car.pos.x + Math.cos(car.heading) * 2.6;
  p.pos.z = car.pos.z - Math.sin(car.heading) * 2.6;
  collideBuildings(p.pos, 0.9, G.city.buildings);
  car.speed = 0;
  G.parked.push(car);
  G.audio.setEngine(0, false);
}

export function damagePlayer(G, amt) {
  const p = G.player;
  p.health -= amt;
  p.damageFlash = 1;
  G.lastDamageAt = G.time;
  if (p.health <= 0) {
    p.health = 0;
    G.state = 'wasted';
    G.audio.fail();
  }
}

export function knockPed(G, ped, fromPos) {
  ped.state = 'down';
  ped.downTimer = 3.5;
  ped.mesh.rotation.x = Math.PI / 2;
  ped.mesh.position.y = 0.35;
  // fling slightly
  const dx = ped.pos.x - fromPos.x, dz = ped.pos.z - fromPos.z;
  const d = Math.hypot(dx, dz) || 1;
  ped.pos.x += (dx / d) * 2.5;
  ped.pos.z += (dz / d) * 2.5;
  G.audio.punch();
}

// ---------- pistol pickups + shooting ----------
// Two glowing pistol pickups on the roads; walk over to collect (12 rounds),
// respawn 60s after being taken.
function makePickupMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 20),
    new THREE.MeshBasicMaterial({ color: 0x2ee6a8, transparent: true, opacity: 0.45 }));
  base.position.y = 0.1;
  g.add(base);
  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1a1d22 }));
  gun.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x4a545e }));
  barrel.position.set(0, 0.02, 0.35);
  gun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x1a1d22 }));
  grip.position.set(0, -0.16, -0.12);
  gun.add(grip);
  gun.position.y = 0.9;
  gun.rotation.x = -0.4;
  g.add(gun);
  g.userData.gun = gun;
  return g;
}

export function createPickups(G) {
  G.pickups = [];
  for (const [x, z] of [[-126, 150], [134, 26]]) {
    const mesh = makePickupMesh();
    mesh.position.set(x, 0, z);
    G.scene.add(mesh);
    G.pickups.push({ pos: new THREE.Vector3(x, 0, z), mesh, taken: false, respawnAt: 0 });
  }
}

export function updatePickups(G, dt) {
  if (!G.pickups) return;
  for (const pk of G.pickups) {
    if (pk.taken) {
      if (G.time >= pk.respawnAt) { pk.taken = false; pk.mesh.visible = true; }
      continue;
    }
    pk.mesh.userData.gun.rotation.y += dt * 2;
    pk.mesh.userData.gun.position.y = 0.9 + Math.sin(G.time * 3 + pk.pos.x) * 0.15;
    if (dist2(G.player.pos.x, G.player.pos.z, pk.pos.x, pk.pos.z) < 2.5) {
      pk.taken = true;
      pk.respawnAt = G.time + 60;
      pk.mesh.visible = false;
      G.player.pistol = true;
      G.player.ammo = 12;
      G.hud.toast('Pistol acquired — 12 rounds. Click to shoot.');
      G.audio.pickup();
    }
  }
}

// ray vs building AABBs (slab method); returns nearest hit distance or maxD
function rayHitBuildings(G, origin, dir, maxD) {
  let best = maxD;
  for (const b of G.city.buildings) {
    let tmin = 0, tmax = maxD;
    const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
    const mn = [b.minX, 0, b.minZ], mx = [b.maxX, b.h, b.maxZ];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; }
      } else {
        let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin < best) best = tmin;
  }
  return best;
}

// Hitscan pistol: ray from the camera through the screen center. Peds go down,
// cops take 50 dmg (2 shots kill, +$10). Buildings block the shot. Tracer line.
export function shootPistol(G) {
  const p = G.player;
  if (G.state !== 'playing' || p.inCar || !p.pistol) return;
  if (p.ammo <= 0) {
    G.hud.toast('Out of ammo — find a pistol pickup.');
    G.audio.blip(160, 0.05, 'square', 0.12);
    return;
  }
  if ((p.shotCooldown || 0) > 0) return;
  p.shotCooldown = 0.35;
  p.ammo--;
  G.audio.shot();
  const origin = G.camera.position.clone();
  const dir = G.camera.getWorldDirection(new THREE.Vector3());
  const rc = new THREE.Raycaster(origin, dir, 0.1, 60);
  const targets = [
    ...G.peds.filter((x) => x.state !== 'down').map((x) => x.mesh),
    ...G.cops.map((x) => x.mesh),
  ];
  const hits = rc.intersectObjects(targets, true);
  const wallD = rayHitBuildings(G, origin, dir, 60);
  let end = origin.clone().addScaledVector(dir, Math.min(wallD, 60));
  if (hits.length > 0 && hits[0].distance < wallD) {
    const hit = hits[0];
    end = hit.point.clone();
    let o = hit.object, ref = null;
    while (o) {
      if (o.userData && o.userData.ref) { ref = o.userData.ref; break; }
      o = o.parent;
    }
    if (ref) {
      if (ref.kind === 'ped') {
        knockPed(G, ref.obj, p.pos);
        addWanted(G, 1, 'shot a pedestrian');
      } else if (ref.kind === 'cop') {
        ref.obj.hp -= 50;
        addWanted(G, 1, 'shot a cop');
        if (ref.obj.hp <= 0) {
          G.scene.remove(ref.obj.mesh);
          G.cops.splice(G.cops.indexOf(ref.obj), 1);
          G.money += 10;
          G.hud.toast('Cop down! +$10');
        }
      }
    }
  }
  // tracer from the muzzle to the hit point (or max range / wall)
  const start = p.pos.clone();
  start.y = 1.4;
  const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
  G.scene.add(line);
  setTimeout(() => { G.scene.remove(line); geo.dispose(); }, 80);
}

export function updateTraffic(G, dt) {
  for (const c of G.traffic) {
    if (c.isCourier) continue; // courier handled by missions
    driveOnRoads(G, c, dt);
  }
}

// Shared road-following: drive along the current road; at intersections sometimes
// turn onto the crossing road (waypoint-graph behaviour); U-turn at the city edge.
export function driveOnRoads(G, c, dt) {
  const B = CITY.bound;
  const alongNow = c.axis === 'x' ? c.pos.x : c.pos.z;
  if (c.lastCross !== null && c.lastCross !== undefined && Math.abs(alongNow - c.lastCross) > 8) c.lastCross = null;
  // slow for car ahead in same lane
  let target = c.baseSpeed;
  for (const o of G.traffic) {
    if (o === c || o.axis !== c.axis || o.road !== c.road || o.dir !== c.dir) continue;
    const along = c.axis === 'x' ? c.pos.x : c.pos.z;
    const oAlong = o.axis === 'x' ? o.pos.x : o.pos.z;
    const ahead = (oAlong - along) * c.dir;
    if (ahead > 0 && ahead < 12) { target = Math.min(target, Math.max(0, o.speed - 2)); }
  }
  // slow for the player's car too (same lane, ahead) — don't rear-end a stopped player
  if (G.player.inCar && G.player.car) {
    const pc = G.player.car;
    if (c.axis === 'x') {
      const cross = Math.abs(pc.pos.z - (c.road + c.lane));
      const ahead = (pc.pos.x - c.pos.x) * c.dir;
      if (cross < 3 && ahead > 0 && ahead < 12) target = Math.min(target, Math.max(0, Math.abs(pc.speed) - 2));
    } else {
      const cross = Math.abs(pc.pos.x - (c.road + c.lane));
      const ahead = (pc.pos.z - c.pos.z) * c.dir;
      if (cross < 3 && ahead > 0 && ahead < 12) target = Math.min(target, Math.max(0, Math.abs(pc.speed) - 2));
    }
  }
  c.speed += (target - c.speed) * Math.min(1, dt * 2);
  const alongBefore = c.axis === 'x' ? c.pos.x : c.pos.z;
  if (c.axis === 'x') c.pos.x += c.dir * c.speed * dt;
  else c.pos.z += c.dir * c.speed * dt;
  const alongAfter = c.axis === 'x' ? c.pos.x : c.pos.z;
  // intersection crossing? (roads are the waypoint nodes)
  for (const r of CITY.roads) {
    if (c.lastCross === r) continue;
    if ((alongBefore - r) * (alongAfter - r) <= 0 && Math.abs(alongAfter - r) < 4) {
      c.lastCross = r;
      if (Math.random() < 0.35) {
        // turn onto the crossing road
        if (c.axis === 'x') {
          const newDir = Math.random() < 0.5 ? 1 : -1;
          c.axis = 'z'; c.road = r; c.dir = newDir;
          c.lane = newDir > 0 ? 2.8 : -2.8;
          c.pos.x = r + c.lane;
          c.heading = newDir > 0 ? 0 : Math.PI;
        } else {
          const newDir = Math.random() < 0.5 ? 1 : -1;
          c.axis = 'x'; c.road = r; c.dir = newDir;
          c.lane = newDir > 0 ? 2.8 : -2.8;
          c.pos.z = r + c.lane;
          c.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        c.mesh.group.rotation.y = c.heading;
      }
      break;
    }
  }
  // city edge: U-turn instead of teleporting
  const along = c.axis === 'x' ? c.pos.x : c.pos.z;
  if (along > B + 6 || along < -B - 6) {
    c.dir *= -1;
    c.heading += Math.PI;
    c.mesh.group.rotation.y = c.heading;
    if (c.axis === 'x') c.pos.x = clamp(c.pos.x, -B - 6, B + 6);
    else c.pos.z = clamp(c.pos.z, -B - 6, B + 6);
  }
  c.mesh.group.position.copy(c.pos);
  for (const w of c.mesh.wheels) w.rotation.x += c.speed * dt * 0.9;
}

export function updatePeds(G, dt) {  for (const ped of G.peds) {
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.state = 'flee';
        ped.mesh.rotation.x = 0;
        ped.mesh.position.y = 0;
        ped.timer = 4;
      }
      continue;
    }
    ped.timer -= dt;
    if (ped.timer <= 0) {
      ped.timer = ped.state === 'flee' ? 0 : 3 + Math.random() * 4;
      if (ped.state === 'flee') { ped.state = 'walk'; }
      ped.heading = Math.random() * Math.PI * 2;
    }
    const sp = ped.state === 'flee' ? 5.5 : ped.speed;
    ped.pos.x += Math.sin(ped.heading) * sp * dt;
    ped.pos.z += Math.cos(ped.heading) * sp * dt;
    collideBuildings(ped.pos, 0.6, G.city.buildings);
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    ped.mesh.position.y = Math.abs(Math.sin(performance.now() / 160 + ped.pos.x)) * 0.05;
  }
}

export function addWanted(G, n, reason) {
  if (G.wanted >= 5) return;
  G.wanted = Math.min(5, G.wanted + n);
  G.lastCrimeAt = G.time;
  if (reason) G.hud.toast('Wanted level up! (' + reason + ')');
}

export function updatePolice(G, dt) {
  const p = G.player;
  // 2 patrol cars always roam the roads; extra cars spawn per wanted level
  const want = Math.max(2, G.wanted);
  while (G.police.length < want) {
    // spawn at a random intersection (waypoint) at least 70u from the player
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 8; tries++) {
      const rx = CITY.roads[Math.floor(Math.random() * CITY.roads.length)];
      const rz = CITY.roads[Math.floor(Math.random() * CITY.roads.length)];
      x = rx + (Math.random() < 0.5 ? 2.8 : -2.8);
      z = rz + (Math.random() < 0.5 ? 2.8 : -2.8);
      if (Math.hypot(x - p.pos.x, z - p.pos.z) >= 70) { ok = true; break; }
    }
    if (!ok) {
      const a = Math.random() * Math.PI * 2;
      x = p.pos.x + Math.cos(a) * 90; z = p.pos.z + Math.sin(a) * 90;
    }
    const mesh = makeCarMesh(0x14161a, true);
    mesh.group.position.set(x, 0, z);
    G.scene.add(mesh.group);
    G.police.push({
      pos: new THREE.Vector3(x, 0, z), heading: 0, mesh,
      speed: 0, baseSpeed: 13, isPolice: true,
      axis: 'x', road: nearestRoad(z), lane: 2.8, dir: 1, lastCross: null,
      patrol: true, bustTimer: 0,
    });
  }
  while (G.police.length > want) {
    const c = G.police.pop();
    G.scene.remove(c.mesh.group);
  }
  // foot cops at wanted >= 3
  const wantCops = G.wanted >= 3 ? 2 : 0;
  while (G.cops.length < wantCops) {
    const mesh = makePedMesh(0x1c2733);
    const x = p.pos.x + (Math.random() * 40 - 20), z = p.pos.z + (Math.random() * 40 - 20);
    mesh.position.set(x, 0, z);
    G.scene.add(mesh);
    G.cops.push({ pos: new THREE.Vector3(x, 0, z), heading: 0, mesh, speed: 7.5, bustTimer: 0, shootTimer: 0, hp: 100 });
    G.cops[G.cops.length - 1].mesh.userData.ref = { kind: 'cop', obj: G.cops[G.cops.length - 1] };
  }
  while (G.cops.length > wantCops) {
    const c = G.cops.pop();
    G.scene.remove(c.mesh);
  }

  // cars: patrol when no heat (or during a stealth tail), chase when wanted
  for (const c of G.police) {
    if (G.wanted === 0 || G.stealthTail) {
      if (!c.patrol) {
        // snap back onto the nearest road for patrol
        c.patrol = true;
        c.axis = 'x'; c.road = nearestRoad(c.pos.z); c.dir = Math.random() < 0.5 ? 1 : -1;
        c.lane = c.dir > 0 ? 2.8 : -2.8;
        c.heading = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        c.pos.z = c.road + c.lane;
        c.lastCross = null;
      }
      driveOnRoads(G, c, dt);
      c.mesh.group.position.copy(c.pos);
      c.mesh.group.rotation.y = c.heading;
      if (c.mesh.lightBar) {
        c.mesh.lightBar.red.color.setHex(0x551111);
        c.mesh.lightBar.blue.color.setHex(0x111155);
      }
      continue;
    }
    c.patrol = false;
    const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz);
    const targetHeading = Math.atan2(dx, dz);
    c.heading = angleLerp(c.heading, targetHeading, Math.min(1, dt * 2.2));
    const targetSpeed = d > 60 ? 42 : d > 18 ? 40 : 26;
    c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 1.2);
    c.pos.x += Math.sin(c.heading) * c.speed * dt;
    c.pos.z += Math.cos(c.heading) * c.speed * dt;
    collideBuildings(c.pos, 2.2, G.city.buildings);
    // ram the player car
    if (d < 4.6) {
      const push = 4.6 - d;
      const ux = dx / (d || 1), uz = dz / (d || 1);
      if (p.inCar) {
        p.pos.x += ux * push * 0.5; p.pos.z += uz * push * 0.5;
        if (p.car) p.car.speed *= 0.92;
        if (Math.abs(c.speed) > 12 && Math.random() < dt * 2) damagePlayer(G, 3);
      }
      c.speed *= 0.6;
    }
    c.mesh.group.position.copy(c.pos);
    c.mesh.group.rotation.y = c.heading;
    if (c.mesh.lightBar) {
      c.mesh.lightBar.t = (c.mesh.lightBar.t || 0) + dt;
      const on = Math.sin(c.mesh.lightBar.t * 14) > 0;
      c.mesh.lightBar.red.color.setHex(on ? 0xff2020 : 0x551111);
      c.mesh.lightBar.blue.color.setHex(on ? 0x2040ff : 0x111155);
    }
    for (const w of c.mesh.wheels) w.rotation.x += c.speed * dt * 0.9;
    // busted check: close + slow
    const pSpeed = p.inCar ? Math.abs(p.car.speed) : (p.moving ? 7 : 0);
    if (d < 5.5 && pSpeed < 2.5) {
      c.bustTimer += dt;
      if (c.bustTimer > 2.5) { G.state = 'busted'; G.audio.fail(); return; }
    } else {
      c.bustTimer = Math.max(0, c.bustTimer - dt * 2);
    }
  }
  for (const cop of G.cops) {
    const dx = p.pos.x - cop.pos.x, dz = p.pos.z - cop.pos.z;
    const d = Math.hypot(dx, dz);
    cop.heading = Math.atan2(dx, dz);
    // shoot at range when wanted >= 3 (3 dmg per shot, ~1.3s cooldown)
    if (d > 3 && d < 28) {
      cop.shootTimer = (cop.shootTimer || 0) - dt;
      if (cop.shootTimer <= 0) {
        cop.shootTimer = 1.3;
        damagePlayer(G, 3);
        G.audio.blip(880, 0.05, 0.08);
      }
    }
    cop.pos.x += Math.sin(cop.heading) * cop.speed * dt;
    cop.pos.z += Math.cos(cop.heading) * cop.speed * dt;
    collideBuildings(cop.pos, 0.6, G.city.buildings);
    cop.mesh.position.copy(cop.pos);
    cop.mesh.rotation.y = cop.heading;
    if (d < 2.4) {
      cop.bustTimer += dt;
      if (cop.bustTimer > 1.6) { G.state = 'busted'; G.audio.fail(); return; }
    } else {
      cop.bustTimer = Math.max(0, cop.bustTimer - dt * 2);
    }
  }
  // wanted decay
  if (G.wanted > 0 && G.time - G.lastCrimeAt > 20) {
    let nearest = 999;
    for (const c of G.police) nearest = Math.min(nearest, dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z));
    if (nearest > 70) {
      G.decayTimer = (G.decayTimer || 0) + dt;
      if (G.decayTimer > 10) {
        G.decayTimer = 0;
        G.wanted = Math.max(0, G.wanted - 1);
        if (G.wanted === 0) G.hud.toast('You lost the cops. For now.');
      }
    } else {
      G.decayTimer = 0;
    }
  }
  // siren audio when police near
  let near = false;
  for (const c of G.police) {
    if (dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < 70) { near = true; break; }
  }
  G.audio.setSiren(near, dt);
}
