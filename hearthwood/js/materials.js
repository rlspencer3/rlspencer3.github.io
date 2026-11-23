// Material library. Pieces ask for materials by id (+ optional paint colour):
//   mat('clapboard', '#f4efe6')
// Materials are cached per (id, colour) — never dispose them.
// BASELINE IMPLEMENTATION: flat colours. Upgraded with procedural textures later;
// the exported API must stay the same.

import * as THREE from 'three';

// group: which picker the material appears in.
// paintable: colour picker applies (texture is tinted by colour).
// color: default/base colour.  swatch: CSS colour for UI chips.
export const MATERIALS = {
  // ---- Walls / siding ----
  log:           { name: 'Pine Logs',      group: 'wall',  paintable: false, color: '#c8955c' },
  logDark:       { name: 'Dark Logs',      group: 'wall',  paintable: false, color: '#7a5233' },
  clapboard:     { name: 'Clapboard',      group: 'wall',  paintable: true,  color: '#f3eee4' },
  boardBatten:   { name: 'Board & Batten', group: 'wall',  paintable: true,  color: '#b4473a' },
  shingleSiding: { name: 'Cedar Shingle',  group: 'wall',  paintable: true,  color: '#b98a5e' },
  plaster:       { name: 'Plaster',        group: 'wall',  paintable: true,  color: '#f0e4c8' },
  stone:         { name: 'Fieldstone',     group: 'wall',  paintable: false, color: '#9a958c' },
  brick:         { name: 'Brick',          group: 'wall',  paintable: false, color: '#a8553f' },
  planks:        { name: 'Rough Planks',   group: 'wall',  paintable: false, color: '#a07850' },
  glass:         { name: 'Glass Panels',   group: 'wall',  paintable: false, color: '#bfe3ea' },
  // ---- Roofing ----
  roofShingle:   { name: 'Wood Shingles',  group: 'roof',  paintable: false, color: '#8a6446' },
  roofSlate:     { name: 'Slate',          group: 'roof',  paintable: false, color: '#5a6470' },
  roofMetal:     { name: 'Tin Roof',       group: 'roof',  paintable: true,  color: '#a8483a' },
  roofThatch:    { name: 'Thatch',         group: 'roof',  paintable: false, color: '#c9a55e' },
  roofTile:      { name: 'Clay Tile',      group: 'roof',  paintable: false, color: '#c0643f' },
  // ---- Floors ----
  floorOak:      { name: 'Oak Boards',     group: 'floor', paintable: false, color: '#b07f4f' },
  floorPine:     { name: 'Pine Boards',    group: 'floor', paintable: false, color: '#d8b07a' },
  floorStone:    { name: 'Flagstone',      group: 'floor', paintable: false, color: '#a9a49a' },
  floorTile:     { name: 'Checker Tile',   group: 'floor', paintable: true,  color: '#e9e2d2' },
  deck:          { name: 'Deck Boards',    group: 'floor', paintable: false, color: '#9c7552' },
  // ---- Structure & trim ----
  timber:        { name: 'Dark Timber',    group: 'trim',  paintable: false, color: '#5b3f2a' },
  wood:          { name: 'Pine',           group: 'trim',  paintable: false, color: '#d2a46c' },
  trim:          { name: 'Painted Trim',   group: 'trim',  paintable: true,  color: '#f7f3ea' },
  paintedWood:   { name: 'Painted Wood',   group: 'trim',  paintable: true,  color: '#7a4b3a' },
  stoneBlock:    { name: 'Cut Stone',      group: 'trim',  paintable: false, color: '#a39e94' },
  iron:          { name: 'Iron',           group: 'trim',  paintable: false, color: '#3b3a3a' },
  // ---- Misc (not shown in pickers) ----
  windowGlass:   { name: 'Window Glass',   group: 'misc',  paintable: false, color: '#9fc8d6' },
  fabric:        { name: 'Fabric',         group: 'misc',  paintable: true,  color: '#c96a5a' },
  leaves:        { name: 'Leaves',         group: 'misc',  paintable: false, color: '#6f9a4a' },
  leavesDark:    { name: 'Pine Needles',   group: 'misc',  paintable: false, color: '#3f6b45' },
  bark:          { name: 'Bark',           group: 'misc',  paintable: false, color: '#6b4c36' },
  grass:         { name: 'Grass',          group: 'misc',  paintable: false, color: '#8fb35e' },
  dirt:          { name: 'Soil',           group: 'misc',  paintable: false, color: '#6e4f37' },
  path:          { name: 'Path Stones',    group: 'misc',  paintable: false, color: '#b9b2a3' },
  hay:           { name: 'Hay',            group: 'misc',  paintable: false, color: '#dcc06a' },
  water:         { name: 'Water',          group: 'misc',  paintable: false, color: '#6fa8c0' },
  ember:         { name: 'Fire Glow',      group: 'misc',  paintable: false, color: '#ff9a3c' },
  lampGlow:      { name: 'Lamp Glow',      group: 'misc',  paintable: false, color: '#ffe0a0' },
  petalPink:     { name: 'Pink Petals',    group: 'misc',  paintable: false, color: '#f2a0b5' },
  petalYellow:   { name: 'Yellow Petals',  group: 'misc',  paintable: false, color: '#f5d25a' },
  petalWhite:    { name: 'White Petals',   group: 'misc',  paintable: false, color: '#fbf7ee' },
  petalPurple:   { name: 'Lavender',       group: 'misc',  paintable: false, color: '#a58ad6' },
  pumpkin:       { name: 'Pumpkin',        group: 'misc',  paintable: false, color: '#e8862f' },
  ceramic:       { name: 'Ceramic',        group: 'misc',  paintable: true,  color: '#f4efe6' },
  book:          { name: 'Books',          group: 'misc',  paintable: false, color: '#8b5a4a' },
};
for (const [id, m] of Object.entries(MATERIALS)) { m.id = id; m.swatch = m.swatch || m.color; }

// Cozy paint palette for paintable materials.
export const PALETTE = [
  '#f7f3ea', '#efe3c8', '#e8d3a8', '#d9c19a', // whites & creams
  '#b4473a', '#8e3b32', '#c96a5a', '#e39a7a', // barn reds & terracotta
  '#e9c46a', '#d9a441', '#9cae6b', '#6f8f5a', // mustard, sage, moss
  '#4f7a6a', '#7fa7a3', '#9fc0d6', '#5d7fa3', // teal, duck egg, sky, denim
  '#2f4a66', '#6b5b8e', '#b9a3c9', '#e7b7c8', // navy, plum, lilac, blush
  '#7a4b3a', '#4a3a2e', '#5e5e5e', '#2b2b2b', // walnut, umber, slate, charcoal
];

export const isPaintable = (id) => !!MATERIALS[id]?.paintable;
export const matList = (group) => Object.values(MATERIALS).filter((m) => m.group === group);
export const matName = (id) => MATERIALS[id]?.name || id;

const GLOW = new Set(['windowGlass', 'ember', 'lampGlow']);
const cache = new Map();
const glowMats = [];
let night = 0;

/** Get the material for an id with an optional paint colour (hex string). */
export function mat(id, color = null) {
  const def = MATERIALS[id] || MATERIALS.wood;
  const c = def.paintable && color ? color : def.color;
  const key = id + '|' + c;
  let m = cache.get(key);
  if (m) return m;
  const opts = { color: new THREE.Color(c), roughness: 0.85, metalness: 0 };
  if (id === 'roofMetal' || id === 'iron') { opts.metalness = 0.3; opts.roughness = 0.55; }
  if (id === 'glass' || id === 'windowGlass' || id === 'water') {
    opts.transparent = true; opts.opacity = id === 'water' ? 0.8 : 0.55; opts.roughness = 0.1; opts.depthWrite = id === 'water';
  }
  m = new THREE.MeshStandardMaterial(opts);
  m.name = key;
  if (GLOW.has(id)) {
    m.emissive = new THREE.Color(id === 'windowGlass' ? '#ffc56b' : c);
    m.userData.glowBase = id === 'windowGlass' ? 0 : 0.6;
    m.userData.glowNight = id === 'windowGlass' ? 1.1 : 1.6;
    m.emissiveIntensity = m.userData.glowBase + (m.userData.glowNight - m.userData.glowBase) * night;
    glowMats.push(m);
  }
  cache.set(key, m);
  return m;
}

/** 0 = day, 1 = full night. Windows and lamps glow warmer at night. */
export function setNight(f) {
  night = f;
  for (const m of glowMats) m.emissiveIntensity = m.userData.glowBase + (m.userData.glowNight - m.userData.glowBase) * f;
}
export const getNight = () => night;

/** Season tint for foliage & grass: 'spring' | 'summer' | 'autumn' | 'winter'. */
export function setSeason(season) { /* upgraded implementation tints leaves/grass */ }

const ghostCache = {};
/** Translucent material used for placement previews. */
export function ghostMat(valid = true) {
  const k = valid ? 'ok' : 'bad';
  if (!ghostCache[k]) {
    ghostCache[k] = new THREE.MeshBasicMaterial({
      color: valid ? 0x8fe3b0 : 0xff7a6b, transparent: true, opacity: 0.45, depthWrite: false,
    });
  }
  return ghostCache[k];
}

const bpCache = {};
/** Translucent blue "blueprint" material for guided build outlines. */
export function blueprintMat(highlight = false) {
  const k = highlight ? 'hi' : 'lo';
  if (!bpCache[k]) {
    bpCache[k] = new THREE.MeshBasicMaterial({
      color: highlight ? 0x9fd4ff : 0x6fa8dc, transparent: true, opacity: highlight ? 0.42 : 0.22, depthWrite: false,
    });
  }
  return bpCache[k];
}
