// Solmar Bay — procedural deterministic city.
// Roads on a grid, buildings per block, streetlights, trees, props.
// Exposes building AABBs for collision and a setNight() hook for streetlights.
import * as THREE from 'three';
import { RNG, clamp } from './rng.js';

export const CITY = {
  pitch: 52,          // block (40) + road (12)
  roads: [-182, -130, -78, -26, 26, 78, 130, 182],
  bound: 208,         // playable half-extent
  seed: 1337,
};

const BUILDING_COLORS = [0x5a6b7d, 0x6d5f52, 0x4f5d4a, 0x74604e, 0x5d5a6e, 0x7a6a5f, 0x4a5a6a, 0x63564a];
const ROOF_COLORS = [0x3a3f45, 0x2f3338, 0x453a30];

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
  const cols = variant === 0 ? 4 : variant === 1 ? 6 : 5;
  const rows = 10;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng.chance(0.28);
      g.fillStyle = lit ? '#ffd98a' : (rng.chance(0.5) ? '#33404d' : '#252d38');
      g.fillRect(6 + x * (116 / cols), 8 + y * (240 / rows), 116 / cols - 6, 240 / rows - 7);
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
    new THREE.MeshLambertMaterial({ map: groundTexture() })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // outer apron so the horizon isn't void
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: 0x232a31 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.2;
  group.add(apron);

  const winTex = [windowTexture(rng, 0), windowTexture(rng, 1), windowTexture(rng, 2)];
  const buildings = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roads = CITY.roads;

  // one building (or a pair) per block
  for (let i = 0; i < roads.length - 1; i++) {
    for (let j = 0; j < roads.length - 1; j++) {
      const x0 = roads[i] + 8, x1 = roads[i + 1] - 8;
      const z0 = roads[j] + 8, z1 = roads[j + 1] - 8;
      const bw = x1 - x0, bd = z1 - z0;
      const n = rng.chance(0.45) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const w = n === 1 ? bw * rng.range(0.55, 0.8) : bw * rng.range(0.4, 0.48);
        const d = n === 1 ? bd * rng.range(0.55, 0.8) : bd * rng.range(0.4, 0.48);
        const h = rng.range(8, 42) * (rng.chance(0.12) ? 1.6 : 1);
        const cx = x0 + bw / 2 + (n === 2 ? (k === 0 ? -bw * 0.22 : bw * 0.22) : rng.range(-3, 3));
        const cz = z0 + bd / 2 + (n === 2 ? rng.range(-3, 3) : rng.range(-3, 3));
        const color = rng.pick(BUILDING_COLORS);
        const mat = new THREE.MeshLambertMaterial({ color, map: winTex[rng.int(0, 2)] });
        const m = new THREE.Mesh(boxGeo, mat);
        m.scale.set(w, h, d);
        m.position.set(cx, h / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        // roof cap
        const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: rng.pick(ROOF_COLORS) }));
        roof.scale.set(w + 0.6, 0.8, d + 0.6);
        roof.position.set(cx, h + 0.4, cz);
        group.add(roof);
        // rooftop box (AC unit)
        if (rng.chance(0.6)) {
          const ac = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x6a7076 }));
          ac.scale.set(rng.range(2, 4), 1.2, rng.range(2, 4));
          ac.position.set(cx + rng.range(-w / 4, w / 4), h + 1.2, cz + rng.range(-d / 4, d / 4));
          group.add(ac);
        }
        buildings.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
      }
    }
  }

  // streetlights at intersections (every other one)
  const lightMats = [];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c3138 });
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  for (let i = 0; i < roads.length; i += 2) {
    for (let j = 0; j < roads.length; j += 2) {
      const x = roads[i] + 7.5, z = roads[j] + 7.5;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      group.add(pole);
      const lm = new THREE.MeshBasicMaterial({ color: 0x444444 });
      const head = new THREE.Mesh(headGeo, lm);
      head.position.set(x, 7.1, z);
      group.add(head);
      lightMats.push(lm);
    }
  }

  // trees on sidewalks
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3826 });
  const leafGeo = new THREE.ConeGeometry(1.8, 4.5, 7);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f5d33 });
  for (let n = 0; n < 46; n++) {
    const i = rng.int(0, roads.length - 2), j = rng.int(0, roads.length - 2);
    const x = roads[i] + rng.range(9, 43);
    const z = roads[j] + (rng.chance(0.5) ? 8.5 : 43.5);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.1, z);
    trunk.castShadow = true;
    group.add(trunk);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(x, 4.2, z);
    leaf.castShadow = true;
    group.add(leaf);
  }

  // distant skyline silhouettes (outside the playable area, for depth)
  const skyMat = new THREE.MeshLambertMaterial({ color: 0x39434e });
  for (let n = 0; n < 26; n++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(280, 480);
    const w = rng.range(18, 40), h = rng.range(30, 110), d = rng.range(18, 40);
    const m = new THREE.Mesh(boxGeo, skyMat);
    m.scale.set(w, h, d);
    m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    group.add(m);
  }

  // fixed landmarks (on roads, so cars can reach them)
  const safehouse = { x: -130, z: 156 };   // Mara's garage (south-west road)
  const garage = { x: 130, z: -156 };      // north-east garage (road)

  function setNight(f) {
    // f: 0 = day, 1 = full night — streetlight glow
    for (const m of lightMats) {
      const c = Math.floor(0x44 + 0xbb * f);
      m.color.setRGB(c / 255, (c * 0.85) / 255, (c * 0.45) / 255);
    }
  }

  return { group, buildings, safehouse, garage, setNight, roads };
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
