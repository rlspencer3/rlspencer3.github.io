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
};

export function slotKey(def, p) {
  switch (def.layer) {
    case 'F': return K.F(p.x, p.y, p.z);
    case 'W': return K.W(p.a, p.x, p.y, p.z);
    case 'B': return K.B(p.a, p.x, p.y, p.z);
    case 'P': return K.P(p.x, p.y, p.z);
    case 'R': return K.R(p.x, roofSteps(p), p.z);
    case 'I': return K.I(p.x, p.y, p.z);
  }
  throw new Error('unknown layer ' + def.layer);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
