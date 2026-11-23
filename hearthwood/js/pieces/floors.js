// STARTER floors & frame pieces. To be expanded.
import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { CELL, LEVEL_H, STEP, BASE_Y, WALL_T, FLOOR_T } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, wallGeo, add, addBox } from '../geom.js';

const WALL_MATS = ['clapboard', 'log', 'logDark', 'boardBatten', 'shingleSiding', 'plaster', 'stone', 'brick', 'planks', 'glass'];

registerPiece({
  id: 'foundation', name: 'Stone Foundation', cat: 'base', slot: 'cell', layer: 'F', rot: 'none',
  mats: ['floorOak', 'floorPine', 'floorStone', 'floorTile'], matGroup: 'floor', levels: [0, 0],
  icon: '🟫', sound: 'stone', desc: 'A sturdy stone plinth with a floor on top.',
  build(p) {
    const g = new THREE.Group();
    addBox(g, mat('stoneBlock'), CELL, BASE_Y - 0.04 + 0.1, CELL, 0, -BASE_Y - 0.1, 0);
    addBox(g, mat(p.m, p.c), CELL, 0.04, CELL, 0, -0.04, 0);
    return g;
  },
});

registerPiece({
  id: 'floor', name: 'Floor', cat: 'base', slot: 'cell', layer: 'F', rot: 'none',
  mats: ['floorOak', 'floorPine', 'floorStone', 'floorTile'], matGroup: 'floor',
  icon: '▫️', desc: 'Floor boards — also the ceiling of the room below.',
  build(p) {
    const g = new THREE.Group();
    addBox(g, mat(p.m, p.c), CELL, FLOOR_T, CELL, 0, -FLOOR_T, 0);
    return g;
  },
});

registerPiece({
  id: 'post', name: 'Post', cat: 'frame', slot: 'corner', layer: 'P', mats: ['timber', 'wood', 'log', 'stoneBlock', 'trim'], matGroup: 'post', paint: true,
  icon: '🪵', desc: 'A corner post.',
  build(p) {
    const g = new THREE.Group();
    addBox(g, mat(p.m, p.c), 0.26, LEVEL_H, 0.26, 0, 0, 0);
    return g;
  },
});
