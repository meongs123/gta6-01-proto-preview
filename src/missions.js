// Missions — 6-job story arc for Rook in Solmar Bay, contact Mara.
// Framework: each mission has start/update/complete; a beacon marker + HUD objective.
import * as THREE from 'three';
import { RNG, clamp, dist2 } from './rng.js';
import { addWanted } from './entities.js';

function makeBeacon(color = 0xffd23e) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  cyl.position.y = 30;
  g.add(cyl);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color })
  );
  gem.position.y = 5.5;
  g.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.4, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  g.add(ring);
  g.userData.gem = gem;
  return g;
}

export class Missions {
  constructor(G) {
    this.G = G;
    this.list = this.define();
    this.idx = 0;
    this.active = null;      // current mission runtime state
    this.marker = null;      // {x,z} for HUD/minimap
    this.markerDist = 0;
    this.beacon = null;
    this.holdTarget = false; // prompt shows [E] hold to rob
    this.holdProgress = 0;
  }

  current() {
    if (this.idx >= this.list.length) return null;
    const m = this.list[this.idx];
    return { idx: this.idx, name: m.name, objective: this.active ? this.active.objective : m.brief, marker: this.marker };
  }

  define() {
    const G = this.G;
    return [
      {
        name: 'First Wheels',
        brief: 'Mara needs wheels. Steal any car and bring it to her garage.',
        start: (st) => {
          st.objective = 'Steal a car, then drive to the yellow marker';
          st.stage = 0;
          this.setMarker(G.city.garage.x, G.city.garage.z);
        },
        update: (st, dt) => {
          const p = G.player;
          if (st.stage === 0 && p.inCar) {
            st.stage = 1;
            st.objective = 'Drive to Mara\'s garage';
            G.hud.toast('Nice wheels. Now bring it to the garage.');
          }
          if (st.stage === 1 && dist2(p.pos.x, p.pos.z, G.city.garage.x, G.city.garage.z) < 9) {
            this.complete();
          }
        },
        reward: 150,
      },
      {
        name: 'Delivery Run',
        brief: 'Pick up the package at the docks, deliver it across town — 90 seconds.',
        start: (st) => {
          st.objective = 'Pick up the package';
          st.stage = 0;
          st.pickup = { x: -130, z: -130 };
          st.drop = { x: 130, z: 130 };
          st.timer = 90;
          this.setMarker(st.pickup.x, st.pickup.z);
        },
        update: (st, dt) => {
          const p = G.player;
          st.timer -= dt;
          st.objective = st.stage === 0
            ? 'Pick up the package — ' + Math.max(0, Math.ceil(st.timer)) + 's'
            : 'Deliver it — ' + Math.max(0, Math.ceil(st.timer)) + 's';
          if (st.timer <= 0) { this.fail('Too slow. The buyer walked.'); return; }
          if (st.stage === 0 && dist2(p.pos.x, p.pos.z, st.pickup.x, st.pickup.z) < 8) {
            st.stage = 1;
            this.setMarker(st.drop.x, st.drop.z);
            G.hud.toast('Package secured. Go!');
            G.audio.pickup();
          } else if (st.stage === 1 && dist2(p.pos.x, p.pos.z, st.drop.x, st.drop.z) < 8) {
            this.complete();
          }
        },
        reward: 250,
      },
      {
        name: 'Getaway',
        brief: 'The cops are onto you. Lose them and reach the safehouse.',
        start: (st) => {
          st.objective = 'Reach the safehouse — lose the cops';
          G.wanted = Math.max(G.wanted, 2);
          G.lastCrimeAt = G.time;
          this.setMarker(G.city.safehouse.x, G.city.safehouse.z);
          G.hud.toast('Wanted level 2! Get to the safehouse!');
        },
        update: (st, dt) => {
          const p = G.player;
          const dSafe = dist2(p.pos.x, p.pos.z, G.city.safehouse.x, G.city.safehouse.z);
          // hiding at the safehouse cools the heat fast
          if (dSafe < 14 && G.wanted > 0) {
            st.cool = (st.cool || 0) + dt;
            if (st.cool >= 3) {
              st.cool = 0;
              G.wanted = Math.max(0, G.wanted - 1);
              G.hud.toast('Cooling off... wanted ' + G.wanted);
            }
          }
          if (dSafe < 9 && G.wanted < 2) {
            this.complete();
          }
        },
        reward: 300,
      },
      {
        name: 'Tail the Courier',
        brief: 'Follow the blue courier. Stay close — but not too close.',
        start: (st) => {
          st.objective = 'Tail the blue car — stay 12–45m for 30s';
          st.followTime = 0;
          st.spotted = 0;
          st.lost = 0;
          // spawn the courier on a road loop
          const c = G.traffic[0];
          c.isCourier = true;
          c.baseSpeed = 12; c.speed = 12;
          c.mesh.bodyMat.color.setHex(0x2e6fb0);
          st.courier = c;
          this.courier = c;
          this.setMarker(c.pos.x, c.pos.z);
        },
        update: (st, dt) => {
          const p = G.player, c = st.courier;
          // courier loops the ring road
          if (c.axis === 'x') {
            c.pos.x += c.dir * c.speed * dt;
            if (c.pos.x > 200) { c.pos.x = 200; c.axis = 'z'; c.dir = 1; c.heading = 0; }
            if (c.pos.x < -200) { c.pos.x = -200; c.axis = 'z'; c.dir = -1; c.heading = Math.PI; }
          } else {
            c.pos.z += c.dir * c.speed * dt;
            if (c.pos.z > 200) { c.pos.z = 200; c.axis = 'x'; c.dir = -1; c.heading = -Math.PI / 2; }
            if (c.pos.z < -200) { c.pos.z = -200; c.axis = 'x'; c.dir = 1; c.heading = Math.PI / 2; }
          }
          c.mesh.group.position.copy(c.pos);
          c.mesh.group.rotation.y = c.heading;
          this.setMarker(c.pos.x, c.pos.z);
          const d = dist2(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
          if (d < 8) {
            st.spotted += dt;
            st.objective = 'TOO CLOSE! Back off!';
            if (st.spotted > 2) { this.fail('You were spotted. The courier bolted.'); return; }
          } else if (d > 60) {
            st.lost += dt;
            st.objective = 'You lost him! Catch up!';
            if (st.lost > 5) { this.fail('You lost the courier.'); return; }
          } else {
            st.spotted = Math.max(0, st.spotted - dt);
            st.lost = Math.max(0, st.lost - dt);
            if (d >= 12 && d <= 45) st.followTime += dt;
            st.objective = 'Tail the blue car — ' + Math.max(0, Math.ceil(30 - st.followTime)) + 's left';
          }
          if (st.followTime >= 30) this.complete();
        },
        reward: 350,
      },
      {
        name: 'Pickup',
        brief: 'Three drops stashed around Solmar Bay. Collect them all.',
        start: (st) => {
          st.objective = 'Collect the drops (0/3)';
          st.drops = [
            { x: -78, z: 26, got: false },
            { x: 78, z: -78, got: false },
            { x: 26, z: 130, got: false },
          ];
          st.got = 0;
          this.setMarker(st.drops[0].x, st.drops[0].z);
        },
        update: (st, dt) => {
          const p = G.player;
          for (const d of st.drops) {
            if (!d.got && dist2(p.pos.x, p.pos.z, d.x, d.z) < 7) {
              d.got = true;
              st.got++;
              G.audio.pickup();
              G.hud.toast('Drop collected (' + st.got + '/3)');
              const next = st.drops.find((x) => !x.got);
              if (next) this.setMarker(next.x, next.z);
            }
          }
          st.objective = 'Collect the drops (' + st.got + '/3)';
          if (st.got >= 3) this.complete();
        },
        reward: 400,
      },
      {
        name: 'The Big Score',
        brief: 'Two stores, one night. Rob them both, then vanish.',
        start: (st) => {
          st.objective = 'Rob the first store — hold E inside the marker';
          st.stores = [
            { x: -26, z: -78, robbed: false },
            { x: 130, z: 78, robbed: false },
          ];
          st.stage = 0;
          st.hold = 0;
          this.setMarker(st.stores[0].x, st.stores[0].z);
        },
        update: (st, dt) => {
          const G = this.G, p = G.player;
          const target = st.stage < 2 ? st.stores[st.stage] : null;
          if (target) {
            const d = dist2(p.pos.x, p.pos.z, target.x, target.z);
            if (d < 9) {
              G.missions.holdTarget = true;
              if (G.input.e) {
                st.hold += dt;
                st.objective = 'Robbing... ' + Math.ceil(5 - st.hold) + 's (hold E)';
                if (st.hold >= 5) {
                  target.robbed = true;
                  st.hold = 0;
                  G.missions.holdTarget = false;
                  addWanted(G, 2, 'robbed a store');
                  G.audio.pickup();
                  G.hud.toast('Store robbed! +' + '$300');
                  G.money += 300;
                  st.stage++;
                  if (st.stage === 1) {
                    this.setMarker(st.stores[1].x, st.stores[1].z);
                    st.objective = 'Rob the second store';
                  } else if (st.stage === 2) {
                    this.setMarker(G.city.safehouse.x, G.city.safehouse.z);
                    st.objective = 'Escape to the safehouse!';
                    G.hud.toast('Both stores hit! Lose the heat!');
                  }
                }
              } else {
                st.hold = Math.max(0, st.hold - dt * 2);
                st.objective = 'Rob the store — hold E inside the marker';
              }
            } else {
              G.missions.holdTarget = false;
              st.objective = st.stage === 0 ? 'Rob the first store' : 'Rob the second store';
            }
          } else if (dist2(p.pos.x, p.pos.z, G.city.safehouse.x, G.city.safehouse.z) < 9) {
            this.complete();
          }
        },
        reward: 800,
      },
    ];
  }

  setMarker(x, z) {
    this.marker = { x, z };
    if (this.beacon) {
      this.G.scene.remove(this.beacon);
      this.beacon = null;
    }
    this.beacon = makeBeacon();
    this.beacon.position.set(x, 0, z);
    this.G.scene.add(this.beacon);
  }

  clearMarker() {
    this.marker = null;
    if (this.beacon) {
      this.G.scene.remove(this.beacon);
      this.beacon = null;
    }
  }

  startMission(i) {
    this.idx = i;
    const m = this.list[i];
    this.active = { objective: m.brief, stage: 0 };
    m.start(this.active);
    this.G.hud.toast('MISSION ' + (i + 1) + ': ' + m.name);
    this.G.save();
  }

  update(dt) {
    if (!this.active || this.idx >= this.list.length) return;
    const m = this.list[this.idx];
    m.update(this.active, dt);
    // beacon pulse + marker distance
    if (this.beacon) {
      this.beacon.userData.gem.position.y = 5.5 + Math.sin(this.G.time * 3) * 0.6;
      this.beacon.userData.gem.rotation.y += dt * 1.5;
    }
    if (this.marker) {
      this.markerDist = dist2(this.G.player.pos.x, this.G.player.pos.z, this.marker.x, this.marker.z);
    }
  }

  complete() {
    const m = this.list[this.idx];
    if (this.courier) {
      this.courier.isCourier = false;
      this.courier.baseSpeed = 11;
      this.courier = null;
    }
    this.G.money += m.reward;
    this.G.hud.toast('MISSION COMPLETE — +$' + m.reward);
    this.G.audio.jingle();
    this.active = null;
    this.clearMarker();
    this.idx++;
    this.G.save();
    if (this.idx >= this.list.length) {
      this.G.storyDone = true;
      this.G.state = 'complete';
      this.G.hud.showComplete();
    } else {
      // small breather, then next mission starts on demand via Mara call
      this.G.missions.pendingNext = true;
      this.G.hud.toast('Next job ready — press N to call Mara.');
    }
  }

  fail(reason) {
    if (this.courier) {
      this.courier.isCourier = false;
      this.courier.baseSpeed = 11;
      this.courier = null;
    }
    this.G.hud.toast('MISSION FAILED — ' + reason);
    this.G.audio.fail();
    this.active = null;
    this.clearMarker();
    // restart same mission after a beat
    this.G.missions.pendingRetry = true;
    this.G.hud.toast('Press N to retry the job.');
  }
}
