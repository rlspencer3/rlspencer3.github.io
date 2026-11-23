// Piece registry. Piece modules (js/pieces/*.js) call registerPiece() at import
// time. See docs/ARCHITECTURE.md for the full contract.

import { MAX_LEVEL } from './config.js';

export const CATEGORIES = [
  { id: 'base', name: 'Floors', icon: '🟫' },
  { id: 'walls', name: 'Walls', icon: '🧱' },
  { id: 'openings', name: 'Doors & Windows', icon: '🪟' },
  { id: 'roof', name: 'Roof', icon: '🏠' },
  { id: 'frame', name: 'Frame & Stairs', icon: '🪜' },
  { id: 'interior', name: 'Cozy Things', icon: '🛋️' },
  { id: 'garden', name: 'Garden', icon: '🌷' },
];

const SLOT_LAYERS = {
  cell: ['F', 'R', 'I', 'D'],
  edge: ['W', 'B'],
  corner: ['P'],
};

const registry = new Map();
const order = [];

/**
 * Register a piece type.
 * Required: id, name, cat, slot ('cell'|'edge'|'corner'), layer ('F'|'W'|'B'|'P'|'R'|'I'), build(p, ctx)
 * Optional:
 *   rot: 'four' | 'flip' | 'none'      (default: cell->'four', edge->'flip', corner->'none')
 *   mats: string[]                       allowed main materials, first is default (null = fixed look)
 *   matGroup: string                     remembered-material group shared by similar pieces (default: cat)
 *   paint: boolean                       main colour applies (only when the material is paintable)
 *   accent: boolean                      piece has accent-coloured parts (doors, shutters, frames)
 *   levels: [min, max]                   allowed levels (default [0, MAX_LEVEL])
 *   contextual: boolean                  rebuild when neighbours within 1 cell / 1 level change
 *   roof: { rise: 1|2, kind: 'slope'|'corner'|'inner'|'flat'|'cap' }   roof metadata for auto-stacking
 *   autoGable: boolean                   edge piece that auto-fits the roof above (sets p.h, p.s, p.r)
 *   desc: string                         one-line description shown in UI
 *   icon: string                         emoji fallback for the palette
 *   sound: 'wood'|'stone'|'soft'|'glass'|'metal'|'leaf'   placement sound flavour
 *   hidden: boolean                      registered but not shown in the palette
 */
export function registerPiece(def) {
  if (!def || !def.id) throw new Error('registerPiece: missing id');
  if (!SLOT_LAYERS[def.slot]) throw new Error(`registerPiece(${def.id}): bad slot ${def.slot}`);
  if (!SLOT_LAYERS[def.slot].includes(def.layer)) throw new Error(`registerPiece(${def.id}): layer ${def.layer} not valid for slot ${def.slot}`);
  if (typeof def.build !== 'function') throw new Error(`registerPiece(${def.id}): missing build()`);
  const full = {
    rot: def.slot === 'cell' ? 'four' : def.slot === 'edge' ? 'flip' : 'none',
    mats: null,
    matGroup: def.cat,
    paint: false,
    accent: false,
    levels: [0, MAX_LEVEL],
    contextual: false,
    desc: '',
    icon: '◻️',
    sound: 'wood',
    hidden: false,
    ...def,
  };
  if (!registry.has(def.id)) order.push(def.id);
  registry.set(def.id, full);
  return full;
}

export const getDef = (id) => registry.get(id);
export const allDefs = () => order.map((id) => registry.get(id));
export const piecesIn = (cat) => allDefs().filter((d) => d.cat === cat && !d.hidden);
