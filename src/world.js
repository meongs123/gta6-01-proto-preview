// Solmar Bay — procedural deterministic city.
// Roads on a grid, varied buildings (setbacks, roof props, storefronts),
// streetlights, traffic lights, hydrants, trees.
// Exposes building AABBs for collision and a setNight() hook.
// Everything procedural — zero external assets, zero network.
import * as THREE from 'three';
import { RNG, clamp } from './rng.js';

export const CITY = {
  pitch: 52,          // block (40) + road (12)
  roads: [-182, -130, -78, -26, 26, 78, 130, 182],
  bound: 208,         // playable half-extent
  seed: 1337,
};

// varied facade palette — brick, sand, slate, sage, terracotta, cream...
const BUILDING_COLORS = [
  0x5a6b7d, 0x6d5f52, 0x4f5d4a, 0x74604e, 0x5d5a6e, 0x7a6a5f,
  0x8a5a44, 0xb09a7a, 0x7a8a6a, 0xa86a4a, 0xcbb89a, 0x4a4a52,
  0x9a6a6a, 0x6a6a4a, 0x6a7a8a, 0x5f6e5a,
];
const ROOF_COLORS = [0x3a3f45, 0x2f3338, 0x453a30, 0x55504a];
// storefront awning + sign palette (bright, varied)
const SHOP_COLORS = [0x2e8b8b, 0xd95d4e, 0xe0a83c, 0x4a9e5c, 0x7a5fb0, 0x3a6ea8, 0xc96a8a, 0x2f7d5b];
const SIGN_COLORS = [0xffd23e, 0xff6b4a, 0x2ee6a8, 0x6ab8ff, 0xff9de2, 0xf5f0e6];

function windowTexture(rng, variant) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  // light concrete base — the material color tints it; windows drawn on top
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, 128, 256);
  // subtle vertical grime variation
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(0,0,0,' + rng.range(0.02, 0.07) + ')';
    g.fillRect(rng.range(0, 120), 0, rng.range(2, 8), 256);
  }
  // grid varies per variant: columns, rows, lit ratio, window size
  const conf = [
    { cols: 6, rows: 10, lit: 0.28 },
    { cols: 8, rows: 10, lit: 0.28 },
    { cols: 7, rows: 10, lit: 0.40 },
    { cols: 4, rows: 7, lit: 0.18 },   // big windows, few lit
    { cols: 8, rows: 12, lit: 0.15 },  // small windows, mostly dark
  ][variant % 5];
  for (let y = 0; y < conf.rows; y++) {
    for (let x = 0; x < conf.cols; x++) {
      const lit = rng.chance(conf.lit);
      g.fillStyle = lit ? '#ffd98a' : (rng.chance(0.5) ? '#33404d' : '#252d38');
      g.fillRect(6 + x * (116 / conf.cols), 8 + y * (240 / conf.rows), 116 / conf.cols - 6, 240 / conf.rows - 7);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const world = CITY.bound * 2 + 24; // world units across the texture
  const px = (w) => (w / world) * S;
  const X = (wx) => S / 2 + px(wx);
  const Z = (wz) => S / 2 + px(wz);
  // base: block ground
  g.fillStyle = '#363d45'; g.fillRect(0, 0, S, S);
  // sidewalk pads around each block
  g.fillStyle = '#3a4149';
  const roads = CITY.roads, P = CITY.pitch;
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      const x0 = roads[i] + 6, x1 = roads[i + 1] - 6;
      const z0 = roads[j] + 6, z1 = roads[j + 1] - 6;
      g.fillRect(X(x0), Z(z0), px(x1 - x0), px(z1 - z0));
    }
  }
  // roads
  g.fillStyle = '#2c3138';
  for (const r of roads) {
    g.fillRect(X(r - 6), 0, px(12), S);
    g.fillRect(0, Z(r - 6), S, px(12));
  }
  // center dashes
  g.fillStyle = '#c8a84a';
  for (const r of roads) {
    for (let d = -CITY.bound; d < CITY.bound; d += 12) {
      g.fillRect(X(r - 0.4), Z(d), px(0.8), px(5));
      g.fillRect(X(d), Z(r - 0.4), px(5), px(0.8));
    }
  }
  // crosswalks at intersections
  g.fillStyle = 'rgba(220,225,230,0.55)';
  for (const rx of roads) {
    for (const rz of roads) {
      for (let k = -2; k <= 2; k++) {
        g.fillRect(X(rx - 5 + k * 2), Z(rz - 5.5), px(1.2), px(3));
        g.fillRect(X(rx - 5 + k * 2), Z(rz + 2.5), px(1.2), px(3));
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createCity(scene) {
  const rng = new RNG(CITY.seed);
  const group = new THREE.Group();
  scene.add(group);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.bound * 2 + 24, CITY.bound * 2 + 24),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // outer apron so the horizon isn't void
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({ color: 0x232a31, roughness: 1, metalness: 0 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.2;
  group.add(apron);

  const winTex = [
    windowTexture(rng, 0), windowTexture(rng, 1), windowTexture(rng, 2),
    windowTexture(rng, 3), windowTexture(rng, 4),
  ];
  const buildings = [];
  const buildingMats = [];   // for night emissive windows
  const signMats = [];       // storefront signs glow at night
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roads = CITY.roads;

  // shared roof-prop geometry/materials
  const propMetal = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.7, metalness: 0.4 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.9, metalness: 0.05 });
  const antMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.6 });
  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 5);
  const tankGeo = new THREE.CylinderGeometry(1.5, 1.5, 2.6, 10);
  const coneGeo = new THREE.ConeGeometry(1.7, 1.2, 10);
  const antGeo = new THREE.CylinderGeometry(0.06, 0.1, 5, 5);
  const tipGeo = new THREE.SphereGeometry(0.16, 6, 5);

  function addRoofProps(cx, cz, topY, w, d) {
    // water tower on taller buildings
    if (topY > 18 && rng.chance(0.3)) {
      const tx = cx + rng.range(-w / 4, w / 4), tz = cz + rng.range(-d / 4, d / 4);
      for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        const leg = new THREE.Mesh(legGeo, propMetal);
        leg.position.set(tx + lx, topY + 1.1, tz + lz);
        group.add(leg);
      }
      const tank = new THREE.Mesh(tankGeo, tankMat);
      tank.position.set(tx, topY + 3.4, tz);
      group.add(tank);
      const cone = new THREE.Mesh(coneGeo, tankMat);
      cone.position.set(tx, topY + 5.3, tz);
      group.add(cone);
    } else if (rng.chance(0.55)) {
      // AC unit
      const ac = new THREE.Mesh(boxGeo, propMetal);
      ac.scale.set(rng.range(2, 4), 1.2, rng.range(2, 4));
      ac.position.set(cx + rng.range(-w / 4, w / 4), topY + 0.6, cz + rng.range(-d / 4, d / 4));
      group.add(ac);
    }
    // antenna
    if (rng.chance(0.35)) {
      const ant = new THREE.Mesh(antGeo, antMat);
      ant.position.set(cx + rng.range(-w / 3, w / 3), topY + 2.5, cz + rng.range(-d / 3, d / 3));
      group.add(ant);
      const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xff4040 }));
      tip.position.set(ant.position.x, topY + 5.1, ant.position.z);
      group.add(tip);
    }
  }

  function addStorefront(cx, cz, w, d, x0, x1, z0, z1) {
    // face the nearest road: pick the closest of the 4 block edges
    const faces = [
      { dir: 'W', dist: cx - x0, rot: -Math.PI / 2, px: cx - w / 2, pz: cz, along: d },
      { dir: 'E', dist: x1 - cx, rot: Math.PI / 2, px: cx + w / 2, pz: cz, along: d },
      { dir: 'N', dist: cz - z0, rot: Math.PI, px: cx, pz: cz - d / 2, along: w },
      { dir: 'S', dist: z1 - cz, rot: 0, px: cx, pz: cz + d / 2, along: w },
    ];
    faces.sort((a, b) => a.dist - b.dist);
    const f = faces[0];
    const shopW = Math.min(f.along * 0.55, 14);
    const awnColor = rng.pick(SHOP_COLORS);
    const signColor = rng.pick(SIGN_COLORS);
    const shop = new THREE.Group();
    shop.position.set(f.px, 0, f.pz);
    shop.rotation.y = f.rot;
    // shopfront box (sticks out of the facade)
    const front = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({
      color: awnColor, roughness: 0.6, metalness: 0.05,
      emissive: awnColor, emissiveIntensity: 0,
    }));
    front.scale.set(shopW, 3.4, 0.7);
    front.position.set(0, 1.7, 0.35);
    shop.add(front);
    // awning (sloped)
    const awn = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: awnColor, roughness: 0.8, metalness: 0 }));
    awn.scale.set(shopW + 0.8, 0.15, 1.7);
    awn.position.set(0, 3.7, 0.9);
    awn.rotation.x = 0.45;
    shop.add(awn);
    // signboard above the awning (glows at night)
    const signMat = new THREE.MeshStandardMaterial({
      color: signColor, roughness: 0.5, metalness: 0.1,
      emissive: signColor, emissiveIntensity: 0,
    });
    const sign = new THREE.Mesh(boxGeo, signMat);
    sign.scale.set(shopW * 0.8, 0.9, 0.25);
    sign.position.set(0, 4.8, 0.3);
    shop.add(sign);
    signMats.push(signMat);
    group.add(shop);
  }

  // one building (or a pair) per block — stepped silhouettes, not plain towers
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      const x0 = roads[i] + 8, x1 = roads[i + 1] - 8;
      const z0 = roads[j] + 8, z1 = roads[j + 1] - 8;
      const bw = x1 - x0, bd = z1 - z0;
      const n = rng.chance(0.45) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const w = n === 1 ? bw * rng.range(0.55, 0.8) : bw * rng.range(0.4, 0.48);
        const d = n === 1 ? bd * rng.range(0.55, 0.8) : bd * rng.range(0.4, 0.48);
        // varied heights: most mid-rise, a few tall towers
        let h = 8 + Math.pow(rng.next(), 1.5) * 34;
        if (rng.chance(0.08)) h *= 1.7;
        h = Math.min(h, 60);
        const cx = x0 + bw / 2 + (n === 2 ? (k === 0 ? -bw * 0.22 : bw * 0.22) : rng.range(-3, 3));
        const cz = z0 + bd / 2 + (n === 2 ? rng.range(-3, 3) : rng.range(-3, 3));
        const tex = winTex[rng.int(0, 4)];
        const color = rng.pick(BUILDING_COLORS);
        const mat = new THREE.MeshStandardMaterial({
          color, map: tex, roughness: rng.range(0.82, 0.95), metalness: 0.05,
          emissive: 0xffc46b, emissiveMap: tex, emissiveIntensity: 0,
        });
        buildingMats.push(mat);
        // base slab (55–70% of the height, full footprint)
        const h1 = h * rng.range(0.55, 0.7);
        const base = new THREE.Mesh(boxGeo, mat);
        base.scale.set(w, h1, d);
        base.position.set(cx, h1 / 2, cz);
        base.castShadow = true; base.receiveShadow = true;
        group.add(base);
        // upper setback (smaller footprint, offset to one side)
        const uw = w * rng.range(0.62, 0.82), ud = d * rng.range(0.62, 0.82);
        const h2 = h - h1;
        const upper = new THREE.Mesh(boxGeo, mat);
        upper.scale.set(uw, h2, ud);
        upper.position.set(cx + rng.range(-w * 0.08, w * 0.08), h1 + h2 / 2, cz + rng.range(-d * 0.08, d * 0.08));
        upper.castShadow = true; upper.receiveShadow = true;
        group.add(upper);
        // parapet cap on top
        const cap = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: rng.pick(ROOF_COLORS), roughness: 0.95, metalness: 0 }));
        cap.scale.set(uw + 0.5, 0.6, ud + 0.5);
        cap.position.set(upper.position.x, h + 0.3, upper.position.z);
        group.add(cap);
        // roof props on the upper slab
        addRoofProps(upper.position.x, upper.position.z, h, uw, ud);
        // ground-floor storefront on some buildings
        if (rng.chance(0.4)) addStorefront(cx, cz, w, d, x0, x1, z0, z1);
        // collision uses the base footprint (setbacks sit inside it)
        buildings.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
      }
    }
  }

  // streetlights at intersections (every other one) — cylinder pole + arm + head
  const lightMats = [];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.5 });
  const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 5);
  const headGeo = new THREE.BoxGeometry(0.7, 0.22, 0.4);
  for (let i = 0; i < roads.length; i += 2) {
    for (let j = 0; j < roads.length; j += 2) {
      const x = roads[i] + 7.5, z = roads[j] + 7.5;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      group.add(pole);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(x - 1, 6.9, z);
      group.add(arm);
      const lm = new THREE.MeshBasicMaterial({ color: 0x444444 });
      const head = new THREE.Mesh(headGeo, lm);
      head.position.set(x - 2, 6.85, z);
      group.add(head);
      lightMats.push(lm);
    }
  }

  // traffic lights at the 4 central intersections — cycle green/red
  const trafficLights = [];
  const tlPoleGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.5, 6);
  const tlHeadGeo = new THREE.BoxGeometry(0.55, 1.5, 0.55);
  const tlLampGeo = new THREE.SphereGeometry(0.17, 8, 6);
  for (const [ix, iz, dir] of [[-26, -26, 'ns'], [-26, 26, 'ew'], [26, -26, 'ew'], [26, 26, 'ns']]) {
    const x = ix + 7.5, z = iz - 7.5;
    const pole = new THREE.Mesh(tlPoleGeo, poleMat);
    pole.position.set(x, 2.75, z);
    group.add(pole);
    const head = new THREE.Mesh(tlHeadGeo, new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.3 }));
    head.position.set(x, 5.6, z);
    head.rotation.y = dir === 'ns' ? 0 : Math.PI / 2;
    group.add(head);
    const mk = (color, y) => {
      const m = new THREE.MeshBasicMaterial({ color });
      const s = new THREE.Mesh(tlLampGeo, m);
      s.position.set(x, y, z + (dir === 'ns' ? 0.3 : 0));
      if (dir === 'ew') { s.position.set(x + 0.3, y, z); }
      group.add(s);
      return m;
    };
    trafficLights.push({
      dir,
      r: mk(0x551111, 6.05), y: mk(0x554411, 5.6), g: mk(0x115511, 5.15),
    });
  }
  function updateTrafficLights(t) {
    // 8 s green per direction, alternating
    const phase = Math.floor(t / 8) % 2;
    for (const l of trafficLights) {
      const greenOn = (l.dir === 'ns') === (phase === 0);
      l.g.color.setHex(greenOn ? 0x2ee66a : 0x115511);
      l.r.color.setHex(greenOn ? 0x551111 : 0xff2a2a);
      l.y.color.setHex(0x554411);
    }
  }

  // fire hydrants at random intersection corners
  const hydBodyGeo = new THREE.CylinderGeometry(0.32, 0.38, 0.9, 8);
  const hydTopGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const hydNozGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6);
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xc22e2e, roughness: 0.5, metalness: 0.2 });
  for (let n = 0; n < 8; n++) {
    const rx = roads[rng.int(0, roads.length - 1)], rz = roads[rng.int(0, roads.length - 1)];
    const x = rx + (rng.chance(0.5) ? 7 : -7), z = rz + (rng.chance(0.5) ? 7 : -7);
    const body = new THREE.Mesh(hydBodyGeo, hydMat);
    body.position.set(x, 0.45, z);
    group.add(body);
    const top = new THREE.Mesh(hydTopGeo, hydMat);
    top.position.set(x, 0.95, z);
    group.add(top);
    const noz = new THREE.Mesh(hydNozGeo, hydMat);
    noz.rotation.z = Math.PI / 2;
    noz.position.set(x, 0.55, z);
    group.add(noz);
  }

  // trees on sidewalks — cylinder trunk + two foliage spheres
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1, metalness: 0 });
  const leafGeo1 = new THREE.SphereGeometry(1.7, 8, 6);
  const leafGeo2 = new THREE.SphereGeometry(1.1, 8, 6);
  const leafMats = [
    new THREE.MeshStandardMaterial({ color: 0x2f6b33, roughness: 0.95, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.95, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x27603a, roughness: 0.95, metalness: 0 }),
  ];
  for (let n = 0; n < 40; n++) {
    const i = rng.int(0, roads.length - 2), j = rng.int(0, roads.length - 2);
    const x = roads[i] + rng.range(9, 43);
    const z = roads[j] + (rng.chance(0.5) ? 8.5 : 43.5);
    const lm = rng.pick(leafMats);
    const s = rng.range(0.85, 1.3);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.2, z);
    trunk.castShadow = true;
    group.add(trunk);
    const leaf1 = new THREE.Mesh(leafGeo1, lm);
    leaf1.position.set(x, 3.9 * s, z);
    leaf1.scale.setScalar(s);
    leaf1.castShadow = true;
    group.add(leaf1);
    const leaf2 = new THREE.Mesh(leafGeo2, lm);
    leaf2.position.set(x + 0.5 * s, 5.0 * s, z + 0.3 * s);
    leaf2.scale.setScalar(s);
    group.add(leaf2);
  }

  // distant skyline silhouettes (outside the playable area, for depth)
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x39434e, roughness: 1, metalness: 0 });
  for (let n = 0; n < 26; n++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(280, 480);
    const w = rng.range(18, 40), h = rng.range(30, 110), d = rng.range(18, 40);
    const m = new THREE.Mesh(boxGeo, skyMat);
    m.scale.set(w, h, d);
    m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    group.add(m);
    if (rng.chance(0.3)) {
      const top = new THREE.Mesh(boxGeo, skyMat);
      top.scale.set(w * 0.6, h * 0.3, d * 0.6);
      top.position.set(Math.cos(a) * r, h + h * 0.15 - 1, Math.sin(a) * r);
      group.add(top);
    }
  }

  // fixed landmarks (on roads, so cars can reach them)
  const safehouse = { x: -130, z: 156 };   // Mara's garage (south-west road)
  const garage = { x: 130, z: -156 };      // north-east garage (road)

  function setNight(f) {
    // f: 0 = day, 1 = full night — streetlight glow + lit windows + signs
    for (const m of lightMats) {
      const c = Math.floor(0x44 + 0xbb * f);
      m.color.setRGB(c / 255, (c * 0.85) / 255, (c * 0.45) / 255);
    }
    for (const m of buildingMats) m.emissiveIntensity = f * 0.9;
    for (const m of signMats) m.emissiveIntensity = f * 1.3;
  }

  return { group, buildings, safehouse, garage, setNight, updateTrafficLights, roads };
}

// Circle vs building AABBs: push pos out, return true if hit.
export function collideBuildings(pos, radius, buildings) {
  let hit = false;
  for (const b of buildings) {
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // center inside box: push along smallest penetration axis
        const px = Math.min(pos.x - b.minX + radius, b.maxX - pos.x + radius);
        const pz = Math.min(pos.z - b.minZ + radius, b.maxZ - pos.z + radius);
        if (px < pz) pos.x = (pos.x - b.minX < b.maxX - pos.x) ? b.minX - radius : b.maxX + radius;
        else pos.z = (pos.z - b.minZ < b.maxZ - pos.z) ? b.minZ - radius : b.maxZ + radius;
      }
    }
  }
  // world bounds
  const B = CITY.bound;
  pos.x = clamp(pos.x, -B, B);
  pos.z = clamp(pos.z, -B, B);
  return hit;
}
