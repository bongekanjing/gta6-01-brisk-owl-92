// Every tuning number and palette colour in one place. The city is laid out in metres on a grid;
// the simulation runs at a fixed step so physics and traffic behave the same on every machine.
export const STEP = 1 / 60;

/** The city grid: blocks of buildings separated by roads, N by N cells. */
export const CITY = {
  blocks: 7,
  blockSize: 64,
  roadWidth: 22,
  sidewalk: 4,
  buildingMinGap: 6,
  lotsPerBlock: 3,
};

/** Where a grid line with that index falls, in metres, along one axis. */
export const CELL = CITY.blockSize + CITY.roadWidth;
export const CITY_SPAN = CITY.blocks * CELL + CITY.roadWidth;
export const HALF_SPAN = CITY_SPAN / 2;

export const PLAYER = {
  radius: 0.45,
  height: 1.75,
  walkSpeed: 5.4,
  runSpeed: 11.2,
  eyeHeight: 1.62,
  jumpSpeed: 5.2,
  gravity: -19.5,
};

export const VEHICLE = {
  maxSpeed: 34,
  reverseSpeed: 9,
  accel: 15.5,
  brake: 26,
  drag: 1.6,
  steer: 1.9,
  enterRadius: 3.4,
  width: 1.9,
  length: 4.3,
};

export const TRAFFIC = {
  count: 120,
  minSpeed: 6.5,
  maxSpeed: 12.5,
  stopDistance: 7.5,
  laneOffset: 4.2,
};

export const PEDS = {
  count: 150,
  walkSpeed: 1.5,
  panicSpeed: 4.6,
  runRadius: 16,
};

export const POLICE = {
  maxStars: 5,
  carsPerStar: 1,
  carSpeed: 22,
  officerSpeed: 4.4,
  shootRange: 26,
  shootDamage: 7,
  burstInterval: 0.55,
  spawnRadius: 78,
  despawnRadius: 150,
  clearSeconds: 26,
  bustRadius: 3.0,
};

export const CRIME = {
  killPed: 2,
  killCop: 3,
  wreckCar: 1,
  hitPed: 2,
  heatPerStar: 55,
};

export const PLAYER_HEALTH = 100;
export const ARMOUR_MAX = 100;

export const COLORS = {
  sun: 0xfff6e0,
  // three r155+ treats light intensity physically: a directional light needs roughly pi times the
  // old value to look the same. These are tuned by pixel census instead: at sunIntensity 7.4 the lit
  // facades clipped to 255 and a tenth of the frame sat at near-white, which flattens every cast
  // shadow into invisibility.
  sunIntensity: 3.1,
  ambient: 0xbfd8f2,
  ambientIntensity: 1.15,
  skyTop: 0x2a8fd8,
  skyHorizon: 0xffe3b8,
  fog: 0xcfe0ee,
  asphalt: 0x4a4f59,
  line: 0xf5e08a,
  sidewalk: 0xb8bec6,
  grass: 0x5f8a46,
  building: [0xe8d2b0, 0xd6bb95, 0xefe0c4, 0xcbae90, 0xdcc4a4, 0xe6d0b8],
  window: 0x39566e,
  roof: [0x9d9689, 0x8a8378, 0xaaa396, 0x928a7d],
  neon: [0xff5c8a, 0x4fe0d0, 0xffd166, 0x9b6bff],
  palm: 0x4a7d38,
  trunk: 0x7d6440,
  car: [0xc1272d, 0x1b6ca8, 0xf2c94c, 0x2f9e62, 0xe8e8e8, 0x2b2b2b, 0x8e44ad],
  // Police have to read as police at a glance in a screenshot: a near-black navy body disappeared
  // into ordinary traffic. White with a dark nose and a bright bar, as real cruisers are.
  police: 0xf2f4f8,
  ped: [0x7a5195, 0xbc5090, 0xef5675, 0xff764f, 0xffa600, 0x3f8f7f, 0x4a7fd4],
};

/** The trophy list is the story: each mission unlocks the next and pays out. */
export const MISSIONS = [
  { id: 'wakeup', name: 'Wake Up Call', reward: 250, brief: 'Drive to the marina and meet Rico.', target: 'marina' },
  { id: 'drop', name: 'The Drop', reward: 400, brief: 'Collect the package from the pier and lose the cops.', target: 'pier', wanted: 2 },
  { id: 'chase', name: 'Wrong Turn', reward: 600, brief: 'Chase the courier down the boulevard.', target: 'tower' },
  { id: 'heist', name: 'Last Light Heist', reward: 1200, brief: 'Reach the tower roof with the score.', target: 'tower', wanted: 3 },
];
