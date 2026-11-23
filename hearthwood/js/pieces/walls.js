// STARTER wall & opening pieces. To be expanded.
import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { CELL, LEVEL_H, STEP, BASE_Y, WALL_T, FLOOR_T } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, wallGeo, add, addBox } from '../geom.js';

const WALL_MATS = ['clapboard', 'log', 'logDark', 'boardBatten', 'shingleSiding', 'plaster', 'stone', 'brick', 'planks', 'glass'];

function wallPiece(id, name, cat, openings, extra = {}) {
  registerPiece({
    id, name, cat, slot: 'edge', layer: 'W', mats: WALL_MATS, matGroup: 'wall', paint: true,
    icon: '🧱', desc: '', ...extra,
    build(p) {
      const g = new THREE.Group();
      add(g, wallGeo(CELL, LEVEL_H, WALL_T, openings), mat(p.m, p.c));
      for (const o of openings) {
        if (o.glass) addBox(g, mat('windowGlass'), o.w, o.h, 0.03, o.x, o.y, 0);
        if (o.door) addBox(g, mat('paintedWood', p.k), o.w, o.h, 0.06, o.x, o.y, 0);
      }
      return g;
    },
  });
}

wallPiece('wall', 'Wall', 'walls', [], { desc: 'A plain full-height wall.' });
wallPiece('wall_window', 'Window', 'openings', [{ x: 0, y: 0.9, w: 0.9, h: 1.0, glass: true }], { icon: '🪟', accent: true });
wallPiece('wall_door', 'Door', 'openings', [{ x: 0, y: 0, w: 0.95, h: 2.05, door: true }], { icon: '🚪', accent: true });

registerPiece({
  id: 'gable', name: 'Gable Wall', cat: 'walls', slot: 'edge', layer: 'W', mats: WALL_MATS, matGroup: 'wall', paint: true,
  autoGable: true, icon: '🔺', desc: 'Triangle wall that fits under a sloped roof.',
  build(p) {
    const g = new THREE.Group();
    const low = (p.h || 0) * STEP, high = low + (p.s || 1) * STEP;
    add(g, wallGeo(CELL, high, WALL_T, [], [low, high]), mat(p.m, p.c));
    return g;
  },
});

