// STARTER decor pieces. To be expanded.
import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { mat } from '../materials.js';
import { addBox } from '../geom.js';

registerPiece({
  id: 'table', name: 'Table', cat: 'interior', slot: 'cell', layer: 'I', icon: '🪑', sound: 'wood',
  mats: ['wood', 'timber'], matGroup: 'furniture',
  build(p) {
    const g = new THREE.Group();
    const m = mat(p.m);
    addBox(g, m, 1.2, 0.06, 0.8, 0, 0.72, 0);
    for (const [x, z] of [[-0.52, -0.32], [0.52, -0.32], [-0.52, 0.32], [0.52, 0.32]]) addBox(g, m, 0.07, 0.72, 0.07, x, 0, z);
    return g;
  },
});
