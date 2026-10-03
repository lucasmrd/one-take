// Anatomy (soft-union primitives on bones) and procedural animation for each animal.
// Units are meters. Animals face +Z, Y is up, feet on y = 0.

const cap = (bone, a, b, ra, rb, k) => ({ type: 'cap', bone, a, b, ra, rb, k });
const ell = (bone, c, r, k) => ({ type: 'ell', bone, c, r, k });
const mx = (p) => [-p[0], p[1], p[2]];
// mirror every primitive whose bone ends in "L" into an "R" twin
function mirror(prims) {
  const out = [...prims];
  for (const p of prims) {
    if (!p.mirror) continue;
    const bone = p.bone.replace(/L$/, 'R');
    if (p.type === 'cap') out.push({ ...p, bone, a: mx(p.a), b: mx(p.b), mirror: false });
    else out.push({ ...p, bone, c: mx(p.c), mirror: false });
  }
  return out;
}
const M = (p) => ({ ...p, mirror: true });

const sin = Math.sin, cos = Math.cos, max = Math.max;

// ---------------------------------------------------------------------------
export const WOLF = {
  name: 'wolf',
  k: 0.06,
  h: 0.016,
  bones: [
    { name: 'root', parent: -1, p: [0, 0.62, -0.45] },
    { name: 'chest', parent: 0, p: [0, 0.64, 0.05] },
    { name: 'neck', parent: 1, p: [0, 0.72, 0.5] },
    { name: 'head', parent: 2, p: [0, 0.9, 0.74] },
    { name: 'jaw', parent: 3, p: [0, 0.86, 0.86] },
    { name: 'tail', parent: 0, p: [0, 0.68, -0.6] },
    { name: 'tail2', parent: 5, p: [0, 0.52, -0.92] },
    { name: 'legFL', parent: 1, p: [0.1, 0.58, 0.42] },
    { name: 'lowFL', parent: 7, p: [0.1, 0.32, 0.45] },
    { name: 'legFR', parent: 1, p: [-0.1, 0.58, 0.42] },
    { name: 'lowFR', parent: 9, p: [-0.1, 0.32, 0.45] },
    { name: 'legBL', parent: 0, p: [0.1, 0.62, -0.45] },
    { name: 'lowBL', parent: 11, p: [0.11, 0.36, -0.55] },
    { name: 'legBR', parent: 0, p: [-0.1, 0.62, -0.45] },
    { name: 'lowBR', parent: 13, p: [-0.11, 0.36, -0.55] },
  ],
  prims: mirror([
    ell('root', [0, 0.62, -0.3], [0.15, 0.19, 0.3]),
    ell('root', [0, 0.64, -0.5], [0.15, 0.17, 0.15]),
    ell('chest', [0, 0.62, 0.3], [0.19, 0.25, 0.28]),
    ell('chest', [0, 0.61, 0.02], [0.16, 0.2, 0.25]),
    cap('neck', [0, 0.7, 0.48], [0, 0.86, 0.7], 0.15, 0.11),
    ell('head', [0, 0.92, 0.8], [0.115, 0.115, 0.13]),
    cap('head', [0, 0.9, 0.86], [0, 0.865, 1.06], 0.065, 0.036),
    M(cap('head', [0.06, 0.99, 0.76], [0.075, 1.11, 0.73], 0.045, 0.012, 0.03)),
    cap('jaw', [0, 0.85, 0.85], [0, 0.83, 1.03], 0.048, 0.026, 0.03),
    cap('tail', [0, 0.68, -0.6], [0, 0.52, -0.92], 0.055, 0.065),
    cap('tail2', [0, 0.52, -0.92], [0, 0.4, -1.12], 0.065, 0.02),
    M(cap('legFL', [0.1, 0.58, 0.42], [0.1, 0.32, 0.45], 0.07, 0.045)),
    M(cap('lowFL', [0.1, 0.32, 0.45], [0.1, 0.05, 0.44], 0.04, 0.032, 0.03)),
    M(ell('lowFL', [0.1, 0.035, 0.48], [0.04, 0.03, 0.06], 0.03)),
    M(cap('legBL', [0.1, 0.62, -0.45], [0.11, 0.36, -0.55], 0.085, 0.05)),
    M(cap('lowBL', [0.11, 0.36, -0.55], [0.1, 0.05, -0.47], 0.04, 0.032, 0.03)),
    M(ell('lowBL', [0.1, 0.035, -0.43], [0.04, 0.03, 0.06], 0.03)),
  ]),
  // gallop; ph advances ~2π per stride
  run(ph) {
    const s = sin(ph), s2 = sin(ph + 0.6);
    return {
      offset: [0, 0.05 * sin(ph * 2), 0],
      rot: {
        root: [0.08 * sin(ph + 1.2), 0, 0],
        chest: [-0.06 * sin(ph + 0.4), 0, 0],
        neck: [0.15 + 0.08 * sin(ph * 2), 0, 0],
        head: [-0.15, 0, 0],
        jaw: [0.12, 0, 0],
        tail: [-0.55 + 0.12 * sin(ph * 2), 0.1 * sin(ph), 0],
        tail2: [-0.2, 0, 0],
        legFL: [-0.75 * s, 0, 0], lowFL: [0.9 * max(0, sin(ph - 1.0)), 0, 0],
        legFR: [-0.75 * s2, 0, 0], lowFR: [0.9 * max(0, sin(ph - 0.4)), 0, 0],
        legBL: [0.7 * sin(ph + 2.4), 0, 0], lowBL: [-0.7 * max(0, sin(ph + 1.4)), 0, 0],
        legBR: [0.7 * sin(ph + 3.0), 0, 0], lowBR: [-0.7 * max(0, sin(ph + 2.0)), 0, 0],
      },
    };
  },
  // sit amount s, howl amount k, look yaw
  howl(s, k, yaw = 0, t = 0) {
    const breathe = 0.02 * sin(t * 1.7);
    return {
      offset: [0, -0.2 * s, -0.05 * s],
      rot: {
        root: [-0.5 * s, 0, 0],
        chest: [-0.1 * s + breathe, 0, 0],
        neck: [-0.55 * k + 0.25 * s * (1 - k), yaw * 0.5, 0],
        head: [-0.4 * k, yaw * 0.5, 0],
        jaw: [0.38 * k * (0.85 + 0.15 * sin(t * 9)), 0, 0],
        tail: [0.6 * s, 0, 0.15 * sin(t)],
        tail2: [0.3 * s, 0, 0],
        legFL: [0.5 * s, 0, 0], lowFL: [0, 0, 0],
        legFR: [0.5 * s, 0, 0], lowFR: [0, 0, 0],
        legBL: [-1.0 * s, 0, 0], lowBL: [1.7 * s, 0, 0],
        legBR: [-1.0 * s, 0, 0], lowBR: [1.7 * s, 0, 0],
      },
    };
  },
};

// ---------------------------------------------------------------------------
export const BEAR = {
  name: 'bear',
  k: 0.11,
  h: 0.024,
  bones: [
    { name: 'root', parent: -1, p: [0, 0.75, -0.55] },
    { name: 'chest', parent: 0, p: [0, 0.9, 0.1] },
    { name: 'neck', parent: 1, p: [0, 1.0, 0.62] },
    { name: 'head', parent: 2, p: [0, 1.02, 0.9] },
    { name: 'jaw', parent: 3, p: [0, 0.93, 1.05] },
    { name: 'legFL', parent: 1, p: [0.24, 0.85, 0.45] },
    { name: 'lowFL', parent: 5, p: [0.24, 0.42, 0.52] },
    { name: 'legFR', parent: 1, p: [-0.24, 0.85, 0.45] },
    { name: 'lowFR', parent: 7, p: [-0.24, 0.42, 0.52] },
    { name: 'legBL', parent: 0, p: [0.24, 0.9, -0.55] },
    { name: 'lowBL', parent: 9, p: [0.24, 0.45, -0.62] },
    { name: 'legBR', parent: 0, p: [-0.24, 0.9, -0.55] },
    { name: 'lowBR', parent: 11, p: [-0.24, 0.45, -0.62] },
  ],
  prims: mirror([
    ell('root', [0, 0.88, -0.45], [0.4, 0.42, 0.42]),
    ell('root', [0, 0.84, -0.05], [0.42, 0.43, 0.45]),
    ell('root', [0, 0.95, -0.85], [0.08, 0.08, 0.08], 0.06),
    ell('chest', [0, 0.92, 0.3], [0.42, 0.46, 0.4]),
    ell('chest', [0, 1.14, 0.28], [0.3, 0.24, 0.32]),
    cap('neck', [0, 1.0, 0.55], [0, 1.0, 0.85], 0.31, 0.24),
    ell('head', [0, 1.03, 0.98], [0.22, 0.21, 0.21]),
    cap('head', [0, 0.99, 1.1], [0, 0.95, 1.33], 0.12, 0.075, 0.06),
    ell('head', [0, 0.975, 1.38], [0.055, 0.04, 0.03], 0.03),
    M(ell('head', [0.15, 1.22, 0.92], [0.065, 0.06, 0.04], 0.05)),
    cap('jaw', [0, 0.9, 1.05], [0, 0.875, 1.28], 0.085, 0.055, 0.05),
    M(cap('legFL', [0.24, 0.85, 0.45], [0.24, 0.42, 0.52], 0.17, 0.12)),
    M(cap('lowFL', [0.24, 0.42, 0.52], [0.24, 0.08, 0.52], 0.12, 0.11, 0.08)),
    M(ell('lowFL', [0.24, 0.06, 0.6], [0.12, 0.06, 0.15], 0.06)),
    M(cap('legBL', [0.24, 0.9, -0.55], [0.24, 0.45, -0.62], 0.21, 0.13)),
    M(cap('lowBL', [0.24, 0.45, -0.62], [0.24, 0.08, -0.55], 0.12, 0.11, 0.08)),
    M(ell('lowBL', [0.24, 0.06, -0.5], [0.12, 0.06, 0.15], 0.06)),
  ]),
  walk(ph, yaw = 0) {
    const s = sin(ph);
    return {
      offset: [0, 0.03 * sin(ph * 2), 0],
      rot: {
        root: [0, 0, 0.03 * s],
        chest: [0, 0.04 * s, -0.03 * s],
        neck: [0.12 + 0.04 * sin(ph * 2), yaw * 0.4 + 0.08 * s, 0],
        head: [0.05, yaw * 0.5, 0],
        legFL: [-0.4 * s, 0, 0], lowFL: [0.6 * max(0, sin(ph - 1.2)), 0, 0],
        legFR: [0.4 * s, 0, 0], lowFR: [0.6 * max(0, sin(ph + 1.9)), 0, 0],
        legBL: [0.38 * s, 0, 0], lowBL: [-0.45 * max(0, sin(ph + 1.2)), 0, 0],
        legBR: [-0.38 * s, 0, 0], lowBR: [-0.45 * max(0, sin(ph - 1.9)), 0, 0],
      },
    };
  },
  // r: rear-up amount, j: jaw open, yaw: head look, t: time
  roar(r, j, yaw = 0, t = 0) {
    const shake = j * 0.03 * sin(t * 37);
    return {
      offset: [0, 0.06 * r, 0],
      rot: {
        root: [-1.05 * r, 0, 0],
        chest: [-0.1 * r, 0, 0],
        neck: [1.0 * r - 0.2 * j + shake, yaw * 0.4, 0],
        head: [0.5 * r - 0.15 * j, yaw * 0.4, shake],
        jaw: [0.6 * j, 0, 0],
        legFL: [-0.2 * r, 0, 0.25 * r], lowFL: [0.9 * r, 0, 0],
        legFR: [-0.2 * r, 0, -0.25 * r], lowFR: [0.9 * r, 0, 0],
        legBL: [1.0 * r, 0, 0], lowBL: [-0.3 * r, 0, 0],
        legBR: [1.0 * r, 0, 0], lowBR: [-0.3 * r, 0, 0],
      },
    };
  },
};

// ---------------------------------------------------------------------------
export const DEER = {
  name: 'deer',
  k: 0.05,
  h: 0.014,
  bones: [
    { name: 'root', parent: -1, p: [0, 1.0, -0.4] },
    { name: 'chest', parent: 0, p: [0, 1.05, 0.15] },
    { name: 'neck', parent: 1, p: [0, 1.15, 0.42] },
    { name: 'head', parent: 2, p: [0, 1.52, 0.68] },
    { name: 'tail', parent: 0, p: [0, 1.12, -0.6] },
    { name: 'legFL', parent: 1, p: [0.1, 1.0, 0.36] },
    { name: 'lowFL', parent: 5, p: [0.1, 0.6, 0.4] },
    { name: 'legFR', parent: 1, p: [-0.1, 1.0, 0.36] },
    { name: 'lowFR', parent: 7, p: [-0.1, 0.6, 0.4] },
    { name: 'legBL', parent: 0, p: [0.1, 1.02, -0.38] },
    { name: 'lowBL', parent: 9, p: [0.1, 0.62, -0.5] },
    { name: 'legBR', parent: 0, p: [-0.1, 1.02, -0.38] },
    { name: 'lowBR', parent: 11, p: [-0.1, 0.62, -0.5] },
  ],
  prims: mirror([
    ell('root', [0, 1.05, -0.3], [0.17, 0.22, 0.32]),
    ell('chest', [0, 1.06, 0.25], [0.18, 0.25, 0.3]),
    ell('chest', [0, 1.02, 0.0], [0.16, 0.21, 0.25]),
    cap('neck', [0, 1.15, 0.42], [0, 1.48, 0.66], 0.1, 0.065),
    ell('head', [0, 1.57, 0.74], [0.075, 0.085, 0.11], 0.04),
    cap('head', [0, 1.55, 0.8], [0, 1.48, 0.98], 0.058, 0.034, 0.03),
    M(cap('head', [0.05, 1.64, 0.71], [0.17, 1.71, 0.68], 0.035, 0.012, 0.02)),
    M(cap('head', [0.04, 1.65, 0.72], [0.16, 1.88, 0.66], 0.028, 0.022, 0.02)),
    M(cap('head', [0.16, 1.88, 0.66], [0.22, 2.1, 0.73], 0.022, 0.014, 0.01)),
    M(cap('head', [0.12, 1.8, 0.68], [0.13, 1.97, 0.82], 0.017, 0.009, 0.01)),
    M(cap('head', [0.19, 2.0, 0.7], [0.31, 2.1, 0.62], 0.015, 0.008, 0.01)),
    M(cap('head', [0.21, 1.95, 0.68], [0.15, 2.12, 0.58], 0.014, 0.008, 0.01)),
    cap('tail', [0, 1.12, -0.6], [0, 1.0, -0.68], 0.045, 0.03, 0.03),
    M(cap('legFL', [0.1, 1.0, 0.36], [0.1, 0.6, 0.4], 0.055, 0.035, 0.04)),
    M(cap('lowFL', [0.1, 0.6, 0.4], [0.1, 0.04, 0.37], 0.03, 0.02, 0.02)),
    M(ell('lowFL', [0.1, 0.03, 0.39], [0.025, 0.03, 0.035], 0.02)),
    M(cap('legBL', [0.1, 1.02, -0.38], [0.1, 0.62, -0.5], 0.085, 0.04, 0.05)),
    M(cap('lowBL', [0.1, 0.62, -0.5], [0.1, 0.04, -0.42], 0.03, 0.02, 0.02)),
    M(ell('lowBL', [0.1, 0.03, -0.4], [0.025, 0.03, 0.035], 0.02)),
  ]),
  // graze g (0 alert .. 1 head down), yaw head look
  idle(g, yaw = 0, t = 0) {
    return {
      offset: [0, 0, 0],
      rot: {
        neck: [1.15 * g - 0.1 * (1 - g), yaw * 0.6 * (1 - g), 0],
        head: [0.45 * g + 0.05 * sin(t * 3) * g, yaw * 0.5 * (1 - g), 0.05 * sin(t * 0.7)],
        tail: [0.3 + 0.2 * sin(t * 4) * (1 - g), 0, 0],
      },
    };
  },
  run(ph) {
    const s = sin(ph), s2 = sin(ph + 0.5);
    return {
      offset: [0, 0.08 * sin(ph * 2), 0],
      rot: {
        root: [0.12 * sin(ph + 1.2), 0, 0],
        chest: [-0.08 * sin(ph + 0.4), 0, 0],
        neck: [-0.15 + 0.1 * sin(ph * 2), 0, 0],
        head: [0.1, 0, 0],
        tail: [-0.4, 0, 0],
        legFL: [-0.9 * s, 0, 0], lowFL: [1.1 * max(0, sin(ph - 1.0)), 0, 0],
        legFR: [-0.9 * s2, 0, 0], lowFR: [1.1 * max(0, sin(ph - 0.5)), 0, 0],
        legBL: [0.8 * sin(ph + 2.4), 0, 0], lowBL: [-0.9 * max(0, sin(ph + 1.4)), 0, 0],
        legBR: [0.8 * sin(ph + 2.9), 0, 0], lowBR: [-0.9 * max(0, sin(ph + 1.9)), 0, 0],
      },
    };
  },
  walk(ph, yaw = 0) {
    const s = sin(ph);
    return {
      offset: [0, 0.015 * sin(ph * 2), 0],
      rot: {
        neck: [0.05 + 0.04 * sin(ph * 2), yaw * 0.5, 0],
        head: [0.05, yaw * 0.4, 0],
        tail: [0.2, 0, 0.1 * s],
        legFL: [-0.35 * s, 0, 0], lowFL: [0.6 * max(0, sin(ph - 1.2)), 0, 0],
        legFR: [0.35 * s, 0, 0], lowFR: [0.6 * max(0, sin(ph + 1.9)), 0, 0],
        legBL: [0.35 * s, 0, 0], lowBL: [-0.5 * max(0, sin(ph + 1.2)), 0, 0],
        legBR: [-0.35 * s, 0, 0], lowBR: [-0.5 * max(0, sin(ph - 1.9)), 0, 0],
      },
    };
  },
};

// ---------------------------------------------------------------------------
export const WHALE = {
  name: 'whale',
  k: 0.35,
  h: 0.085,
  bones: [
    { name: 'root', parent: -1, p: [0, 0, 0] },
    { name: 'front', parent: 0, p: [0, 0, 1.5] },
    { name: 'tail1', parent: 0, p: [0, 0, -2.5] },
    { name: 'tail2', parent: 2, p: [0, 0.1, -5.6] },
    { name: 'fluke', parent: 3, p: [0, 0.15, -7.2] },
    { name: 'finL', parent: 0, p: [1.0, -0.5, 2.0] },
    { name: 'finR', parent: 0, p: [-1.0, -0.5, 2.0] },
  ],
  prims: mirror([
    ell('root', [0, 0, -0.3], [1.35, 1.25, 3.6]),
    cap('root', [0, 1.05, -2.6], [0, 1.45, -3.15], 0.2, 0.05, 0.2),
    ell('front', [0, -0.1, 3.0], [1.15, 0.95, 2.0]),
    ell('front', [0, -0.5, 3.2], [1.1, 0.62, 1.85]),
    cap('tail1', [0, 0, -2.5], [0, 0.1, -5.6], 1.05, 0.38),
    cap('tail2', [0, 0.1, -5.6], [0, 0.15, -7.2], 0.38, 0.18, 0.2),
    ell('fluke', [0, 0.15, -7.3], [0.45, 0.13, 0.35], 0.15),
    M(ell('fluke', [0.95, 0.15, -7.55], [1.15, 0.09, 0.45], 0.15)),
    M(cap('finL', [1.0, -0.5, 2.0], [3.6, -1.4, 0.8], 0.38, 0.12, 0.25)),
  ]),
  swim(ph, amp = 1) {
    return {
      offset: [0, 0.15 * amp * sin(ph + 0.6), 0],
      rot: {
        root: [-0.04 * amp * sin(ph + 0.8), 0, 0],
        front: [0.03 * amp * sin(ph + 1.2), 0, 0],
        tail1: [0.16 * amp * sin(ph), 0, 0],
        tail2: [0.28 * amp * sin(ph - 0.8), 0, 0],
        fluke: [0.4 * amp * sin(ph - 1.6), 0, 0],
        finL: [0.1 * sin(ph * 0.5), 0, 0.25 * sin(ph * 0.5 + 1)],
        finR: [0.1 * sin(ph * 0.5), 0, -0.25 * sin(ph * 0.5 + 1)],
      },
    };
  },
};

export const SPECS = { wolf: WOLF, bear: BEAR, deer: DEER, whale: WHALE };
