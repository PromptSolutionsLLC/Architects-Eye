#!/usr/bin/env node
/**
 * Procedural GLB builder for satellite models.
 *
 * Emits two files into public/assets/models/:
 *   - satellite-generic.glb : ~300-500 verts, octagonal bus + 2 solar
 *     panels + antenna stub. <20KB. Used for all non-ISS sats and
 *     instanced via Cesium's URI-based glTF cache (one network fetch,
 *     N entity references).
 *   - iss.glb : higher-fidelity ISS — central truss, four pressurised
 *     modules, four solar array wings, radiators. <2MB. CC0 procedural;
 *     no third-party asset.
 *
 * GLB spec: https://github.com/KhronosGroup/glTF/tree/main/specification/2.0
 *  Header (12B): magic 0x46546C67, version=2, length
 *  Chunk:  length (u32), type (u32), data (4-byte aligned)
 *    JSON chunk type = 0x4E4F534A  ("JSON")
 *    BIN  chunk type = 0x004E4942  ("BIN\0")
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "assets", "models");

// ────────────────────────────────────────────────────────────────────
// Mesh primitives
// Each returns { positions:[x,y,z,...], normals:[nx,ny,nz,...],
//                 indices:[u16,...] } in the local frame, where +Z is
// up (toward space) and +X is the "long axis" of the satellite bus.
// All faces are flat-shaded (per-face normals; vertices duplicated).
// ────────────────────────────────────────────────────────────────────

function makeMesh() {
  return { positions: [], normals: [], indices: [] };
}

function pushTri(m, a, b, c) {
  // Flat-shaded triangle: 3 unique verts, shared face normal.
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const cx = c[0], cy = c[1], cz = c[2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const base = m.positions.length / 3;
  m.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  m.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  m.indices.push(base, base + 1, base + 2);
}

function pushQuad(m, a, b, c, d) {
  pushTri(m, a, b, c);
  pushTri(m, a, c, d);
}

/** Axis-aligned box centered at `center`, half-extents `h`. */
function box(m, center, h) {
  const [cx, cy, cz] = center;
  const [hx, hy, hz] = h;
  const v = [
    [cx - hx, cy - hy, cz - hz], // 0 ---
    [cx + hx, cy - hy, cz - hz], // 1 +--
    [cx + hx, cy + hy, cz - hz], // 2 ++-
    [cx - hx, cy + hy, cz - hz], // 3 -+-
    [cx - hx, cy - hy, cz + hz], // 4 --+
    [cx + hx, cy - hy, cz + hz], // 5 +-+
    [cx + hx, cy + hy, cz + hz], // 6 +++
    [cx - hx, cy + hy, cz + hz], // 7 -++
  ];
  pushQuad(m, v[0], v[3], v[2], v[1]); // -Z
  pushQuad(m, v[4], v[5], v[6], v[7]); // +Z
  pushQuad(m, v[0], v[1], v[5], v[4]); // -Y
  pushQuad(m, v[3], v[7], v[6], v[2]); // +Y
  pushQuad(m, v[0], v[4], v[7], v[3]); // -X
  pushQuad(m, v[1], v[2], v[6], v[5]); // +X
}

/**
 * Cylinder along the +X axis from `xMin` to `xMax`, radius `r`,
 * `segments` around. Capped at both ends.
 */
function cylinderX(m, xMin, xMax, r, segments) {
  const c0 = [xMin, 0, 0];
  const c1 = [xMax, 0, 0];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    // side
    pushQuad(m,
      [xMin, y0, z0],
      [xMax, y0, z0],
      [xMax, y1, z1],
      [xMin, y1, z1],
    );
    // caps
    pushTri(m, c0, [xMin, y1, z1], [xMin, y0, z0]);
    pushTri(m, c1, [xMax, y0, z0], [xMax, y1, z1]);
  }
}

/**
 * Cylinder along the +Z axis from `zMin` to `zMax`, radius `r`.
 * Used for antennas and ISS modules with axial symmetry on Z.
 */
function cylinderZ(m, zMin, zMax, r, segments) {
  const c0 = [0, 0, zMin];
  const c1 = [0, 0, zMax];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
    pushQuad(m,
      [x0, y0, zMin],
      [x1, y1, zMin],
      [x1, y1, zMax],
      [x0, y0, zMax],
    );
    pushTri(m, c0, [x0, y0, zMin], [x1, y1, zMin]);
    pushTri(m, c1, [x1, y1, zMax], [x0, y0, zMax]);
  }
}

/** Thin solar panel: flat box, very thin in Z. */
function panel(m, center, halfX, halfY, halfZ = 0.04) {
  box(m, center, [halfX, halfY, halfZ]);
}

// ────────────────────────────────────────────────────────────────────
// GLB writer
// ────────────────────────────────────────────────────────────────────

/**
 * Build a GLB from an array of "primitive groups". Each group is one
 * mesh + one material; they are emitted as sibling primitives under a
 * single mesh so all share the same node transform (and therefore the
 * same Cesium entity orientation).
 */
function buildGLB(groups, modelName) {
  // Pack all geometry into a single binary buffer with one accessor
  // per (positions / normals / indices) per group. f32 attribs first,
  // then u16 indices padded to 4.
  const bin = [];
  const accessors = [];
  const bufferViews = [];
  let byteOffset = 0;

  function pushView(byteLength, target) {
    const idx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength,
      target,
    });
    byteOffset += byteLength;
    return idx;
  }

  function writeF32(arr) {
    const buf = Buffer.alloc(arr.length * 4);
    for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], i * 4);
    bin.push(buf);
    return buf.length;
  }

  function writeU16(arr) {
    // Pad to 4-byte alignment
    const padded = arr.length + (arr.length % 2);
    const buf = Buffer.alloc(padded * 2);
    for (let i = 0; i < arr.length; i++) buf.writeUInt16LE(arr[i], i * 2);
    bin.push(buf);
    return buf.length;
  }

  function f32Min3(arr) {
    let mx = Infinity, my = Infinity, mz = Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] < mx) mx = arr[i];
      if (arr[i + 1] < my) my = arr[i + 1];
      if (arr[i + 2] < mz) mz = arr[i + 2];
    }
    return [mx, my, mz];
  }
  function f32Max3(arr) {
    let mx = -Infinity, my = -Infinity, mz = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] > mx) mx = arr[i];
      if (arr[i + 1] > my) my = arr[i + 1];
      if (arr[i + 2] > mz) mz = arr[i + 2];
    }
    return [mx, my, mz];
  }

  const primitives = [];
  const materials = [];

  for (const g of groups) {
    const posLen = writeF32(g.mesh.positions);
    const posView = pushView(posLen, 34962); // ARRAY_BUFFER
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: g.mesh.positions.length / 3,
      type: "VEC3",
      min: f32Min3(g.mesh.positions),
      max: f32Max3(g.mesh.positions),
    });

    const norLen = writeF32(g.mesh.normals);
    const norView = pushView(norLen, 34962);
    const norAcc = accessors.length;
    accessors.push({
      bufferView: norView,
      componentType: 5126,
      count: g.mesh.normals.length / 3,
      type: "VEC3",
    });

    const idxLen = writeU16(g.mesh.indices);
    const idxView = pushView(idxLen, 34963); // ELEMENT_ARRAY_BUFFER
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5123, // UNSIGNED_SHORT
      count: g.mesh.indices.length,
      type: "SCALAR",
    });

    const matIdx = materials.length;
    materials.push({
      name: g.material.name,
      pbrMetallicRoughness: {
        baseColorFactor: g.material.color,
        metallicFactor: g.material.metallic ?? 0.1,
        roughnessFactor: g.material.roughness ?? 0.7,
      },
      doubleSided: g.material.doubleSided ?? false,
      emissiveFactor: g.material.emissive ?? [0, 0, 0],
    });

    primitives.push({
      attributes: { POSITION: posAcc, NORMAL: norAcc },
      indices: idxAcc,
      material: matIdx,
      mode: 4, // TRIANGLES
    });
  }

  const binBuffer = Buffer.concat(bin);

  const json = {
    asset: { version: "2.0", generator: "architects-eye/build-sat-models" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: modelName }],
    meshes: [{ name: modelName, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
  };

  let jsonStr = JSON.stringify(json);
  // Pad with spaces to 4-byte alignment
  while (jsonStr.length % 4 !== 0) jsonStr += " ";
  const jsonBuf = Buffer.from(jsonStr, "utf8");

  // Pad bin to 4-byte alignment
  let binPadded = binBuffer;
  if (binPadded.length % 4 !== 0) {
    const pad = Buffer.alloc(4 - (binPadded.length % 4));
    binPadded = Buffer.concat([binPadded, pad]);
  }

  const totalLen = 12 + 8 + jsonBuf.length + 8 + binPadded.length;
  const out = Buffer.alloc(totalLen);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4; // 'glTF'
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(totalLen, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4; // 'JSON'
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(binPadded.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4; // 'BIN\0'
  binPadded.copy(out, o);

  return out;
}

// ────────────────────────────────────────────────────────────────────
// Generic LEO satellite (~300-500 verts, <20KB)
//
// Local frame: +X = long axis (sun-facing). Body sits at origin with
// solar panels extending along +Y / -Y. Antenna pokes out +Z.
// ────────────────────────────────────────────────────────────────────

function buildGenericLEO() {
  const body = makeMesh();
  // Octagonal bus, ~1.0m long × 0.5m radius
  cylinderX(body, -0.5, 0.5, 0.5, 16);

  const panels = makeMesh();
  // Two big solar arrays. Frame + glass simulated by overlapping panels.
  // Left wing
  panel(panels, [0, -1.7, 0], 0.45, 1.1, 0.03);
  // Right wing
  panel(panels, [0,  1.7, 0], 0.45, 1.1, 0.03);

  const panelFrames = makeMesh();
  // Thin booms connecting bus to panels
  box(panelFrames, [0, -0.85, 0], [0.04, 0.4, 0.04]);
  box(panelFrames, [0,  0.85, 0], [0.04, 0.4, 0.04]);

  const antenna = makeMesh();
  // Antenna stub on +Z face of the bus
  cylinderZ(antenna, 0.5, 1.0, 0.05, 8);
  // Dish
  box(antenna, [0, 0, 1.05], [0.18, 0.18, 0.04]);

  return buildGLB(
    [
      { mesh: body,         material: { name: "bus",     color: [0.78, 0.78, 0.82, 1], metallic: 0.4, roughness: 0.5 } },
      { mesh: panels,       material: { name: "solar",   color: [0.06, 0.10, 0.40, 1], metallic: 0.2, roughness: 0.3, doubleSided: true, emissive: [0.01, 0.02, 0.08] } },
      { mesh: panelFrames,  material: { name: "boom",    color: [0.18, 0.18, 0.20, 1], metallic: 0.5, roughness: 0.6 } },
      { mesh: antenna,      material: { name: "antenna", color: [0.92, 0.92, 0.88, 1], metallic: 0.3, roughness: 0.5 } },
    ],
    "satellite-generic",
  );
}

// ────────────────────────────────────────────────────────────────────
// ISS hero model (<2MB; recognizable truss + modules + 4 wings + radiators)
//
// Local frame: +X = truss long axis (port↔starboard).
// Modules cluster at origin along +X and -X near the center.
// Solar arrays on the truss tips at ±X. Radiators perpendicular on +Y/-Y.
//
// Approximate scale: ISS truss is ~109m, modules ~73m. We model in
// "model meters"; Cesium's `minimumPixelSize` makes absolute scale
// largely irrelevant for icon-style rendering.
// ────────────────────────────────────────────────────────────────────

function buildISS() {
  const truss = makeMesh();
  // Central main truss — long thin lattice approximation as a beam
  cylinderX(truss, -10, 10, 0.35, 8);
  // Node connectors at intervals
  for (let i = -8; i <= 8; i += 4) {
    cylinderX(truss, i - 0.2, i + 0.2, 0.5, 8);
  }
  // Z-axis truss segments for the "lattice" look
  for (let i = -8; i <= 8; i += 4) {
    box(truss, [i, 0, 0.5], [0.1, 0.1, 0.5]);
    box(truss, [i, 0, -0.5], [0.1, 0.1, 0.5]);
  }

  // Pressurised modules — clustered near center, perpendicular to truss
  // (along Y axis) to mimic Zarya/Zvezda/Destiny/Kibo/Columbus layout.
  const modules = makeMesh();
  // Long stack along +Y (Zvezda → Zarya → Unity → Destiny)
  for (let i = 0; i < 4; i++) {
    const yc = -2.5 + i * 1.8;
    const r = i === 1 ? 0.8 : 0.7;
    // module along Y means cylinder rotated; build inline
    const segs = 16;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const yMin = yc - 0.85, yMax = yc + 0.85;
      pushQuad(modules,
        [x0, yMin, z0],
        [x0, yMax, z0],
        [x1, yMax, z1],
        [x1, yMin, z1],
      );
      pushTri(modules, [0, yMin, 0], [x0, yMin, z0], [x1, yMin, z1]);
      pushTri(modules, [0, yMax, 0], [x1, yMax, z1], [x0, yMax, z0]);
    }
  }
  // Side module — Kibo / Columbus style branch off main stack
  for (let i = 0; i < 2; i++) {
    const xc = (i === 0 ? -1.6 : 1.6);
    const segs = 12;
    const r = 0.55;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      const z0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r + 1.1;
      const z1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r + 1.1;
      const xMin = xc - 0.7, xMax = xc + 0.7;
      pushQuad(modules,
        [xMin, y0, z0],
        [xMax, y0, z0],
        [xMax, y1, z1],
        [xMin, y1, z1],
      );
      pushTri(modules, [xMin, 1.1, 0], [xMin, y1, z1], [xMin, y0, z0]);
      pushTri(modules, [xMax, 1.1, 0], [xMax, y0, z0], [xMax, y1, z1]);
    }
  }

  // Solar array wings — 4 on each truss tip = 8 total (mirroring real ISS)
  const arrays = makeMesh();
  // Wing geometry: each "wing" is two long thin panels with a small gap.
  function wing(xCenter, yOffset, zSign) {
    const wingLen = 4.5;   // panel length
    const wingWid = 1.2;   // span across the truss
    const gap = 0.25;
    // outer panel
    panel(arrays,
      [xCenter, yOffset + zSign * (wingWid + gap), 0],
      wingLen, wingWid, 0.04,
    );
    // inner panel
    panel(arrays,
      [xCenter, yOffset + zSign * (gap), 0],
      wingLen, wingWid, 0.04,
    );
  }
  // Port tip (-X)
  wing(-9, 0,  1);
  wing(-9, 0, -1);
  // Starboard tip (+X)
  wing( 9, 0,  1);
  wing( 9, 0, -1);
  // Inner truss arrays (ITS P4/P6 + S4/S6 mid-span)
  wing(-5, 0,  1);
  wing(-5, 0, -1);
  wing( 5, 0,  1);
  wing( 5, 0, -1);

  // Radiators — perpendicular to solar arrays, smaller, lighter color.
  const radiators = makeMesh();
  // Three radiator wings on each side of central truss along Z
  for (const xc of [-3.5, 0, 3.5]) {
    panel(radiators, [xc, 0,  1.6], 0.9, 0.4, 0.04);
    panel(radiators, [xc, 0, -1.6], 0.9, 0.4, 0.04);
  }

  // Solar array support booms (the long mast each wing extends from)
  const booms = makeMesh();
  for (const xc of [-9, -5, 5, 9]) {
    box(booms, [xc, 0,  0.4], [0.08, 0.08, 0.4]);
    box(booms, [xc, 0, -0.4], [0.08, 0.08, 0.4]);
  }

  // Docking adapters & antennas
  const details = makeMesh();
  // Forward docking adapter (pointed at +Y, beyond top module)
  cylinderZ(details, 0, 0, 0, 4); // placeholder no-op
  // Comm dishes
  box(details, [-1.0, -3.5, 0.3], [0.25, 0.05, 0.25]);
  box(details, [ 1.0, -3.5, 0.3], [0.25, 0.05, 0.25]);
  // Robotic arm stub (Canadarm2)
  box(details, [-2.0, 1.4, 0.7], [0.08, 1.2, 0.08]);
  box(details, [-3.0, 2.4, 0.7], [1.0, 0.08, 0.08]);

  return buildGLB(
    [
      { mesh: truss,     material: { name: "truss",     color: [0.55, 0.55, 0.58, 1], metallic: 0.6, roughness: 0.5 } },
      { mesh: modules,   material: { name: "modules",   color: [0.92, 0.90, 0.84, 1], metallic: 0.2, roughness: 0.6 } },
      { mesh: arrays,    material: { name: "arrays",    color: [0.05, 0.08, 0.28, 1], metallic: 0.3, roughness: 0.3, doubleSided: true, emissive: [0.01, 0.02, 0.06] } },
      { mesh: radiators, material: { name: "radiators", color: [0.90, 0.90, 0.92, 1], metallic: 0.5, roughness: 0.4, doubleSided: true } },
      { mesh: booms,     material: { name: "booms",     color: [0.30, 0.30, 0.32, 1], metallic: 0.6, roughness: 0.5 } },
      { mesh: details,   material: { name: "details",   color: [0.85, 0.78, 0.50, 1], metallic: 0.3, roughness: 0.6 } },
    ],
    "iss",
  );
}

// ────────────────────────────────────────────────────────────────────
// Emit
// ────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const generic = buildGenericLEO();
writeFileSync(resolve(OUT_DIR, "satellite-generic.glb"), generic);

const iss = buildISS();
writeFileSync(resolve(OUT_DIR, "iss.glb"), iss);

console.log(`generic: ${generic.length} bytes`);
console.log(`iss:     ${iss.length} bytes`);
