// The simulation, with no three.js in it: the player on foot and in a car, the traffic that drives
// the grid, the pedestrians who walk the pavements, the police who chase a wanted player, and the
// rules that tie them together (health, armour, money, the wanted level and the missions). The
// renderer reads `state` every frame and never writes to it.
import { ARMOUR_MAX, CITY, CRIME, HALF_SPAN, MISSIONS, PLAYER, PLAYER_HEALTH, POLICE, PEDS, TRAFFIC, VEHICLE } from './config.js';
import { hitsBuilding, LANDMARKS, nearestRoad } from './city.js';

export const MODE_FOOT = 0;
export const MODE_CAR = 1;

export const EVENT_SHOT = 1;
export const EVENT_HIT = 2;
export const EVENT_DEAD = 4;
export const EVENT_BUSTED = 8;
export const EVENT_CRIME = 16;
export const EVENT_MISSION = 32;
export const EVENT_ENTER_CAR = 64;
export const EVENT_EXIT_CAR = 128;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function createSim(random) {
  const state = {
    player: {
      x: 0, y: 0, z: 0,
      vx: 0, vz: 0, vy: 0,
      angle: 0,
      health: PLAYER_HEALTH,
      armour: 0,
      money: 0,
      mode: MODE_FOOT,
      car: -1,
      onGround: true,
      wanted: 0,
      heat: 0,
      cool: 0,
      dead: false,
      busted: false,
      weapon: 0,
      ammo: 24,
      fireCooldown: 0,
    },
    cars: [],
    peds: [],
    cops: [],
    cops2: [],
    shots: [],
    mission: { index: 0, active: true, complete: false, objectives: 0 },
    time: 0,
    events: 0,
  };

  // ---------------------------------------------------------------- world seeding
  function roadPoint(index) {
    // Pick a point on a road strip far from the middle, on the axis asked for.
    for (let tries = 0; tries < 40; tries += 1) {
      const axis = random.chance(0.5) ? 0 : 1;
      const centre = ROADS[random.int(0, ROADS.length - 1)];
      const along = random.range(-HALF_SPAN + 8, HALF_SPAN - 8);
      const x = axis === 0 ? centre : along;
      const z = axis === 0 ? along : centre;
      if (Math.hypot(x, z) > 18) return { x, z, axis };
    }
    return { x: 0, z: 60, axis: 0 };
  }

  /**
   * Pull a share of the traffic and the crowd towards a point. The city is ~600 m across, so a
   * uniform scatter leaves whatever the camera is looking at empty; concentrating a third of both
   * populations around the player is what makes the street read as a living city.
   */
  function clusterAround(x, z, radius, carShare = 0.34, pedShare = 0.55) {
    const cars = Math.floor(state.cars.length * carShare);
    for (let i = 0; i < cars; i += 1) {
      const car = state.cars[i];
      // Spread cars along the boulevard the camera is looking down, in both directions of travel,
      // offset into the two lanes. Biasing the distance towards the near half keeps the street
      // populated in the foreground instead of only at the vanishing point.
      const along = z + (random.chance(0.5) ? 1 : -1) * Math.sqrt(random.range(0, 1)) * radius;
      car.axis = 0;
      car.x = x + (random.chance(0.5) ? 1 : -1) * TRAFFIC.laneOffset * random.range(0.7, 1.15);
      car.z = along;
      car.lane = car.x;
      car.angle = random.chance(0.5) ? 0 : Math.PI;
      car.dir = car.angle === 0 ? 1 : -1;
    }
    const peds = Math.floor(state.peds.length * pedShare);
    for (let i = 0; i < peds; i += 1) {
      const ped = state.peds[i];
      // Line the pavements on both sides of the same boulevard. The offset has to stay between the
      // kerb and the building line: the building fronts sit CITY.sidewalk in from the block edge,
      // so a wider spread buries people inside walls.
      const side = random.chance(0.5) ? 1 : -1;
      ped.x = x + side * (CITY.roadWidth / 2 + CITY.sidewalk * 0.5);
      ped.z = z + random.range(-radius * 0.7, radius * 0.7);
      ped.heading = random.range(0, Math.PI * 2);
    }
  }

  function seedTraffic() {
    for (let i = 0; i < TRAFFIC.count; i += 1) {
      const p = roadPoint();
      state.cars.push({
        x: p.x, z: p.z,
        angle: p.axis === 0 ? (random.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) : (random.chance(0.5) ? 0 : Math.PI),
        speed: random.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed),
        target: random.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed),
        kind: 'traffic',
        color: random.int(0, 6),
        axis: p.axis,
        lane: p.axis === 0 ? p.z : p.x,
        alive: true,
        health: 100,
        turn: 0,
        dir: random.chance(0.5) ? 1 : -1,
      });
    }
  }

  function seedPeds() {
    for (let i = 0; i < PEDS.count; i += 1) {
      const p = roadPoint();
      const jitter = CITY.sidewalk + 1.2;
      state.peds.push({
        x: p.x + random.range(-jitter, jitter),
        z: p.z + random.range(-jitter, jitter),
        angle: random.range(0, Math.PI * 2),
        speed: PEDS.walkSpeed * random.range(0.8, 1.2),
        color: random.int(0, 6),
        panic: 0,
        alive: true,
        phase: random.range(0, 6.28),
        heading: random.range(0, Math.PI * 2),
        retarget: random.range(2, 6),
      });
    }
  }

  // ---------------------------------------------------------------- movement helpers
  function blocked(x, z, radius) {
    if (Math.abs(x) > HALF_SPAN - 2 || Math.abs(z) > HALF_SPAN - 2) return true;
    return hitsBuilding(PLAN, x, z, radius) !== null;
  }

  function moveWithCollision(entity, dx, dz, radius) {
    let nx = entity.x + dx;
    if (!blocked(nx, entity.z, radius)) entity.x = nx;
    let nz = entity.z + dz;
    if (!blocked(entity.x, nz, radius)) entity.z = nz;
  }

  // ---------------------------------------------------------------- the player
  function stepPlayer(dt, input) {
    const p = state.player;
    if (p.dead || p.busted) return;

    p.fireCooldown = Math.max(0, p.fireCooldown - dt);

    if (p.mode === MODE_CAR) {
      const car = state.cars[p.car];
      if (!car || !car.alive) {
        p.mode = MODE_FOOT;
        p.car = -1;
        return;
      }
      const throttle = input.forward - input.back;
      const steerInput = input.right - input.left;

      car.speed += throttle * VEHICLE.accel * dt;
      if (throttle === 0) {
        car.speed -= Math.sign(car.speed) * VEHICLE.drag * dt * 4;
        if (Math.abs(car.speed) < 0.25) car.speed = 0;
      }
      if (input.brake) car.speed -= Math.sign(car.speed) * VEHICLE.brake * dt;
      car.speed = clamp(car.speed, -VEHICLE.reverseSpeed, VEHICLE.maxSpeed);

      const authority = clamp(Math.abs(car.speed) / 6, 0, 1);
      car.angle += steerInput * VEHICLE.steer * dt * authority * Math.sign(car.speed || 1);
      car.angle = wrapAngle(car.angle);

      const vx = Math.sin(car.angle) * car.speed;
      const vz = Math.cos(car.angle) * car.speed;
      const before = { x: car.x, z: car.z };
      moveWithCollision(car, vx * dt, vz * dt, VEHICLE.width * 0.62);
      if (car.x === before.x && car.z === before.z && Math.abs(car.speed) > 12) {
        car.speed *= -0.18;
        state.events |= EVENT_HIT;
        p.health -= Math.abs(car.speed) * 0.35;
      }

      p.x = car.x;
      p.z = car.z;
      p.angle = car.angle;
      p.vx = vx;
      p.vz = vz;

      // Running people over is the loudest crime there is.
      for (const ped of state.peds) {
        if (!ped.alive) continue;
        if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.0 && Math.abs(car.speed) > 4) {
          ped.alive = false;
          addHeat(CRIME.hitPed * (Math.abs(car.speed) > 14 ? 2 : 1));
          state.events |= EVENT_CRIME;
        }
      }
      return;
    }

    // On foot: strafe relative to where the camera looks.
    const forward = input.forward - input.back;
    const strafe = input.right - input.left;
    const speed = input.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const len = Math.hypot(forward, strafe) || 1;
    const dirX = (Math.sin(input.yaw) * forward + Math.cos(input.yaw) * strafe) / len;
    const dirZ = (Math.cos(input.yaw) * forward - Math.sin(input.yaw) * strafe) / len;

    p.vy += PLAYER.gravity * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.onGround = true;
    }
    if (input.jump && p.onGround) {
      p.vy = PLAYER.jumpSpeed;
      p.onGround = false;
    }

    const moveSpeed = (forward || strafe) ? speed : 0;
    moveWithCollision(p, dirX * moveSpeed * dt, dirZ * moveSpeed * dt, PLAYER.radius);
    p.angle = input.yaw;
    p.vx = dirX * moveSpeed;
    p.vz = dirZ * moveSpeed;

    // Walking into a car gets in it.
    if (input.use && p.fireCooldown === 0) {
      for (let i = 0; i < state.cars.length; i += 1) {
        const car = state.cars[i];
        if (!car.alive) continue;
        if (Math.hypot(car.x - p.x, car.z - p.z) < VEHICLE.enterRadius) {
          p.mode = MODE_CAR;
          p.car = i;
          car.kind = 'player';
          car.speed = 0;
          state.events |= EVENT_ENTER_CAR;
          p.fireCooldown = 0.35;
          break;
        }
      }
    }

    // Shooting: a hitscan down the aim line, and the noise brings the police.
    if (input.fire && p.fireCooldown === 0 && p.ammo > 0) {
      p.ammo -= 1;
      p.fireCooldown = 0.16;
      fireShot(p.x, p.z, p.angle);
    }
  }

  function fireShot(x, z, angle) {
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const range = POLICE.shootRange;
    let hit = null;
    let bestT = range;
    for (const cop of state.cops) {
      if (!cop.alive) continue;
      const t = (cop.x - x) * dx + (cop.z - z) * dz;
      if (t <= 0 || t > bestT) continue;
      const perp = Math.abs((cop.x - x) * dz - (cop.z - z) * dx);
      if (perp < 1.0) {
        bestT = t;
        hit = cop;
      }
    }
    for (const ped of state.peds) {
      if (!ped.alive) continue;
      const t = (ped.x - x) * dx + (ped.z - z) * dz;
      if (t <= 0 || t > bestT) continue;
      const perp = Math.abs((ped.x - x) * dz - (ped.z - z) * dx);
      if (perp < 0.9) {
        bestT = t;
        hit = ped;
      }
    }
    state.shots.push({ x, z, angle, life: 0.09, range: bestT, hit: hit ? 1 : 0 });
    if (hit) {
      if (hit.health !== undefined) hit.health -= 45;
      else hit.alive = false;
      if (hit.kind === 'cop' || hit.officer) addHeat(CRIME.killCop * 22);
      else addHeat(CRIME.killPed * 26);
      state.events |= EVENT_SHOT;
      if (hit.health !== undefined && hit.health <= 0) hit.alive = false;
    } else {
      state.events |= EVENT_SHOT;
      addHeat(6);
    }
  }

  function addHeat(amount) {
    const p = state.player;
    p.heat += amount;
    p.cool = POLICE.clearSeconds;
    const wanted = clamp(Math.floor(p.heat / CRIME.heatPerStar), 0, POLICE.maxStars);
    if (wanted > p.wanted) {
      p.wanted = wanted;
      state.events |= EVENT_CRIME;
    }
  }

  // ---------------------------------------------------------------- traffic
  function stepTraffic(dt) {
    const p = state.player;
    for (const car of state.cars) {
      if (!car.alive) continue;
      if (car.kind === 'player') continue;

      // Keep a gap from the car in front, and stop for the player standing in the road.
      const ahead = { x: car.x + Math.sin(car.angle) * 8, z: car.z + Math.cos(car.angle) * 8 };
      let target = car.target;
      for (const other of state.cars) {
        if (other === car || !other.alive) continue;
        const d = Math.hypot(other.x - ahead.x, other.z - ahead.z);
        if (d < TRAFFIC.stopDistance) target = Math.min(target, other.speed * 0.4);
      }
      if (p.mode === MODE_FOOT) {
        const d = Math.hypot(p.x - ahead.x, p.z - ahead.z);
        if (d < 5.5) target = Math.min(target, 0);
      }
      car.speed += clamp(target - car.speed, -brakingLimit(), 6 * dt);

      // At a junction, sometimes turn onto the crossing road.
      const near = car.axis === 0 ? nearestRoad(car.x) : nearestRoad(car.z);
      if (near.dist < 1.2 && car.turn <= 0 && random.chance(0.02)) {
        car.turn = 1.4;
        car.dir = random.chance(0.5) ? 1 : -1;
      }
      if (car.turn > 0) {
        car.turn -= dt;
        const goal = (car.dir > 0 ? 1 : -1) * (Math.PI / 2);
        const want = car.axis === 0 ? goal : -goal;
        car.angle += clamp(wrapAngle(want - (car.axis === 0 ? 0 : Math.PI)) * 4 * dt, -3 * dt, 3 * dt);
      }

      moveWithCollision(car, Math.sin(car.angle) * car.speed * dt, Math.cos(car.angle) * car.speed * dt, 1.2);
      if (Math.abs(car.x) > HALF_SPAN || Math.abs(car.z) > HALF_SPAN) {
        car.alive = false;
      }
    }

    // Recycle cars that drove off the map so the streets never empty.
    for (let i = 0; i < state.cars.length; i += 1) {
      if (!state.cars[i].alive && state.cars[i].kind !== 'player') {
        const p2 = roadPoint();
        const car = state.cars[i];
        car.x = p2.x;
        car.z = p2.z;
        car.axis = p2.axis;
        car.angle = p2.axis === 0 ? Math.PI / 2 : 0;
        car.speed = random.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
        car.target = car.speed;
        car.alive = true;
      }
    }
  }

  function brakingLimit() {
    return VEHICLE.brake * (1 / 60) * 6;
  }

  // ---------------------------------------------------------------- pedestrians
  function stepPeds(dt) {
    const p = state.player;
    for (const ped of state.peds) {
      if (!ped.alive) continue;
      const dx = ped.x - p.x;
      const dz = ped.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < PEDS.runRadius && p.wanted > 0) {
        ped.panic = 3.5;
      }
      if (ped.panic > 0) {
        ped.panic = Math.max(0, ped.panic - dt);
        ped.heading = Math.atan2(dx, dz);
        const speed = PEDS.panicSpeed;
        moveWithCollision(ped, Math.sin(ped.heading) * speed * dt, Math.cos(ped.heading) * speed * dt, 0.4);
        ped.angle = ped.heading;
        continue;
      }
      ped.retarget -= dt;
      if (ped.retarget <= 0) {
        ped.retarget = random.range(2.5, 7);
        ped.heading = random.range(0, Math.PI * 2);
        ped.phase += 1;
      }
      moveWithCollision(ped, Math.sin(ped.heading) * ped.speed * dt, Math.cos(ped.heading) * ped.speed * dt, 0.4);
      ped.angle = ped.heading;
    }
  }

  // ---------------------------------------------------------------- police
  function spawnCop() {
    const p = state.player;
    const angle = random.range(0, Math.PI * 2);
    const dist = POLICE.spawnRadius;
    const x = clamp(p.x + Math.cos(angle) * dist, -HALF_SPAN + 6, HALF_SPAN - 6);
    const z = clamp(p.z + Math.sin(angle) * dist, -HALF_SPAN + 6, HALF_SPAN - 6);
    state.cops.push({
      kind: 'cop',
      x, z,
      angle: Math.atan2(p.x - x, p.z - z),
      speed: 0,
      alive: true,
      health: 100,
      officer: false,
      burst: random.range(0, POLICE.burstInterval),
    });
  }

  function stepPolice(dt) {
    const p = state.player;
    if (p.wanted > 0) {
      const want = Math.min(POLICE.maxStars, p.wanted) * POLICE.carsPerStar;
      while (state.cops.length < want) spawnCop();
      p.cool -= dt;
      if (p.cool <= 0 && p.wanted > 0) {
        p.wanted = Math.max(0, p.wanted - 1);
        p.heat = Math.max(0, p.heat - CRIME.heatPerStar);
        p.cool = POLICE.clearSeconds * 0.6;
      }
    } else if (state.cops.length > 0) {
      for (const cop of state.cops) cop.alive = false;
    }

    for (const cop of state.cops) {
      if (!cop.alive) continue;
      const dx = p.x - cop.x;
      const dz = p.z - cop.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (dist > POLICE.despawnRadius) {
        cop.alive = false;
        continue;
      }
      cop.angle = Math.atan2(dx, dz);
      if (dist > POLICE.shootRange * 0.8) {
        const speed = POLICE.carSpeed;
        moveWithCollision(cop, (dx / dist) * speed * dt, (dz / dist) * speed * dt, 1.3);
      } else {
        cop.burst -= dt;
        if (cop.burst <= 0) {
          cop.burst = POLICE.burstInterval;
          if (p.mode === MODE_FOOT) {
            if (p.armour > 0) p.armour = Math.max(0, p.armour - POLICE.shootDamage);
            else p.health -= POLICE.shootDamage;
            state.events |= EVENT_HIT;
            if (p.health <= 0) {
              p.health = 0;
              p.dead = true;
              state.events |= EVENT_DEAD;
            }
          }
        }
      }
      // Busted: a cop standing right on you with the player on foot.
      if (p.mode === MODE_FOOT && dist < POLICE.bustRadius && p.wanted >= 2) {
        p.busted = true;
        state.events |= EVENT_BUSTED;
      }
    }
    state.cops = state.cops.filter((c) => c.alive);
  }

  // ---------------------------------------------------------------- missions
  function stepMission() {
    const m = state.mission;
    if (!m.active || m.complete) return;
    const mission = MISSIONS[m.index];
    if (!mission) return;
    const target = LANDMARKS[mission.target];
    if (!target) return;
    const p = state.player;
    if (Math.hypot(p.x - target.x, p.z - target.z) < 6) {
      p.money += mission.reward;
      m.index += 1;
      m.objectives += 1;
      if (m.index >= MISSIONS.length) m.complete = true;
      state.events |= EVENT_MISSION;
      if (mission.wanted) addHeat(mission.wanted * CRIME.heatPerStar);
    }
  }

  // ---------------------------------------------------------------- the frame
  function step(dt, input) {
    state.time += dt;
    state.events = 0;
    stepPlayer(dt, input);
    stepTraffic(dt);
    stepPeds(dt);
    stepPolice(dt);
    stepMission();
    for (const s of state.shots) s.life -= dt;
    state.shots = state.shots.filter((s) => s.life > 0);
    return state.events;
  }

  function respawn() {
    const p = state.player;
    p.health = PLAYER_HEALTH;
    p.armour = 0;
    p.dead = false;
    p.busted = false;
    p.wanted = 0;
    p.heat = 0;
    p.cool = 0;
    p.mode = MODE_FOOT;
    p.car = -1;
    p.x = 0;
    p.z = 30;
    p.y = 0;
    state.cops.length = 0;
    for (const c of state.cars) if (c.kind === 'player') c.kind = 'traffic';
    state.events = 0;
  }

  // ---------------------------------------------------------------- progress save
  // Only what a player would expect to survive a reload: where they are, what they own, how far the
  // story got. The traffic and the crowd are regenerated from the seed instead of being stored, so
  // a save stays a few hundred bytes and can never go stale.
  const SAVE_KEY = 'vice-verano-save-v1';

  function snapshot() {
    const p = state.player;
    const m = state.mission;
    return {
      v: 1,
      x: Math.round(p.x * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      angle: Math.round(p.angle * 100) / 100,
      health: Math.round(p.health),
      armour: Math.round(p.armour),
      money: Math.round(p.money),
      ammo: p.ammo,
      weapon: p.weapon,
      wanted: p.wanted,
      mission: { index: m.index, active: m.active, complete: m.complete, objectives: m.objectives },
      time: Math.round(state.time),
    };
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
      return true;
    } catch {
      return false; // Private mode, or storage turned off: the game must still play.
    }
  }

  function hasSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      return d && d.v === 1 && Number.isFinite(d.x) && Number.isFinite(d.z);
    } catch {
      return false;
    }
  }

  function load() {
    let d;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      d = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!d || d.v !== 1) return false;
    const p = state.player;
    p.x = Number(d.x) || 0;
    p.z = Number(d.z) || 30;
    p.y = 0;
    p.angle = Number(d.angle) || 0;
    p.health = clamp(Number(d.health) || PLAYER_HEALTH, 1, PLAYER_HEALTH);
    p.armour = clamp(Number(d.armour) || 0, 0, ARMOUR_MAX);
    p.money = Number(d.money) || 0;
    p.ammo = Number.isFinite(d.ammo) ? d.ammo : 24;
    p.weapon = Number(d.weapon) || 0;
    p.wanted = clamp(Number(d.wanted) || 0, 0, POLICE.maxStars);
    p.dead = false;
    p.busted = false;
    p.mode = MODE_FOOT; // Never restore straight into a car: the car pool is regenerated.
    p.car = -1;
    p.heat = 0;
    p.cool = 0;
    if (d.mission) {
      state.mission.index = clamp(Number(d.mission.index) || 0, 0, MISSIONS.length - 1);
      state.mission.active = Boolean(d.mission.active);
      state.mission.complete = Boolean(d.mission.complete);
      state.mission.objectives = Number(d.mission.objectives) || 0;
    }
    state.time = Number(d.time) || 0;
    state.cops.length = 0;
    for (const c of state.cars) if (c.kind === 'player') c.kind = 'traffic';
    return true;
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch { /* nothing to do */ }
  }

  // Placement needs the plan, which the caller passes in at boot.
  let PLAN = null;
  let ROADS = [];
  function seed(plan, roads) {
    PLAN = plan;
    ROADS = roads;
    seedTraffic();
    seedPeds();
    const p = state.player;
    p.x = 0;
    p.z = 30;
    p.angle = Math.PI;
    p.money = 0;
    p.wanted = 0;
  }

  return {
    state, step, respawn, seed, addHeat, fireShot, clusterAround,
    save, load, hasSave, clearSave, snapshot,
  };
}
