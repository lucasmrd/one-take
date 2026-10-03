// Signed distance modelling + naive surface nets mesher.
// Animals are described as soft unions of capsules/ellipsoids attached to bones.

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// capsule with linearly interpolated radius
function sdCap(px, py, pz, p) {
  const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / p.bb));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * h);
}

// approximate ellipsoid (iq)
function sdEll(px, py, pz, p) {
  const x = px - p.c[0], y = py - p.c[1], z = pz - p.c[2];
  const [rx, ry, rz] = p.r;
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  if (k1 < 1e-8) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

export function primDist(px, py, pz, p) {
  return p.type === 'cap' ? sdCap(px, py, pz, p) : sdEll(px, py, pz, p);
}

export function preparePrims(prims) {
  for (const p of prims) {
    if (p.type === 'cap') {
      const bax = p.b[0] - p.a[0], bay = p.b[1] - p.a[1], baz = p.b[2] - p.a[2];
      p.bb = Math.max(1e-8, bax * bax + bay * bay + baz * baz);
    }
  }
  return prims;
}

export function makeSDF(prims, k) {
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      d = smin(d, primDist(x, y, z, p), p.k ?? k);
    }
    return d;
  };
}

export function boundsOf(prims, pad) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const p of prims) {
    const pts = p.type === 'cap'
      ? [[p.a, Math.max(p.ra, p.rb)], [p.b, Math.max(p.ra, p.rb)]]
      : [[p.c, Math.max(...p.r)]];
    for (const [c, r] of pts) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], c[i] - r - pad);
        max[i] = Math.max(max[i], c[i] + r + pad);
      }
    }
  }
  return { min, max };
}

// Naive surface nets: one vertex per sign-changing cell, one quad per sign-changing edge.
export function surfaceNets(sdf, min, max, h) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  let i = 0;
  for (let z = 0; z < nz; z++) {
    const pz = min[2] + z * h;
    for (let y = 0; y < ny; y++) {
      const py = min[1] + y * h;
      for (let x = 0; x < nx; x++) field[i++] = sdf(min[0] + x * h, py, pz);
    }
  }
  const F = (x, y, z) => field[x + nx * (y + ny * z)];
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellIdx = new Int32Array(cx * cy * cz).fill(-1);
  const C = (x, y, z) => cellIdx[x + cx * (y + cy * z)];

  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  const pos = [];

  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const o = corners[c];
      v[c] = F(x + o[0], y + o[1], z + o[2]);
      if (v[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) !== (v[b] < 0)) {
        const t = v[a] / (v[a] - v[b]);
        const oa = corners[a], ob = corners[b];
        sx += oa[0] + (ob[0] - oa[0]) * t;
        sy += oa[1] + (ob[1] - oa[1]) * t;
        sz += oa[2] + (ob[2] - oa[2]) * t;
        n++;
      }
    }
    cellIdx[x + cx * (y + cy * z)] = pos.length / 3;
    pos.push(min[0] + (x + sx / n) * h, min[1] + (y + sy / n) * h, min[2] + (z + sz / n) * h);
  }

  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const a = F(x, y, z);
    if (x < cx && y >= 1 && y < cy && z >= 1 && z < cz) {
      const b = F(x + 1, y, z);
      if ((a < 0) !== (b < 0)) quad(C(x, y - 1, z - 1), C(x, y, z - 1), C(x, y, z), C(x, y - 1, z), !(a < 0));
    }
    if (y < cy && x >= 1 && x < cx && z >= 1 && z < cz) {
      const b = F(x, y + 1, z);
      if ((a < 0) !== (b < 0)) quad(C(x - 1, y, z - 1), C(x - 1, y, z), C(x, y, z), C(x, y, z - 1), !(a < 0));
    }
    if (z < cz && x >= 1 && x < cx && y >= 1 && y < cy) {
      const b = F(x, y, z + 1);
      if ((a < 0) !== (b < 0)) quad(C(x - 1, y - 1, z), C(x, y - 1, z), C(x, y, z), C(x - 1, y, z), !(a < 0));
    }
  }

  // normals from the field gradient
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = h * 0.5;
  for (let j = 0; j < positions.length; j += 3) {
    const px = positions[j], py = positions[j + 1], pz = positions[j + 2];
    let gx = sdf(px + e, py, pz) - sdf(px - e, py, pz);
    let gy = sdf(px, py + e, pz) - sdf(px, py - e, pz);
    let gz = sdf(px, py, pz + e) - sdf(px, py, pz - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[j] = gx / l; normals[j + 1] = gy / l; normals[j + 2] = gz / l;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}
