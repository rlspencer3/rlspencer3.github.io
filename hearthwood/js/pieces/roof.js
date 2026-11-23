// STARTER roof pieces. To be expanded.
import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { CELL, LEVEL_H, STEP, ROOF_T } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, add } from '../geom.js';

const ROOF_MATS = ['roofShingle', 'roofSlate', 'roofMetal', 'roofThatch', 'roofTile'];

function slope(id, name, riseSteps, extra = {}) {
  registerPiece({
    id, name, cat: 'roof', slot: 'cell', layer: 'R', mats: ROOF_MATS, matGroup: 'roof', paint: true,
    roof: { rise: riseSteps, kind: 'slope' }, icon: '📐', sound: 'wood', ...extra,
    build(p) {
      const g = new THREE.Group();
      const rise = riseSteps * STEP;
      const len = Math.hypot(CELL, rise);
      const ang = Math.atan2(rise, CELL);
      // panel underside runs from (z=-CELL/2, y=0) to (z=+CELL/2, y=rise); thickness above
      const m = add(g, boxGeo(CELL, ROOF_T, len), mat(p.m, p.c), 0, rise / 2, 0, -ang, 0, 0);
      m.translateY(ROOF_T / 2);
      return g;
    },
  });
}

slope('roof_slope', 'Roof Slope', 1, { desc: 'A gentle roof panel. Rises half a storey per cell.' });
slope('roof_steep', 'Steep Roof', 2, { desc: 'A steep A-frame panel. Rises a full storey per cell.' });
