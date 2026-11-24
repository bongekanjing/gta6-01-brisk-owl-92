// Boot and the one loop. The world is planned, the renderer fills it in, and then every frame reads
// the input, advances the simulation in fixed steps, and paints: the world from the player's camera
// through three.js, then the HUD on the 2D canvas over it.
//
// ?shot=cover|city|chase|mission stages a scene instead of running the loop, paints it until the
// world has settled and sets window.__shotReady for the screenshot pass.
import { COLORS, HALF_SPAN, MISSIONS, STEP } from './config.js';
import { CITY_NAME, createRandomPlan, LANDMARKS } from './city.js';
import { createRenderer } from './render.js';
import { createSim, MODE_CAR, MODE_FOOT } from './sim.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';
import { createRandom } from './random.js';

const MAX_FRAME = 0.2;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const fovParam = Number.parseInt(params.get('fov') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261119;

const viewCanvas = document.getElementById('view');
const hudCanvas = document.getElementById('hud');
const overlay = document.getElementById('overlay');

const random = createRandom(seed);
const plan = createRandomPlan(random);
const world = createSim(random);
world.seed(plan, plan.roads);

const view = createRenderer(viewCanvas);
view.build(plan);
const hud = createHud(hudCanvas);
const input = createInput(viewCanvas);

// Set by tools/shots.js before a scene renders: the cover is shot on a longer lens so the towers do
// not splay and the frame reads as authored art rather than a raw game viewport.
window.__shotFov = Number.isFinite(fovParam) ? fovParam : 0;

// Inspection hooks for tools/{stats,savetest}.js — the save system and the scene's mesh pools are
// otherwise unreachable from outside the module. Cheap, and never touched by the game itself.
window.__world = world;
window.__view = view;
/**
 * Where the player's vehicle lands on screen, in pixels. tools/ndc.js uses it to confirm a screenshot
 * actually frames the car instead of relying on an eyeball judgement.
 */
window.__carFrame = () => {
  const s = world.state;
  const cam = view.camera;
  const car = s.cars[s.player.car];
  if (!car) return null;
  const V = view.THREE_Vector3();
  const half = { x: 1.15, y: 1.3, z: 2.4 };
  const xs = [];
  const ys = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const v = V.set(car.x + sx * half.x, sy * half.y + 1.0, car.z + sz * half.z);
        v.project(cam);
        xs.push(v.x);
        ys.push(v.y);
      }
    }
  }
  const px = (u) => Math.round(((u + 1) / 2) * 1280);
  const py = (u) => Math.round(((1 - u) / 2) * 720);
  return {
    x0: px(Math.min(...xs)), x1: px(Math.max(...xs)),
    y0: py(Math.max(...ys)), y1: py(Math.min(...ys)),
    inFrame: Math.min(...xs) >= -1 && Math.max(...xs) <= 1 && Math.min(...ys) >= -1 && Math.max(...ys) <= 1,
    cam: [Math.round(cam.position.x), Math.round(cam.position.y), Math.round(cam.position.z)],
    car: [Math.round(car.x), Math.round(car.z)],
  };
};
window.__dbg = () => {
  const s = world.state;
  const cam = view.camera;
  const near = s.cars.filter((c) => c.alive && Math.hypot(c.x - cam.position.x, c.z - cam.position.z) < 80);
  return {
    stateCars: s.cars.length,
    statePeds: s.peds.length,
    meshes: { cars: cars.length, peds: peds.length, cops: cops.length },
    visibleCars: cars.filter((m) => m && m.visible).length,
    visiblePeds: peds.filter((m) => m && m.visible).length,
    carsWithin80: near.length,
    pedsWithin80: s.peds.filter((p) => p.alive && Math.hypot(p.x - cam.position.x, p.z - cam.position.z) < 80).length,
    sceneChildren: view.scene.children.length,
    buildingChildren: view.scene.children.filter((c) => c.type === 'Group').map((g) => g.children.length),
    playerMode: s.player.mode,
    player: [Math.round(s.player.x), Math.round(s.player.z)],
    cam: [Math.round(cam.position.x), Math.round(cam.position.y), Math.round(cam.position.z)],
  };
};

function fit() {
  // Use the drawing surface's own client box: window.innerHeight can differ from the canvas once
  // the browser reserves space, and a mismatch leaves an unpainted band at the bottom.
  const w = viewCanvas.clientWidth || window.innerWidth;
  const h = viewCanvas.clientHeight || window.innerHeight;
  view.resize(w, h);
  hud.resize(w, h);
}
window.addEventListener('resize', fit);
// Fit after the first layout pass, and again once fonts are ready, so the canvases match the window.
requestAnimationFrame(fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

// ---------------------------------------------------------------- camera
const camHeight = [4.2, 2.0];
const camBack = [8.4, 0.0];

function placeCamera() {
  const p = world.state.player;
  const inCar = p.mode === MODE_CAR;
  const cam = view.camera;
  const camFov = window.__shotFov;
  if (camFov && cam.fov !== camFov) {
    cam.fov = camFov;
    cam.updateProjectionMatrix();
  }
  const back = inCar ? 11.6 : 5.2;
  const up = inCar ? 4.3 : 2.6;
  const look = inCar ? 1.5 : 1.5;
  const behind = p.angle + Math.PI;
  cam.position.set(p.x + Math.sin(behind) * back, p.y + up, p.z + Math.cos(behind) * back);
  cam.lookAt(p.x + Math.sin(p.angle) * 6, p.y + look, p.z + Math.cos(p.angle) * 6);
  // A touch of lean into corners while driving sells the speed.
  if (inCar) {
    const car = world.state.cars[p.car];
    if (car) cam.rotateZ(-Math.max(-0.05, Math.min(0.05, car.speed * 0.0016)));
  }
  view.follow(p.x, p.z);
}

// ---------------------------------------------------------------- the mesh bookkeeping
const cars = [];
const peds = [];
const cops = [];
// The avatar is built once: a taller, brighter figure than the crowd so the player is findable.
const playerMesh = view.makePerson(0x1f6feb);

function syncMeshes() {
  const s = world.state;
  // Traffic and the player's car share one pool.
  for (let i = 0; i < s.cars.length; i += 1) {
    let mesh = cars[i];
    const car = s.cars[i];
    if (!mesh) {
      mesh = view.makeCar(COLORS.car[car.color % COLORS.car.length]);
      cars[i] = mesh;
    }
    mesh.visible = car.alive;
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.angle;
  }
  for (let i = 0; i < s.peds.length; i += 1) {
    let mesh = peds[i];
    const ped = s.peds[i];
    if (!mesh) {
      mesh = view.makePerson(COLORS.ped[ped.color % COLORS.ped.length]);
      peds[i] = mesh;
    }
    mesh.visible = ped.alive;
    // The kerb slab stands 0.29 m proud of the road, so a body at y=0 has its legs inside it.
    mesh.position.set(ped.x, 0.3, ped.z);
    mesh.rotation.y = ped.angle;
    mesh.scale.y = ped.panic > 0 ? 1.04 : 1;
  }
  // The player's own avatar. Without it an on-foot frame shows an empty lawn and an over-the-
  // shoulder camera pointed at nothing, which reads as a bug in a screenshot.
  if (s.player.dead || s.player.busted) {
    playerMesh.visible = false;
  } else if (s.player.mode === MODE_CAR) {
    playerMesh.visible = false; // the camera is behind the car; the driver is not visible
  } else {
    playerMesh.visible = true;
    playerMesh.position.set(s.player.x, 0.05, s.player.z);
    playerMesh.rotation.y = s.player.angle;
  }

  for (let i = 0; i < s.cops.length; i += 1) {
    let entry = cops[i];
    if (!entry) {
      entry = view.makePoliceCar();
      cops[i] = entry;
    }
    const cop = s.cops[i];
    entry.group.visible = true;
    entry.group.position.set(cop.x, 0, cop.z);
    entry.group.rotation.y = cop.angle;
    // Flash the light bar; the same phase for every car keeps it cheap.
    const on = Math.floor(performance.now() / 160) % 2 === 0;
    entry.bar.material.color.setHex(on ? 0xff2244 : 0x2244ff);
  }
  for (let i = s.cops.length; i < cops.length; i += 1) cops[i].group.visible = false;
}

// ---------------------------------------------------------------- mission card text
function missionLabel() {
  const m = world.state.mission;
  if (m.complete) return null;
  return MISSIONS[m.index] ?? null;
}

function missionTarget() {
  const m = world.state.mission;
  if (m.complete) return null;
  const mission = MISSIONS[m.index];
  if (!mission) return null;
  const mark = LANDMARKS[mission.target];
  if (!mark) return null;
  return { x: mark.x, z: mark.z, label: mark.label };
}

// ---------------------------------------------------------------- screens
function showTitle() {
  const resume = world.hasSave();
  overlay.innerHTML = `
    <div class="card">
      <h1>${CITY_NAME}</h1>
      <p class="tag">An open-world crime game</p>
      <p class="keys"><b>W A S D</b> move &nbsp;·&nbsp; <b>Mouse</b> look &nbsp;·&nbsp; <b>Shift</b> sprint
        &nbsp;·&nbsp; <b>E</b> steal a car &nbsp;·&nbsp; <b>Click</b> shoot &nbsp;·&nbsp; <b>Space</b> jump
        &nbsp;·&nbsp; <b>F5</b> save &nbsp;·&nbsp; <b>F9</b> load</p>
      <p class="go">${resume
        ? 'Press <b>Enter</b> to continue &nbsp;·&nbsp; <b>N</b> for a new game'
        : 'Press <b>Enter</b> or click to play'}</p>
    </div>`;
  overlay.classList.remove('hidden');
}

function hideTitle() {
  overlay.classList.add('hidden');
}

function showBusted(reason) {
  overlay.innerHTML = `
    <div class="card">
      <h1>${reason}</h1>
      <p class="tag">Wasted in ${CITY_NAME}</p>
      <p class="go">Press <b>Enter</b> to get back out there</p>
    </div>`;
  overlay.classList.remove('hidden');
}

// ---------------------------------------------------------------- the loops
function runShot(name) {
  const scene = stageShot(name, world, input);
  // The title card is a full-screen radial gradient; leaving it up would dim every "screenshot".
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  let painted = 0;
  function paint() {
    placeCamera();
    syncMeshes();
    view.render();
    hud.draw(world.state, scene.target, scene.mission, { cover: scene.cover });
    painted += 1;
    window.__shotFrames = painted;
    if (painted < 6) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let screen = 'title';
  let accumulator = 0;
  let last = performance.now();
  let autosave = 0;
  let autosaveMission = -1;
  let autosaveDone = false;
  showTitle();

  function begin(resume) {
    if (resume) world.load();
    else if (screen === 'wasted') world.respawn();
    screen = 'play';
    hideTitle();
  }

  window.addEventListener('keydown', (event) => {
    if (event.code === 'F5') {
      event.preventDefault();
      if (screen === 'play') world.save();
      return;
    }
    if (event.code === 'F9') {
      event.preventDefault();
      if (screen === 'play' && world.hasSave()) world.load();
      return;
    }
    if (screen === 'title') {
      if (event.code === 'KeyN') {
        world.clearSave();
        world.respawn();
        begin(false);
      } else if (event.code === 'Enter' || event.code === 'Space') {
        begin(world.hasSave());
      }
      return;
    }
    if (event.code === 'Enter' || (event.code === 'Space' && screen !== 'play')) {
      if (screen === 'wasted') begin(false);
    }
  });
  viewCanvas.addEventListener('click', () => {
    if (screen === 'title') begin(world.hasSave());
    else if (screen === 'wasted') begin(false);
  });

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    if (screen === 'play') {
      input.turn(dt);
      const values = input.read();
      values.yaw = input.yaw;
      accumulator += dt;
      let guard = 0;
      while (accumulator >= STEP && guard < 8) {
        world.step(STEP, values);
        accumulator -= STEP;
        guard += 1;
      }
      if (world.state.player.dead || world.state.player.busted) {
        screen = 'wasted';
        showBusted(world.state.player.busted ? 'BUSTED' : 'WASTED');
      }
      // Autosave every ten seconds of play, plus on every mission change, so a browser crash costs
      // at most a few seconds of progress.
      autosave += dt;
      const missionNow = world.state.mission;
      if (autosave > 10 || missionNow.index !== autosaveMission || missionNow.complete !== autosaveDone) {
        autosave = 0;
        autosaveMission = missionNow.index;
        autosaveDone = missionNow.complete;
        world.save();
      }
    }

    placeCamera();
    syncMeshes();
    view.render();
    hud.draw(world.state, missionTarget(), missionLabel());
  }

  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
