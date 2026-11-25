import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  ArenaBlock,
  ArenaObstacle,
  ArenaObstacleStyle,
  ArenaPillar,
  ArenaShapeKind,
  ShieldBarrierEntity,
  Vec2,
  WallPylonEntity,
} from './types';

export const DEFAULT_RECT_BOUNDARY: readonly Vec2[] = [
  { x: -ARENA_HALF_W, y: -ARENA_HALF_H },
  { x: ARENA_HALF_W, y: -ARENA_HALF_H },
  { x: ARENA_HALF_W, y: ARENA_HALF_H },
  { x: -ARENA_HALF_W, y: ARENA_HALF_H },
];

function signedPolygonArea(verts: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

export function createConvexObstacle(
  id: number,
  rawVertices: Vec2[],
  height: number,
  style: ArenaObstacleStyle
): ArenaObstacle {
  const vertices =
    signedPolygonArea(rawVertices) < 0 ? [...rawVertices].reverse() : rawVertices.map((v) => ({ x: v.x, y: v.y }));
  let sx = 0;
  let sy = 0;
  for (const v of vertices) {
    sx += v.x;
    sy += v.y;
  }
  const n = Math.max(1, vertices.length);
  const cx = sx / n;
  const cy = sy / n;
  let boundRadius = 0;
  for (const v of vertices) {
    boundRadius = Math.max(boundRadius, Math.hypot(v.x - cx, v.y - cy));
  }
  return { id, vertices, cx, cy, boundRadius, height, style };
}

export function makeRegularPolyVerts(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotOffset = 0,
  stretchX = 1,
  stretchY = 1
): Vec2[] {
  const verts: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rotOffset;
    verts.push({
      x: cx + Math.cos(a) * radius * stretchX,
      y: cy + Math.sin(a) * radius * stretchY,
    });
  }
  return verts;
}

export function makeRotatedRectVerts(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  angleRad = 0
): Vec2[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const local: Array<[number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  return local.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

export function makeTrapezoidVerts(
  cx: number,
  cy: number,
  bottomHalfW: number,
  topHalfW: number,
  halfH: number,
  angleRad = 0
): Vec2[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const local: Array<[number, number]> = [
    [-bottomHalfW, -halfH],
    [bottomHalfW, -halfH],
    [topHalfW, halfH],
    [-topHalfW, halfH],
  ];
  return local.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

export function makeTriangleVerts(
  cx: number,
  cy: number,
  radius: number,
  angleRad = 0,
  stretchX = 1.25
): Vec2[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const local: Array<[number, number]> = [
    [radius * stretchX, 0],
    [-radius * 0.72, radius * 0.92],
    [-radius * 0.72, -radius * 0.92],
  ];
  return local.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

export function generateArenaBoundary(shape: ArenaShapeKind): Vec2[] {
  switch (shape) {
    case 'RECTANGLE':
      return DEFAULT_RECT_BOUNDARY.map((v) => ({ ...v }));
    case 'OCTAGON':
      return [
        { x: -760, y: -750 },
        { x: 760, y: -750 },
        { x: 1100, y: -410 },
        { x: 1100, y: 410 },
        { x: 760, y: 750 },
        { x: -760, y: 750 },
        { x: -1100, y: 410 },
        { x: -1100, y: -410 },
      ];
    case 'HEXAGON':
      return [
        { x: -580, y: -750 },
        { x: 580, y: -750 },
        { x: 1100, y: -180 },
        { x: 1100, y: 180 },
        { x: 580, y: 750 },
        { x: -580, y: 750 },
        { x: -1100, y: 180 },
        { x: -1100, y: -180 },
      ];
    case 'DIAMOND_VAULT':
      return [
        { x: -240, y: -750 },
        { x: 240, y: -750 },
        { x: 1100, y: -220 },
        { x: 1100, y: 220 },
        { x: 240, y: 750 },
        { x: -240, y: 750 },
        { x: -1100, y: 220 },
        { x: -1100, y: -220 },
      ];
    case 'TRAPEZOID_WEDGE':
      return [
        { x: -1100, y: -460 },
        { x: 1100, y: -750 },
        { x: 1100, y: 750 },
        { x: -1100, y: 460 },
      ];
    case 'CITADEL_DECAGON': {
      // 12-sided beveled colosseum with flat vertical West & East entry/exit planes
      const verts: Vec2[] = [];
      const sides = 12;
      const rx = 1090;
      const ry = 745;
      for (let i = 0; i < sides; i++) {
        const a = ((i + 0.5) / sides) * Math.PI * 2;
        verts.push({
          x: Math.round(Math.cos(a) * rx),
          y: Math.round(Math.sin(a) * ry),
        });
      }
      return verts;
    }
  }
}

export function getArenaHorizontalSpanAtY0(boundary: readonly Vec2[]): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    if ((a.y <= 0 && b.y >= 0) || (a.y >= 0 && b.y <= 0)) {
      const dy = b.y - a.y;
      if (Math.abs(dy) < 1e-6) {
        minX = Math.min(minX, a.x, b.x);
        maxX = Math.max(maxX, a.x, b.x);
      } else {
        const t = -a.y / dy;
        const ix = a.x + (b.x - a.x) * t;
        minX = Math.min(minX, ix);
        maxX = Math.max(maxX, ix);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { minX: -ARENA_HALF_W, maxX: ARENA_HALF_W };
  }
  return { minX, maxX };
}

/**
 * Checks whether (x, y) is inside a CCW convex polygon by at least `pad` units.
 */
export function pointInConvexPoly(
  x: number,
  y: number,
  poly: readonly Vec2[],
  pad = 0
): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    // Inward normal for CCW polygon is (-ey/len, ex/len)
    const nx = -ey / len;
    const ny = ex / len;
    const dist = (x - a.x) * nx + (y - a.y) * ny;
    if (dist < pad) return false;
  }
  return true;
}

export function clampPointToConvexPoly(
  x: number,
  y: number,
  pad: number,
  poly: readonly Vec2[]
): Vec2 {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = -ey / len;
      const ny = ex / len;
      const dist = (px - a.x) * nx + (py - a.y) * ny;
      if (dist < pad) {
        const push = pad - dist;
        px += nx * push;
        py += ny * push;
      }
    }
  }
  return { x: px, y: py };
}

export function circleVsConvexPoly(
  cx: number,
  cy: number,
  r: number,
  obs: ArenaObstacle
): { hit: boolean; pushX: number; pushY: number } {
  const dxC = cx - obs.cx;
  const dyC = cy - obs.cy;
  const maxR = obs.boundRadius + r;
  if (dxC * dxC + dyC * dyC > maxR * maxR) {
    return { hit: false, pushX: 0, pushY: 0 };
  }

  const verts = obs.vertices;
  let inside = true;
  let minOutDist = Infinity;
  let bestOutNx = 0;
  let bestOutNy = 1;

  let closestDistSq = Infinity;
  let closestX = cx;
  let closestY = cy;

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const lenSq = ex * ex + ey * ey;
    if (lenSq < 1e-6) continue;
    const len = Math.sqrt(lenSq);
    // Outward normal for CCW polygon is (ey/len, -ex/len)
    const outNx = ey / len;
    const outNy = -ex / len;
    const signedDist = (cx - a.x) * outNx + (cy - a.y) * outNy;
    if (signedDist > 0) {
      inside = false;
    } else if (-signedDist < minOutDist) {
      minOutDist = -signedDist;
      bestOutNx = outNx;
      bestOutNy = outNy;
    }

    const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cy - a.y) * ey) / lenSq));
    const qx = a.x + ex * t;
    const qy = a.y + ey * t;
    const pdx = cx - qx;
    const pdy = cy - qy;
    const d2 = pdx * pdx + pdy * pdy;
    if (d2 < closestDistSq) {
      closestDistSq = d2;
      closestX = qx;
      closestY = qy;
    }
  }

  if (inside) {
    const push = minOutDist + r;
    return { hit: true, pushX: bestOutNx * push, pushY: bestOutNy * push };
  }

  if (closestDistSq < r * r) {
    const dist = Math.sqrt(closestDistSq);
    if (dist > 1e-4) {
      const overlap = r - dist;
      return {
        hit: true,
        pushX: ((cx - closestX) / dist) * overlap,
        pushY: ((cy - closestY) / dist) * overlap,
      };
    }
    return { hit: true, pushX: bestOutNx * r, pushY: bestOutNy * r };
  }

  return { hit: false, pushX: 0, pushY: 0 };
}

export function rayVsConvexPoly(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  obs: ArenaObstacle
): number | null {
  let tEnter = 0;
  let tExit = maxDist;
  const verts = obs.vertices;

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // Outward normal (ey, -ex) (unnormalized is fine for Cyrus-Beck ratio)
    const nx = ey;
    const ny = -ex;
    const num = (ox - a.x) * nx + (oy - a.y) * ny;
    const den = dx * nx + dy * ny;

    if (Math.abs(den) < 1e-6) {
      if (num > 0) return null;
      continue;
    }
    const t = -num / den;
    if (den < 0) {
      // Entering polygon (moving against outward normal)
      if (t > tEnter) tEnter = t;
    } else {
      // Exiting polygon
      if (t < tExit) tExit = t;
    }
    if (tEnter > tExit) return null;
  }

  return tEnter > 8 && tEnter <= maxDist ? tEnter : null;
}

export function rayVsArenaBoundary(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  boundary: readonly Vec2[]
): number {
  let tExit = maxDist;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // Outward normal (ey, -ex)
    const nx = ey;
    const ny = -ex;
    const den = dx * nx + dy * ny;
    if (den > 1e-6) {
      const t = ((a.x - ox) * nx + (a.y - oy) * ny) / den;
      if (t >= 0 && t < tExit) {
        tExit = t;
      }
    }
  }
  return Math.max(8, tExit);
}

export function pushPointClearOfObstacles(
  x: number,
  y: number,
  r: number,
  boundary: readonly Vec2[],
  pillars: readonly ArenaPillar[],
  blocks: readonly ArenaBlock[],
  obstacles: readonly ArenaObstacle[]
): Vec2 {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 3; pass++) {
    const clamped = clampPointToConvexPoly(px, py, r + 6, boundary);
    px = clamped.x;
    py = clamped.y;

    for (const pil of pillars) {
      const dx = px - pil.x;
      const dy = py - pil.y;
      const minD = pil.radius + r;
      const d = Math.hypot(dx, dy);
      if (d > 0.01 && d < minD) {
        px = pil.x + (dx / d) * minD;
        py = pil.y + (dy / d) * minD;
      } else if (d <= 0.01) {
        px += minD;
      }
    }

    for (const blk of blocks) {
      const cx = Math.max(blk.x - blk.halfW, Math.min(blk.x + blk.halfW, px));
      const cy = Math.max(blk.y - blk.halfH, Math.min(blk.y + blk.halfH, py));
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.hypot(dx, dy);
      if (d < r) {
        if (d > 0.01) {
          px = cx + (dx / d) * r;
          py = cy + (dy / d) * r;
        } else {
          px = blk.x + blk.halfW + r;
        }
      }
    }

    for (const obs of obstacles) {
      const hit = circleVsConvexPoly(px, py, r, obs);
      if (hit.hit) {
        px += hit.pushX;
        py += hit.pushY;
      }
    }
  }
  return clampPointToConvexPoly(px, py, r + 4, boundary);
}

function normAngleRad(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function rayCircleHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  cx: number,
  cy: number,
  r: number
): number | null {
  const rx = ox - cx;
  const ry = oy - cy;
  const bProj = rx * dx + ry * dy;
  const cDist = rx * rx + ry * ry - r * r;
  const disc = bProj * bProj - cDist;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = -bProj - sqrtDisc;
  const t2 = -bProj + sqrtDisc;
  const t = t1 > 8 ? t1 : t2 > 8 ? t2 : null;
  return t !== null && t <= maxDist ? t : null;
}

function raySegHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number | null {
  const sx = bx - ax;
  const sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-5) return null;
  const qpx = ax - ox;
  const qpy = ay - oy;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;
  if (t > 8 && t <= maxDist && u >= -0.05 && u <= 1.05) {
    return t;
  }
  return null;
}

function rayAabbHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  b: ArenaBlock
): number | null {
  const minX = b.x - b.halfW;
  const maxX = b.x + b.halfW;
  const minY = b.y - b.halfH;
  const maxY = b.y + b.halfH;
  let tmin = 0;
  let tmax = maxDist;
  if (Math.abs(dx) < 1e-6) {
    if (ox < minX || ox > maxX) return null;
  } else {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-6) {
    if (oy < minY || oy > maxY) return null;
  } else {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 8 && tmin <= maxDist ? tmin : null;
}

export interface BlockedRayScene {
  arenaBoundary: readonly Vec2[];
  pillars: readonly ArenaPillar[];
  blocks: readonly ArenaBlock[];
  obstacles: readonly ArenaObstacle[];
  walls: readonly WallPylonEntity[];
  shields: readonly ShieldBarrierEntity[];
}

export function computeBlockedRayLength(
  ox: number,
  oy: number,
  angle: number,
  maxDist: number,
  scene: BlockedRayScene
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let limit = rayVsArenaBoundary(ox, oy, cos, sin, maxDist, scene.arenaBoundary);

  for (const pil of scene.pillars) {
    const t = rayCircleHit(ox, oy, cos, sin, limit, pil.x, pil.y, pil.radius + 2);
    if (t !== null && t < limit) limit = t;
  }

  for (const blk of scene.blocks) {
    const t = rayAabbHit(ox, oy, cos, sin, limit, blk);
    if (t !== null && t < limit) limit = t;
  }

  for (const obs of scene.obstacles) {
    const t = rayVsConvexPoly(ox, oy, cos, sin, limit, obs);
    if (t !== null && t < limit) limit = t;
  }

  const wallGroups = new Map<number, WallPylonEntity[]>();
  for (const w of scene.walls) {
    let arr = wallGroups.get(w.groupId);
    if (!arr) {
      arr = [];
      wallGroups.set(w.groupId, arr);
    }
    arr.push(w);
    const t = rayCircleHit(ox, oy, cos, sin, limit, w.x, w.y, w.radius + 4);
    if (t !== null && t < limit) limit = t;
  }
  for (const arr of wallGroups.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      const t = raySegHit(ox, oy, cos, sin, limit, a.x, a.y, b.x, b.y);
      if (t !== null && t < limit) limit = t;
    }
    if (arr.length >= 3 && arr[0]!.isNova) {
      const a = arr[arr.length - 1]!;
      const b = arr[0]!;
      const t = raySegHit(ox, oy, cos, sin, limit, a.x, a.y, b.x, b.y);
      if (t !== null && t < limit) limit = t;
    }
  }

  for (const s of scene.shields) {
    const rx = ox - s.x;
    const ry = oy - s.y;
    const bProj = rx * cos + ry * sin;
    const cDist = rx * rx + ry * ry - s.radius * s.radius;
    const disc = bProj * bProj - cDist;
    if (disc < 0) continue;
    const sqrtDisc = Math.sqrt(disc);
    for (const t of [-bProj - sqrtDisc, -bProj + sqrtDisc]) {
      if (t > 8 && t < limit) {
        if (!s.isNova) {
          const hitAng = Math.atan2(oy + sin * t - s.y, ox + cos * t - s.x);
          if (Math.abs(normAngleRad(hitAng - s.angle)) > s.arc) continue;
        }
        limit = t;
        break;
      }
    }
  }

  return Math.max(8, limit);
}
