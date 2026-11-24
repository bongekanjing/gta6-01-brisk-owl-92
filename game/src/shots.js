// The four screenshot scenes behind ?shot=cover|city|chase|mission. Each one plays the real
// simulation forward inside the city — the same rules the player gets — and leaves the world in a
// state worth photographing, so what a screenshot shows is what the game actually does. The scenes
// are deterministic: the same seed always produces the same frame.
import { CRIME, HALF_SPAN, MISSIONS, STEP } from './config.js';
import { LANDMARKS, ROAD_CENTRES } from './city.js';
import { MODE_CAR } from './sim.js';

/** Run the simulation for `seconds` with a fixed input, so a scene can be composed precisely. */
function advance(world, seconds, values) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) world.step(STEP, values);
}

const IDLE = {
  forward: 0, back: 0, left: 0, right: 0, sprint: false,
  jump: false, use: false, fire: false, brake: false, yaw: 0,
};
const DRIVE = { ...IDLE, forward: 1 };

/** A road centre line away from the very edge, for placing the player on a street. */
function innerRoad() {
  return ROAD_CENTRES[Math.floor(ROAD_CENTRES.length / 2)];
}

/** Put the player inside the nearest car to (x, z), so a shot can be taken from behind the wheel. */
function takeCarAt(world, x, z) {
  const s = world.state;
  const p = s.player;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.cars.length; i += 1) {
    const car = s.cars[i];
    if (!car.alive) continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return false;
  const car = s.cars[best];
  p.x = car.x + 1.1;
  p.z = car.z + 1.1;
  car.x = x;
  car.z = z;
  p.x = x + 1.1;
  p.z = z + 1.1;
  world.step(STEP, { ...IDLE, use: true });
  return p.mode === MODE_CAR;
}

/**
 * Park police cars ahead of and beside the player so a pursuit reads in the frame. Two things had to
 * be true: the sim's own spawner picks a random bearing 78 m out (usually behind a building), and
 * anything placed behind the player sits behind the chase camera and is never in shot.
 */
function stagePolice(world, p, stars) {
  const s = world.state;
  s.cops.length = 0;
  const fx = Math.sin(p.angle);
  const fz = Math.cos(p.angle);
  const sx = Math.cos(p.angle);
  const sz = -Math.sin(p.angle);
  // [lateral, forward] — a roadblock ahead and two cars flanking, all inside the camera's frustum.
  const offs = [
    [-7.5, 22], [8, 27], [-11, 34], [12, 39], [0, 46],
  ];
  for (let i = 0; i < Math.min(stars, offs.length); i += 1) {
    const [lat, fwd] = offs[i];
    const cx = p.x + fx * fwd + sx * lat;
    const cz = p.z + fz * fwd + sz * lat;
    // Clear the lane around each cruiser. There are ~120 cars in the boulevard and they were
    // swallowing the police the same way they swallowed the pedestrians: the mesh was there and
    // visible, just occluded.
    for (const car of s.cars) {
      if (car.kind === 'player') continue;
      if (Math.hypot(car.x - cx, car.z - cz) < 9) {
        car.x += 2000; // shove it out of the city rather than reindexing the pool
      }
    }
    s.cops.push({
      kind: 'cop',
      x: cx,
      z: cz,
      angle: p.angle + Math.PI, // facing the player, as a roadblock would
      speed: 0,
      alive: true,
      health: 100,
      officer: false,
      burst: 0,
    });
  }
}

/** Raise the wanted level and let the police arrive. */
function raiseHeat(world, stars) {
  const p = world.state.player;
  world.addHeat(stars * CRIME.heatPerStar);
  p.wanted = stars;
  p.heat = stars * CRIME.heatPerStar;
  p.cool = 60;
  advance(world, 2.2, IDLE);
}

/**
 * Set the world to the named scene and return what the HUD should show: the mission marker on the
 * minimap and the mission card. `cover` is the title view from a boulevard, `city` a drive through
 * the towers, `chase` a police pursuit and `mission` the player reaching a marker on foot.
 */
export function stageShot(name, world) {
  const s = world.state;
  const mid = innerRoad();
  // Gather traffic and pedestrians around wherever this scene is about to happen.
  const focus = name === 'mission'
    ? LANDMARKS[MISSIONS[0].target]
    : { x: mid, z: mid + 20 };
  world.clusterAround(focus.x, focus.z, 62);

  if (name === 'cover') {
    // The key-art frame: the same down-the-boulevard framing that works for `city`, but with a
    // title lockup instead of a live HUD. A three-quarter angle was tried and put the camera across
    // the street with the hero car on the lawn, which reads as a bug rather than a composition.
    const ok = takeCarAt(world, mid, mid + 34);
    const p = s.player;
    p.angle = Math.PI;
    if (ok) {
      const car = s.cars[p.car];
      car.angle = Math.PI;
      car.speed = 24;
      advance(world, 1.6, { ...DRIVE, yaw: Math.PI });
    } else {
      advance(world, 1.6, DRIVE);
    }
    p.money = 4820;
    p.health = 100;
    p.armour = 45;
    p.wanted = 2;
    return { target: null, mission: MISSIONS[2], cover: true };
  }

  if (name === 'city') {
    // Driving a stolen car between the towers, traffic all around.
    const ok = takeCarAt(world, mid, mid + 30);
    const p = s.player;
    p.angle = Math.PI;
    if (ok) {
      const car = s.cars[p.car];
      car.angle = Math.PI;
      car.speed = 22;
      advance(world, 1.9, { ...DRIVE, yaw: Math.PI });
      // The yaw input turns the car during `advance`, and placeCamera frames from the player's
      // heading, so they drift apart and the car ends up half out of frame. Re-align after settling.
      car.angle = Math.PI;
      p.angle = Math.PI;
      car.speed = 16;
    } else {
      advance(world, 1.9, DRIVE);
    }
    s.player.money = 1450;
    return { target: null, mission: MISSIONS[1] };
  }

  if (name === 'chase') {
    // A three-star pursuit: police must be visible in frame, so they are placed in the lanes behind
    // and beside the player instead of at the default random spawn bearing.
    const ok = takeCarAt(world, mid, mid - 10);
    const p = s.player;
    if (ok) {
      const car = s.cars[p.car];
      car.angle = 0;
      car.speed = 20;
    }
    p.angle = 0;
    raiseHeat(world, 3);
    if (ok) advance(world, 0.9, DRIVE);
    if (ok) {
      const car = s.cars[s.player.car];
      if (car) { car.angle = 0; car.speed = 18; }
    }
    s.player.angle = 0;
    stagePolice(world, p, 3);
    s.player.money = 3820;
    s.player.armour = 60;
    s.player.health = 74;
    return { target: null, mission: MISSIONS[2] };
  }

  // mission: on foot at the marker for the mission the player is on, standing on the pavement so the
  // camera behind them is over the road rather than inside a building.
  const mission = MISSIONS[0];
  const mark = LANDMARKS[mission.target];
  const onRoad = ROAD_CENTRES.reduce((a, b) => (Math.abs(b - mark.z) < Math.abs(a - mark.z) ? b : a));
  s.player.x = mark.x + 7.5;
  s.player.z = onRoad + 6;
  s.player.angle = Math.atan2(mark.x - s.player.x, mark.z - s.player.z);
  advance(world, 1.5, IDLE);
  s.player.money = 760;
  return { target: { x: mark.x, z: mark.z, label: mark.label }, mission };
}
