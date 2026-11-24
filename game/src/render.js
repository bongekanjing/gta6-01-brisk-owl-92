// Everything three.js: the sun-soaked city, its buildings, palms, traffic meshes and the effects.
// The simulation never imports this file; it owns only numbers, and this turns those numbers into
// a picture. Geometry is built once at boot and reused, so a frame allocates almost nothing.
import * as THREE from '../vendor/three.min.js';
import { COLORS, CITY, HALF_SPAN } from './config.js';
import { CITY_NAME, blockOrigin, ROAD_CENTRES } from './city.js';

const SKY_VERT = `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDir;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld);
  float h = clamp(dir.y * 1.15 + 0.06, 0.0, 1.0);
  vec3 col = mix(horizonColor, topColor, pow(h, 0.72));
  float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 220.0);
  // A separate, much wider falloff gives the sun a visible disc and halo instead of a single hot
  // pixel — key art needs a readable light source.
  float disc = smoothstep(0.9975, 0.9990, dot(dir, normalize(sunDir)));
  float glow = pow(max(dot(dir, normalize(sunDir)), 0.0), 6.0) * 0.28;
  col += vec3(1.0, 0.86, 0.62) * (sun * 1.7 + glow + disc * 1.15);
  // The uniforms are linear (three converts Color on upload) but this shader writes straight to an
  // sRGB framebuffer, so encode here or the sky comes out several stops too dark.
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // No tone mapping: ACES crushes a sunlit low-poly city into a dim dusk, and it would apply to the
  // meshes but not to the sky shader, so the two would disagree at the horizon.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 210, 720);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);

  // A high afternoon sun: the city should read as sun-soaked, not dusk.
  // A low sun: at 86° elevation every cast shadow fell straight under its object, so the whole city
  // read as ungrounded. ~28° gives long shadows down the boulevard and a real sense of sun.
  const sunDir = new THREE.Vector3(-0.62, 0.46, 0.64).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 20),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        topColor: { value: new THREE.Color(COLORS.skyTop) },
        horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
        sunDir: { value: sunDir },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  scene.add(sky);

  const sun = new THREE.DirectionalLight(COLORS.sun, COLORS.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(180);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  const span = 150;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  // three only calls updateMatrices() on the shadow camera per frame; it never rebuilds the
  // projection matrix, so changing left/right/top/bottom above does nothing until this call. Without
  // it the shadow map keeps the default 10x10 m frustum and the entire city is outside it.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(COLORS.ambient, 0x9c8a6e, COLORS.ambientIntensity));

  // ---------------------------------------------------------------- ground
  const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.grass });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF_SPAN * 2 + 400, HALF_SPAN * 2 + 400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // One asphalt slab per road strip, plus the painted centre lines.
  const roadMat = new THREE.MeshLambertMaterial({ color: COLORS.asphalt });
  const walkMat = new THREE.MeshLambertMaterial({ color: COLORS.sidewalk });
  const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
  const roadGeo = new THREE.PlaneGeometry(1, 1);
  const long = HALF_SPAN * 2 + CITY.roadWidth;

  for (const centre of ROAD_CENTRES) {
    for (const axis of [0, 1]) {
      const strip = new THREE.Mesh(roadGeo, roadMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(axis === 0 ? centre : 0, 0.02, axis === 0 ? 0 : centre);
      strip.scale.set(axis === 0 ? CITY.roadWidth : long, axis === 0 ? long : CITY.roadWidth, 1);
      strip.receiveShadow = true;
      scene.add(strip);

      // Dashed centre line.
      for (let t = -HALF_SPAN; t < HALF_SPAN; t += 9) {
        const dash = new THREE.Mesh(roadGeo, lineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(axis === 0 ? centre : t, 0.04, axis === 0 ? t : centre);
        dash.scale.set(axis === 0 ? 0.28 : 4.2, axis === 0 ? 4.2 : 0.28, 1);
        scene.add(dash);
      }
    }
  }

  // Pavements: a raised kerb slab around every city block.
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const cx = blockOrigin(bx) + CITY.blockSize / 2;
      const cz = blockOrigin(bz) + CITY.blockSize / 2;
      const kerb = new THREE.Mesh(blockGeo, walkMat);
      kerb.position.set(cx, 0.09, cz);
      kerb.scale.set(CITY.blockSize + 3, 0.18, CITY.blockSize + 3);
      kerb.receiveShadow = true;
      scene.add(kerb);
      const park = new THREE.Mesh(blockGeo, groundMat);
      park.position.set(cx, 0.2, cz);
      park.scale.set(CITY.blockSize - 1, 0.2, CITY.blockSize - 1);
      park.receiveShadow = true;
      scene.add(park);
    }
  }

  // ---------------------------------------------------------------- buildings
  const windowMat = new THREE.MeshLambertMaterial({ color: COLORS.window });
  const buildingGroup = new THREE.Group();
  scene.add(buildingGroup);
  const neonMats = COLORS.neon.map((c) => new THREE.MeshBasicMaterial({ color: c }));

  function addBuilding(b) {
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.building[b.shade % COLORS.building.length] });
    const box = new THREE.Mesh(blockGeo, mat);
    box.position.set(b.x, b.h / 2 + 0.2, b.z);
    box.scale.set(b.w, b.h, b.d);
    box.castShadow = true;
    box.receiveShadow = true;
    buildingGroup.add(box);

    // A slab roof and a plinth so the silhouette is not a bare box.
    const roof = new THREE.Mesh(blockGeo, new THREE.MeshLambertMaterial({
      color: COLORS.roof[b.shade % COLORS.roof.length],
    }));
    roof.position.set(b.x, b.h + 0.75, b.z);
    roof.scale.set(b.w + 1.1, 0.7, b.d + 1.1);
    roof.castShadow = true;
    buildingGroup.add(roof);

    // Window bands. They sit proud of the facade rather than flush: a 0.07 m offset z-fights
    // against the wall at this depth range and the bands disappear entirely.
    const floors = Math.max(3, Math.min(16, Math.floor(b.h / 5.5)));
    const floorH = b.h / (floors + 1);
    for (let f = 1; f <= floors; f += 1) {
      const y = floorH * f + 0.2;
      const hgt = Math.max(1.0, floorH * 0.44);
      for (const side of [-1, 1]) {
        // Front/back faces (facing +/- z).
        const nz = new THREE.Mesh(blockGeo, windowMat);
        nz.position.set(b.x, y, b.z + side * (b.d / 2 + 0.16));
        nz.scale.set(b.w * 0.9, hgt, 0.34);
        buildingGroup.add(nz);
        // Side faces (facing +/- x).
        const nx = new THREE.Mesh(blockGeo, windowMat);
        nx.position.set(b.x + side * (b.w / 2 + 0.16), y, b.z);
        nx.scale.set(0.34, hgt, b.d * 0.9);
        buildingGroup.add(nx);
      }
    }

    // Neon crown on a few towers: a bright ring that reads at a glance in a screenshot.
    if (b.neon >= 0 && b.h > 30) {
      const crown = new THREE.Mesh(blockGeo, neonMats[b.neon]);
      crown.position.set(b.x, b.h + 1.2, b.z);
      crown.scale.set(b.w + 1.6, 0.5, b.d + 1.6);
      buildingGroup.add(crown);
      const mast = new THREE.Mesh(blockGeo, neonMats[b.neon]);
      mast.position.set(b.x, b.h + 4.4, b.z);
      mast.scale.set(0.36, 6, 0.36);
      buildingGroup.add(mast);
    }
  }

  // ---------------------------------------------------------------- palms and lamps
  const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.trunk });
  const frondMat = new THREE.MeshLambertMaterial({ color: COLORS.palm });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1, 6);
  const frondGeo = new THREE.ConeGeometry(0.9, 4.4, 5, 1, true);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });

  function addPalm(p) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(p.x, p.h / 2, p.z);
    trunk.scale.set(1, p.h, 1);
    trunk.rotation.z = p.lean;
    trunk.castShadow = true;
    scene.add(trunk);
    for (let i = 0; i < 5; i += 1) {
      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.set(p.x + p.lean * p.h, p.h, p.z);
      frond.rotation.z = Math.PI / 2 + p.lean;
      frond.rotation.y = (i / 5) * Math.PI * 2;
      frond.castShadow = true;
      scene.add(frond);
    }
  }

  function addLamp(l) {
    const post = new THREE.Mesh(trunkGeo, lampMat);
    post.position.set(l.x, 3, l.z);
    post.scale.set(0.6, 6, 0.6);
    scene.add(post);
    const head = new THREE.Mesh(blockGeo, lampMat);
    head.position.set(l.x, 6.2, l.z);
    head.scale.set(0.7, 0.7, 0.7);
    scene.add(head);
  }

  // ---------------------------------------------------------------- traffic + peds + police
  const carBodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1c });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x8fc4e8 });

  function makeCar(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color }));
    body.scale.set(1.9, 0.85, 4.3);
    body.position.y = 0.75;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(carBodyGeo, glassMat);
    cabin.scale.set(1.66, 0.72, 2.0);
    cabin.position.set(0, 1.44, -0.15);
    cabin.castShadow = true;
    g.add(cabin);
    for (const sx of [-0.94, 0.94]) {
      for (const sz of [-1.42, 1.42]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.42, sz);
        g.add(wheel);
      }
    }
    scene.add(g);
    return g;
  }

  function makePerson(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color }));
    body.scale.set(0.52, 1.12, 0.34);
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color: 0xe0b089 }));
    head.scale.set(0.3, 0.32, 0.3);
    head.position.y = 1.5;
    head.castShadow = true;
    g.add(head);
    // Arms and legs. A torso-and-head blob reads as a placeholder prop at screenshot size; four
    // limbs are enough to read unmistakably as a person walking.
    for (const sx of [-0.34, 0.34]) {
      const arm = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color }));
      arm.scale.set(0.14, 0.62, 0.16);
      arm.position.set(sx, 0.86, 0);
      arm.castShadow = true;
      g.add(arm);
      const leg = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color: 0x2c3646 }));
      leg.scale.set(0.18, 0.6, 0.2);
      leg.position.set(sx * 0.55, 0.3, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    scene.add(g);
    return g;
  }

  function makePoliceCar() {
    const g = makeCar(COLORS.police);
    // A dark door panel and an oversized light bar: at 1280 px the bar is a handful of pixels, so it
    // has to be big and saturated to be legible as a police car rather than a white sedan.
    const panel = new THREE.Mesh(carBodyGeo, new THREE.MeshLambertMaterial({ color: 0x141a26 }));
    panel.scale.set(1.95, 0.5, 2.1);
    panel.position.set(0, 0.72, 0.1);
    g.add(panel);
    const bar = new THREE.Mesh(carBodyGeo, new THREE.MeshBasicMaterial({ color: 0xff2244 }));
    bar.scale.set(1.5, 0.3, 0.5);
    bar.position.set(0, 1.98, -0.1);
    g.add(bar);
    return { group: g, bar };
  }

  return {
    scene,
    camera,
    renderer,
    sun,
    sunDir,
    /** A fresh Vector3 from three, so callers outside this module need no import of their own. */
    THREE_Vector3: () => new THREE.Vector3(),
    addBuilding,
    addPalm,
    addLamp,
    makeCar,
    makePerson,
    makePoliceCar,
    neonMats,
    /** Fill the static city in one pass, after the plan is known. */
    build(plan) {
      for (const b of plan.buildings) addBuilding(b);
      for (const p of plan.palms) addPalm(p);
      for (const l of plan.lamps) addLamp(l);
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    /** Keep the shadow camera and the sky centred on the player. */
    follow(x, z) {
      sun.position.set(x + sunDir.x * 180, sunDir.y * 180, z + sunDir.z * 180);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
      sky.position.set(x, 0, z);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}

export { CITY_NAME };
