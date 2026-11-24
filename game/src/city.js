// The city plan, with no three.js in it: the grid of blocks and roads, the footprint and height of
// every building, the palms, the lamp posts and the named places the missions point at. The
// renderer turns this into meshes and the simulation uses its boxes for collision, so the thing
// you drive into is exactly the thing you see.
import { CELL, CITY, CITY_SPAN, HALF_SPAN } from './config.js';

/** Road centre lines run here, on both axes: symmetric about the origin, so the city is centred. */
export const ROAD_CENTRES = [];
for (let index = 0; index <= CITY.blocks; index += 1) {
  ROAD_CENTRES.push(-HALF_SPAN + CITY.roadWidth / 2 + index * CELL);
}

/** Where a city block's buildable lot starts, given its index: blocks sit between two roads. */
export function blockOrigin(index) {
  return -HALF_SPAN + CITY.roadWidth + index * CELL;
}

export const CITY_PLAN = { span: CITY_SPAN, half: HALF_SPAN, roads: ROAD_CENTRES };

/** The greeting the start screen shows. */
export const CITY_NAME = 'Vice Verano';

/**
 * Named places the missions navigate to, as street corners on the grid. Each is a {x, z} in metres
 * at the centre of a buildable lot, so a marker there stands in the open.
 */
export const LANDMARKS = {
  marina: { x: -HALF_SPAN + CELL * 1.5, z: HALF_SPAN - CELL * 1.5, label: 'Marina' },
  pier: { x: HALF_SPAN - CELL * 1.5, z: -HALF_SPAN + CELL * 1.5, label: 'Pier 9' },
  tower: { x: 0, z: 0, label: 'Aurelia Tower' },
  stadium: { x: -HALF_SPAN + CELL * 4.5, z: -HALF_SPAN + CELL * 4.5, label: 'Stadium' },
};

/**
 * Lay out the city: every city block gets a lawn, a pavement ring and one to four buildings set
 * inside its lot with a gap between them. Returns plain numbers, no meshes.
 */
export function createRandomPlan(random) {
  const buildings = [];
  const palms = [];
  const lamps = [];
  const lots = [];

  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const x0 = blockOrigin(bx);
      const z0 = blockOrigin(bz);
      const x1 = x0 + CITY.blockSize;
      const z1 = z0 + CITY.blockSize;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      lots.push({ x0, z0, x1, z1 });

      const inner = {
        x0: x0 + CITY.sidewalk,
        z0: z0 + CITY.sidewalk,
        x1: x1 - CITY.sidewalk,
        z1: z1 - CITY.sidewalk,
      };
      const w = inner.x1 - inner.x0;
      const d = inner.z1 - inner.z0;

      // Split the lot into a 2x2 grid of plots, occasionally merging a pair along one axis. Two
      // buildings per block left the street walls far apart and read as empty lots; four gives a
      // continuous frontage.
      const jx = inner.x0 + w * random.range(0.44, 0.56);
      const jz = inner.z0 + d * random.range(0.44, 0.56);
      const merge = random.chance(0.3);
      const cells = [];
      for (const [ax, az] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (merge && az === 1 && ax === 1) continue;
        const c = {
          x0: ax === 0 ? inner.x0 : jx,
          x1: ax === 0 ? jx : inner.x1,
          z0: az === 0 ? inner.z0 : jz,
          z1: az === 0 ? jz : inner.z1,
        };
        if (merge && az === 1 && ax === 0) {
          c.x1 = inner.x1;
        }
        cells.push(c);
      }

      for (const cell of cells) {
        // A shallow setback: big gaps in front of every tower are what made the street feel bare.
        const pad = random.range(0.6, 1.8);
        const bx0 = cell.x0 + pad;
        const bz0 = cell.z0 + pad;
        const bx1 = cell.x1 - pad;
        const bz1 = cell.z1 - pad;
        const bw = bx1 - bx0;
        const bd = bz1 - bz0;
        if (bw < 6 || bd < 6) continue;
        // Taller towers near the middle of the map, low shops at the edges.
        const distance = Math.hypot(cx, cz) / HALF_SPAN;
        const tall = (1 - distance) ** 2;
        const height = Math.max(8, random.range(9, 26) + tall * random.range(22, 88));
        buildings.push({
          x: (bx0 + bx1) / 2,
          z: (bz0 + bz1) / 2,
          w: bw,
          d: bd,
          h: height,
          shade: random.int(0, 5),
          lit: random.chance(0.72),
          neon: random.chance(0.2) ? random.pick([0, 1, 2, 3]) : -1,
        });
      }

      // Palms ring the block, a lamp at each corner.
      const ring = [
        [x0 + 1.6, z0 + 1.6],
        [x1 - 1.6, z0 + 1.6],
        [x0 + 1.6, z1 - 1.6],
        [x1 - 1.6, z1 - 1.6],
      ];
      for (const [px, pz] of ring) {
        if (random.chance(0.55)) palms.push({ x: px, z: pz, h: random.range(9, 15), lean: random.range(-0.16, 0.16) });
        else lamps.push({ x: px, z: pz });
      }
    }
  }

  // Keep the map centre clear so the tower landmark has room.
  const center = buildings.reduce(
    (best, b) => (Math.hypot(b.x, b.z) < Math.hypot(best.x, best.z) ? b : best),
    buildings[0],
  );
  center.h = Math.max(center.h, 92);
  center.neon = 2;
  center.w = Math.max(center.w, 16);
  center.d = Math.max(center.d, 16);

  return { buildings, palms, lamps, lots, roads: ROAD_CENTRES };
}

/** True when a point is inside a building footprint (with a little padding). */
export function hitsBuilding(plan, x, z, pad = 0.6) {
  for (const b of plan.buildings) {
    if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return b;
  }
  return null;
}

/** The nearest road centre line on one axis, and how far the point is from it. */
export function nearestRoad(value) {
  let best = ROAD_CENTRES[0];
  let bestDist = Math.abs(value - best);
  for (const centre of ROAD_CENTRES) {
    const dist = Math.abs(value - centre);
    if (dist < bestDist) {
      best = centre;
      bestDist = dist;
    }
  }
  return { centre: best, dist: bestDist };
}
