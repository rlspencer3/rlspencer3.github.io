// Hearthwood — Living Town: one call from world records to everything the sim needs (docs/LIVING.md §3.8, §12.3).
// index → buildings → nav → hangout spots, plus the lane polyline and the passer-by route. Pure.

import { CELL } from '../config.js';
import { TUNE, SETS, LANE_FALLBACK, LANE_CELL } from './data.js';
import { indexWorld, detectBuildings, ck, inNav, ci } from './homes.js';
import { buildNav } from './nav.js';
import { findHangouts } from './recipes.js';

const PATHY = new Set(SETS.PATHY);

/**
 * buildWorldModel({ entries, defOf, version, lane, heightAt, tents, validate, isFree }) → WorldModel (§12.3).
 *   entries   world.entries (or an array of records)      defOf   catalog getDef
 *   lane      env LANE points [x, z][] (at least LANE[0..2]; LANE_FALLBACK when missing)
 *   heightAt  env.heightAt(x, z) (0 when missing)          tents   camp tent cells [cx, cz][]
 *   validate  world.validate(rec) → { ok }                 isFree  (rec) → slot empty (world.get(world.keyOf(rec)) undefined)
 */
export function buildWorldModel({ entries, defOf, version = 0, lane, heightAt, tents = [], validate, isFree } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const index = indexWorld(entries, defOf, version);
  const det = detectBuildings(index);
  const nav = buildNav(index, det, { tents });
  const { spots, hangouts } = findHangouts(index, nav, det);
  const hAt = typeof heightAt === 'function' ? heightAt : () => 0;
  const L = Array.isArray(lane) && lane.length >= 3 ? lane : LANE_FALLBACK;
  // lane: LANE[2] → LANE[1] → LANE[0], resampled every 1 m with heightAt for y, then the lane cell's centre
  const lanePts = [];
  const legs = [L[TUNE.LANE_START], ...L.slice(0, TUNE.LANE_START).reverse()];
  for (let k = 0; k < legs.length - 1; k++) {
    const [ax, az] = legs[k], [bx, bz] = legs[k + 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / TUNE.LANE_STEP));
    for (let s = 0; s < n; s++) { const x = ax + (bx - ax) * (s / n), z = az + (bz - az) * (s / n); lanePts.push([x, hAt(x, z), z]); }
  }
  const last = legs[legs.length - 1];
  lanePts.push([last[0], hAt(last[0], last[1]), last[1]]);
  const laneC = nav.centre(LANE_CELL[0], LANE_CELL[1]);
  lanePts.push([laneC[0], laneC[1], laneC[2]]);
  // passer-by (§4.7): LANE[1] → LANE[0] → lane cell → up the west ring column → along the front ring row → the view
  let view = null;
  for (const x of [...Array(20).keys()].map((k) => k - 10).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
    const f = index.F.get(ck(x, 0, 9));
    if (f && PATHY.has(f.t) && nav.isFree(x, 9)) { view = [x, 9]; break; }
  }
  // then up to PASSERBY_VIEW_BACK cells further along that path, so the wave sits mid-screen, clear of the tray
  if (view) {
    for (let z = 8; z >= 9 - (TUNE.PASSERBY_VIEW_BACK ?? 2); z--) {
      const f = index.F.get(ck(view[0], 0, z));
      if (!(f && PATHY.has(f.t) && nav.isFree(view[0], z))) break;
      view = [view[0], z];
    }
  }
  if (!view) view = [0, 10];
  const route = [];
  {
    const a = L[1], b = L[0];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / TUNE.LANE_STEP));
    for (let s = 0; s < n; s++) { const x = a[0] + (b[0] - a[0]) * (s / n), z = a[1] + (b[1] - a[1]) * (s / n); route.push([x, hAt(x, z), z]); }
    route.push([b[0], hAt(b[0], b[1]), b[1]]);
    route.push(laneC);
    route.push(nav.centre(-11, 10));
    route.push(nav.centre(view[0], 10));
    if (view[1] !== 10) route.push(nav.centre(view[0], view[1]));
  }
  const model = {
    version, index, det, buildings: det.buildings, homes: det.buildings.filter((b) => b.home), shells: det.shells,
    verandas: det.verandas, nav, spots, hangouts, lane: lanePts, passerby: { route, view },
    validate: typeof validate === 'function' ? validate : () => ({ ok: true }),
    isFree: typeof isFree === 'function' ? isFree : (rec) => !slotTaken(index, rec),
    tents: tents.map((t) => [t[0], t[1]]),
    ms: 0,
  };
  model.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return model;
}

/** Fallback slot check from the index when no world.get is injected (tests in Node). */
function slotTaken(index, rec) {
  const y = rec.y | 0;
  const def = index.defOf ? index.defOf(rec.t) : null;
  const layer = def?.layer || 'I';
  if (layer === 'F') return index.F.has(ck(rec.x, y, rec.z));
  if (layer === 'I') return index.I.has(ck(rec.x, y, rec.z));
  if (layer === 'D') return index.D.has(ck(rec.x, y, rec.z));
  if (layer === 'W') return index.W.has(`W|${rec.a}|${rec.x}|${y}|${rec.z}`);
  return false;
}

export { inNav, ci, CELL };
