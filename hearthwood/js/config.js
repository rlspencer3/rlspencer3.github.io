// Hearthwood — shared constants and grid math.
// Every module imports units and coordinate helpers from here so that pieces,
// placement and saving all agree on one grid.

export const CELL = 2;            // width/depth of one grid cell in meters
export const LEVEL_H = 2.5;       // height of one storey (wall height)
export const STEP = LEVEL_H / 2;  // one roof "half step" (gentle roof rise per cell)
export const BASE_Y = 0.25;       // top of a ground-floor foundation
export const WALL_T = 0.18;       // wall thickness
export const FLOOR_T = 0.16;      // floor slab thickness (upper floors)
export const ROOF_T = 0.14;       // roof panel thickness
export const EAVE = 0.35;         // roof overhang past the eave edge

// Inclusive cell range of the buildable lot (20 x 20 cells = 40m x 40m)
export const GRID_MIN = -10;
export const GRID_MAX = 9;
export const MAX_LEVEL = 4;       // levels 0..MAX_LEVEL

// World height of the floor of level y.
export const levelY = (y) => BASE_Y + y * LEVEL_H;

// Rotation r (0..3) -> unit step on the grid. Local +Z of a piece points this way.
// r=0 -> +Z, r=1 -> +X, r=2 -> -Z, r=3 -> -X  (three.js rotation.y = r * PI/2)
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export const inGrid = (x, z) => x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX;
// Corners/edges may sit on the far boundary line (x or z == GRID_MAX + 1)
export const inGridVertex = (x, z) => x >= GRID_MIN && x <= GRID_MAX + 1 && z >= GRID_MIN && z <= GRID_MAX + 1;

// Total half-steps above BASE_Y for a roof piece (y = level, h = 0|1 half step).
export const roofSteps = (p) => p.y * 2 + (p.h || 0);
export const stepsToY = (hs) => BASE_Y + hs * STEP;

// Slot keys. One piece may occupy each key.
//   F floor-like cell piece      W wall-like edge piece     B beam on an edge
//   P post on a grid vertex      R roof panel (per half-step) I item/furniture in a cell
export const K = {
  F: (x, y, z) => `F|${x}|${y}|${z}`,
  W: (a, x, y, z) => `W|${a}|${x}|${y}|${z}`,
  B: (a, x, y, z) => `B|${a}|${x}|${y}|${z}`,
  P: (x, y, z) => `P|${x}|${y}|${z}`,
  R: (x, hs, z) => `R|${x}|${hs}|${z}`,
  I: (x, y, z) => `I|${x}|${y}|${z}`,
  D: (x, y, z) => `D|${x}|${y}|${z}`,   // rugs & decals: lie under furniture in the same cell
};

export function slotKey(def, p) {
  switch (def.layer) {
    case 'F': return K.F(p.x, p.y, p.z);
    case 'W': return K.W(p.a, p.x, p.y, p.z);
    case 'B': return K.B(p.a, p.x, p.y, p.z);
    case 'P': return K.P(p.x, p.y, p.z);
    case 'R': return K.R(p.x, roofSteps(p), p.z);
    case 'I': return K.I(p.x, p.y, p.z);
    case 'D': return K.D(p.x, p.y, p.z);
  }
  throw new Error('unknown layer ' + def.layer);
}

// The Ladder-back Chair tucks up to a table in the cell in front of it (its local +Z): its seat's centre sits this far
// along local +Z from the cell centre, by the tuck code chairTuck() gives ('z': the chair and the table turned alike,
// 'x': a quarter turn apart, '': no table in front). The piece (pieces/decor.js) draws its seat there and a villager
// sits there (town/sim.js), so the two can never drift apart (R6 T6.1).
export const CHAIR_SEAT_Z = Object.freeze({ z: 0.9, x: 0.66, '': 0.05 });
/** Tuck code of chair record p; itemAt(x, y, z) → the I-layer record in that cell, or null. */
export function chairTuck(p, itemAt) {
  const r = (p.r | 0) & 3, f = DIRS[r];
  const t = itemAt(p.x + f[0], p.y, p.z + f[1]);
  if (!t || t.t !== 'table') return '';
  return ((r - (t.r | 0)) & 1) ? 'x' : 'z';
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
