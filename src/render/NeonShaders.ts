import * as THREE from 'three';

export function setShaderUniform(mat: THREE.Material | THREE.Material[], key: string, value: number): void {
  if (mat instanceof THREE.ShaderMaterial) {
    const u = mat.uniforms[key];
    if (u) u.value = value;
  }
}

/**
 * Builds a 2D polyline / polygon triangle-strip ribbon geometry in the XY plane
 * with safe miter clamping so sharp corners (chevrons, stars, lightning) never spike or NaN.
 * Includes UV.x along length / UV.y across width so shaders can render bright HDR cores.
 */
export function buildRibbonGeometry(
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  closed = false,
  z = 0
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const count = points.length;
  if (count < 2) return geo;

  // Filter degenerate consecutive duplicates
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    if (pts.length === 0) {
      pts.push({ x: p.x, y: p.y });
    } else {
      const prev = pts[pts.length - 1]!;
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) {
        pts.push({ x: p.x, y: p.y });
      }
    }
  }
  if (closed && pts.length > 2) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y) <= 1e-4) {
      pts.pop();
    }
  }

  const n = pts.length;
  if (n < 2) return geo;

  const halfW = width * 0.5;
  const maxMiter = halfW * 2.4;
  const vertCount = closed ? n + 1 : n;

  const positions = new Float32Array(vertCount * 2 * 3);
  const uvs = new Float32Array(vertCount * 2 * 2);
  const indices: number[] = [];

  // Cumulative arc length for UV.x
  const cumLen = new Float32Array(vertCount);
  let totalLen = 0;
  for (let i = 1; i < vertCount; i++) {
    const a = pts[(i - 1) % n]!;
    const b = pts[i % n]!;
    totalLen += Math.hypot(b.x - a.x, b.y - a.y);
    cumLen[i] = totalLen;
  }
  const invTotal = totalLen > 1e-4 ? 1 / totalLen : 1;

  for (let vi = 0; vi < vertCount; vi++) {
    const idx = vi % n;
    const curr = pts[idx]!;

    let hasPrev = false;
    let hasNext = false;
    let prev = curr;
    let next = curr;

    if (closed) {
      prev = pts[(idx - 1 + n) % n]!;
      next = pts[(idx + 1) % n]!;
      hasPrev = true;
      hasNext = true;
    } else {
      if (idx > 0) {
        prev = pts[idx - 1]!;
        hasPrev = true;
      }
      if (idx < n - 1) {
        next = pts[idx + 1]!;
        hasNext = true;
      }
    }

    let n1x = 0;
    let n1y = 0;
    let n2x = 0;
    let n2y = 0;

    if (hasPrev) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      n1x = -dy / len;
      n1y = dx / len;
    }
    if (hasNext) {
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const len = Math.hypot(dx, dy) || 1;
      n2x = -dy / len;
      n2y = dx / len;
    }

    let mx = 0;
    let my = 0;
    let miterLen = halfW;

    if (hasPrev && hasNext) {
      mx = n1x + n2x;
      my = n1y + n2y;
      const mLen = Math.hypot(mx, my);
      if (mLen < 1e-4) {
        mx = n2x;
        my = n2y;
        miterLen = halfW;
      } else {
        mx /= mLen;
        my /= mLen;
        const dot = mx * n2x + my * n2y;
        miterLen = dot > 0.25 ? Math.min(maxMiter, halfW / dot) : maxMiter;
      }
    } else if (hasNext) {
      mx = n2x;
      my = n2y;
    } else {
      mx = n1x;
      my = n1y;
    }

    const basePos = vi * 6;
    positions[basePos] = curr.x + mx * miterLen;
    positions[basePos + 1] = curr.y + my * miterLen;
    positions[basePos + 2] = z;

    positions[basePos + 3] = curr.x - mx * miterLen;
    positions[basePos + 4] = curr.y - my * miterLen;
    positions[basePos + 5] = z;

    const u = cumLen[vi]! * invTotal;
    const baseUv = vi * 4;
    uvs[baseUv] = u;
    uvs[baseUv + 1] = 0;
    uvs[baseUv + 2] = u;
    uvs[baseUv + 3] = 1;

    if (vi < vertCount - 1) {
      const v0 = vi * 2;
      const v1 = v0 + 1;
      const v2 = v0 + 2;
      const v3 = v0 + 3;
      indices.push(v0, v1, v2, v2, v1, v3);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * High-intensity additive neon ribbon material: white-hot center core + colored HDR edge halo
 * that drives UnrealBloomPass crisply without washing out the background.
 */
export function createNeonRibbonMaterial(
  colorHex: number,
  boost = 2.2,
  opacity = 1.0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uBoost: { value: boost },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBoost;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        float edge = abs(vUv.y - 0.5) * 2.0; // 0 at center, 1 at edge
        float core = exp(-edge * edge * 14.0);
        float halo = exp(-edge * edge * 3.0);
        vec3 col = mix(uColor * uBoost, vec3(1.0) * (uBoost * 1.15), core * 0.72);
        float alpha = clamp(halo * uOpacity, 0.0, 1.0);
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Braided volumetric plasma beam shader:
 * - Multiple phase-shifted helical core filaments braiding along UV.x
 * - Two turbulent outer plasma/flame tendrils undulating smoothly
 * - Smooth muzzle emergence taper (no white lens-flare blowout at origin)
 * - Energetic impact taper at far end
 */
export function createBraidedBeamMaterial(
  colorA: number,
  colorB: number,
  colorC: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uColorC: { value: new THREE.Color(colorC) },
      uTime: { value: 0 },
      uLength: { value: 10 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform float uTime;
      uniform float uLength;
      uniform float uFade;
      varying vec2 vUv;

      float hash1(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      float noise1(float x) {
        float i = floor(x);
        float f = fract(x);
        float u = f * f * (3.0 - 2.0 * f);
        return mix(hash1(i), hash1(i + 1.0), u);
      }

      void main() {
        float x = vUv.x * max(uLength, 1.0);
        float y = (vUv.y - 0.5) * 2.0; // -1 .. +1 across beam strip

        // Muzzle emergence and impact end envelopes (no white circular blob at muzzle)
        float muzzle = smoothstep(0.0, 0.38, x);
        float tail = 1.0 - smoothstep(max(uLength - 0.55, 0.0), uLength, x);
        float env = muzzle * tail * uFade;

        // 4 braided helical plasma ribbons flowing forward
        float freq = 3.1;
        float speed = 13.0;
        float s0 = sin(x * freq - uTime * speed) * 0.24;
        float s1 = sin(x * freq - uTime * speed + 1.5708) * 0.24;
        float s2 = sin(x * (freq * 1.25) - uTime * (speed * 1.15) + 3.1416) * 0.29;
        float s3 = sin(x * (freq * 0.9) - uTime * (speed * 0.92) + 4.7124) * 0.21;

        float f0 = exp(-pow((y - s0) * 11.0, 2.0));
        float f1 = exp(-pow((y - s1) * 11.0, 2.0));
        float f2 = exp(-pow((y - s2) * 10.0, 2.0));
        float f3 = exp(-pow((y - s3) * 12.0, 2.0));

        // Wider turbulent outer energy tendrils
        float turbA = (noise1(x * 1.8 - uTime * 9.5) - 0.5) * 0.36;
        float turbB = (noise1(x * 2.3 - uTime * 11.2 + 19.7) - 0.5) * 0.42;
        float outer1 = exp(-pow((y - s0 * 1.55 - turbA) * 4.4, 2.0));
        float outer2 = exp(-pow((y - s2 * 1.65 + turbB) * 3.9, 2.0));

        // Traveling high-frequency plasma pulses along beam length
        float pulse = 0.72 + 0.28 * sin(x * 7.5 - uTime * 22.0);
        float spine = exp(-y * y * 16.0);

        vec3 col = vec3(0.0);
        col += uColorA * (f0 * 1.85 + f1 * 1.55) * pulse;
        col += uColorB * (f2 * 1.85 + outer1 * 1.15);
        col += uColorC * (f3 * 1.65 + outer2 * 0.95);
        // White-hot narrow filament crossings only inside the braid
        float crossing = clamp(f0 * f1 + f2 * f3 + spine * 0.65, 0.0, 1.5);
        col += vec3(1.0, 0.98, 1.0) * crossing * 1.45;
        // Soft ambient sheath
        col += mix(uColorA, uColorB, 0.5) * exp(-y * y * 3.0) * 0.55;

        col *= env;
        float alpha = clamp((outer1 + outer2 + f0 + f1 + f2 + f3) * 0.65 * env, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * 360-degree Hex-Mesh Fresnel Dome shader inspired by images/barrier-ciruclar.svg:
 * - Soft glowing interior with sharp luminous Fresnel rim
 * - Procedural hexagonal lattice grid
 * - Rotating segmented inner ring (dashed arc)
 */
export function createHexDomeMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      float hexDist(vec2 p) {
        p = abs(p);
        float c = dot(p, normalize(vec2(1.0, 1.7320508)));
        return max(c, p.x);
      }

      float hexEdge(vec2 p) {
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        float d = 0.5 - hexDist(gv);
        return smoothstep(0.065, 0.015, d);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        // Dome curvature warp for pseudo-3D geodesic feel
        float z = sqrt(max(0.0, 1.0 - r * r));
        vec2 hexUv = p / (0.65 + z * 0.55) * 4.4;
        float hex = hexEdge(hexUv + vec2(uTime * 0.12, -uTime * 0.08));

        // Fresnel shell (0.04 at center -> strong luminous rim)
        float fresnel = pow(r, 2.2) * 0.85 + smoothstep(0.92, 0.995, r) * 1.85;
        float outerRim = exp(-pow((r - 0.97) * 32.0, 2.0));

        // Rotating inner dashed ring at r ~ 0.83
        float ang = atan(p.y, p.x) + uTime * 0.7;
        float dash = smoothstep(0.1, 0.25, sin(ang * 10.0));
        float innerRing = exp(-pow((r - 0.84) * 40.0, 2.0)) * dash;

        // Subtle shimmer sweep
        float sweep = 0.85 + 0.15 * sin(ang * 2.0 - uTime * 2.5);

        vec3 col = vec3(0.0);
        col += uColorA * (fresnel * 0.95 + outerRim * 1.9);
        col += uColorB * (hex * (0.28 + 0.55 * r) + innerRing * 1.6);
        col += vec3(0.95, 1.0, 1.0) * (outerRim * 0.9 + innerRing * 0.5);
        col *= sweep * uOpacity;

        float alpha = clamp((fresnel * 0.55 + hex * 0.45 + outerRim + innerRing * 0.85) * uOpacity, 0.0, 0.95);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Forward directional curved geodesic crescent barrier shader inspired by images/barrier.svg.
 */
export function createCurvedBarrierMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        // vUv.x = 0..1 across crescent arc, vUv.y = 0 (inner back) .. 1 (outer front edge)
        float frontEdge = smoothstep(0.75, 1.0, vUv.y);
        float backEdge = smoothstep(0.18, 0.0, vUv.y) * 0.55;
        float arcFade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);

        // Geodesic triangular lattice lines
        float g1 = abs(fract(vUv.x * 12.0 + vUv.y * 2.0) - 0.5);
        float g2 = abs(fract(vUv.x * 12.0 - vUv.y * 2.0) - 0.5);
        float tri = smoothstep(0.08, 0.015, min(g1, g2));

        float scan = 0.8 + 0.25 * sin(vUv.x * 18.0 - uTime * 5.5);

        vec3 col = uColorA * (0.45 + frontEdge * 1.9 + backEdge * 0.7);
        col += uColorB * (tri * 1.35 + frontEdge * 0.65);
        col += vec3(0.95, 1.0, 1.0) * pow(frontEdge, 2.0) * 1.3;
        col *= scan * arcFade * uOpacity;

        float alpha = clamp((0.28 + frontEdge * 0.7 + tri * 0.45) * arcFade * uOpacity, 0.0, 0.95);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Volumetric Spray Cone shader inspired by images/flux.svg:
 * - Soft directional volumetric mist gradient
 * - Expanding concentric crescent wave arcs (solid near muzzle, fragmented/dashed outward)
 * - Crisp luminous triangular muzzle emission wedge
 */
export function createSprayConeMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uHalfAngle: { value: 0.45 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uHalfAngle;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        // vUv spans a square centered around origin on x=0..1, y=-1..1
        float x = vUv.x;
        float y = (vUv.y - 0.5) * 2.0;
        float r = length(vec2(x, y));
        if (x <= 0.0 || r > 1.0) discard;

        float ang = abs(atan(y, x));
        float normAng = ang / max(uHalfAngle, 0.05);
        if (normAng > 1.0) discard;

        float angularEnv = smoothstep(1.0, 0.55, normAng);
        float radialEnv = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.32, r);

        // Turbulent volumetric mist
        float mist = noise(vec2(r * 7.5 - uTime * 6.5, (y / max(r, 0.15)) * 4.5));
        float mist2 = noise(vec2(r * 13.0 - uTime * 9.0 + 4.1, ang * 9.0));

        // Concentric expanding wave arcs: solid near muzzle, broken dashed arcs outward
        float wavePhase = fract(r * 4.8 - uTime * 3.6);
        float waveLine = exp(-pow((wavePhase - 0.5) * 8.5, 2.0));
        float dashBreak = mix(1.0, smoothstep(0.2, 0.65, sin(ang * 26.0 + r * 8.0 - uTime * 4.0)), smoothstep(0.3, 0.85, r));
        float arcs = waveLine * dashBreak * (1.0 - r * 0.45);

        // Bright muzzle flare wedge right at tip
        float muzzleWedge = exp(-r * 11.0) * smoothstep(0.85, 0.0, normAng);

        vec3 col = mix(uColorA, uColorB, 0.25 + 0.6 * mist2) * (0.55 + mist * 0.75) * radialEnv;
        col += mix(uColorB, vec3(0.95, 1.0, 1.0), 0.55) * arcs * 1.45;
        col += vec3(0.92, 0.98, 1.0) * muzzleWedge * 1.85;
        col *= angularEnv * uOpacity;

        float alpha = clamp((radialEnv * 0.48 + arcs * 0.65 + muzzleWedge) * angularEnv * uOpacity, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Sharp diamond Crystal Blade shader inspired by images/crystal-shards.svg:
 * - Deep cobalt -> vibrant cyan -> white gradient along the facet
 * - Intense white glowing central ridge spine
 */
export function createCrystalBladeMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        // vUv.x = 0 (tail) -> 1 (tip), vUv.y = 0..1 across width (0.5 is central spine)
        float distFromSpine = abs(vUv.y - 0.5) * 2.0;
        float spine = exp(-distFromSpine * distFromSpine * 20.0);
        float tipGlow = smoothstep(0.35, 1.0, vUv.x);
        float facetRim = smoothstep(0.68, 0.98, distFromSpine);
        float shimmer = 0.88 + 0.12 * sin(vUv.x * 10.0 - uTime * 14.0);

        vec3 grad = mix(uColorA, uColorB, 0.35 + 0.65 * vUv.x);
        vec3 col = grad * (1.25 + facetRim * 1.1) + vec3(1.0) * (spine * 2.1 + tipGlow * 0.85);
        col *= shimmer;

        float alpha = clamp(0.75 + spine * 0.25, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Swirling HDR Storm Vortex disk shader.
 */
export function createStormVortexMaterial(
  barrierColor: number,
  colorA: number,
  colorB: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorBarrier: { value: new THREE.Color(barrierColor) },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorBarrier;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float spiral1 = pow(0.5 + 0.5 * sin(ang * 3.0 - r * 11.0 + uTime * 5.2), 3.0);
        float spiral2 = pow(0.5 + 0.5 * sin(ang * 5.0 - r * 15.0 + uTime * 7.8 + 1.5), 4.0);
        float rim = exp(-pow((r - 0.94) * 26.0, 2.0));
        float innerRing = exp(-pow((r - 0.62) * 32.0, 2.0)) * (0.5 + 0.5 * sin(ang * 8.0 - uTime * 4.0));
        float eye = smoothstep(0.05, 0.25, r) * smoothstep(1.0, 0.2, r);

        vec3 col = vec3(0.0);
        col += uColorA * (spiral1 * 1.45 * eye + innerRing * 0.9);
        col += uColorB * (spiral2 * 1.65 * eye);
        col += uColorBarrier * (rim * 1.85 + 0.14 * (1.0 - r));
        col += vec3(1.0) * (rim * 0.55 + spiral1 * spiral2 * 0.8);
        col *= uOpacity;

        float alpha = clamp((rim + (spiral1 + spiral2) * 0.55 * eye + innerRing * 0.6 + 0.16) * uOpacity, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Wall barrier force-field panel shader with vertical laser-lattice bars and glowing seams.
 */
export function createWallPanelMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        float seam = exp(-pow((vUv.y - 0.5) * 4.5, 2.0));
        float border = smoothstep(0.6, 0.98, abs(vUv.y - 0.5) * 2.0);
        float bars = pow(0.5 + 0.5 * sin(vUv.x * 28.0 - uTime * 3.0), 4.0);
        float chev = pow(0.5 + 0.5 * sin(vUv.x * 16.0 + abs(vUv.y - 0.5) * 12.0 - uTime * 4.2), 5.0);

        vec3 col = uColorA * (0.45 + seam * 1.45 + border * 1.35);
        col += uColorB * (bars * 0.75 + chev * 1.25);
        col += vec3(1.0) * (seam * 0.55 + border * 0.45);
        col *= uOpacity;

        float alpha = clamp((0.32 + seam * 0.5 + border * 0.55 + chev * 0.3) * uOpacity, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Curved Kinetic/Phase Slash energy crescent blade shader.
 */
export function createSlashMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uFade;
      varying vec2 vUv;

      void main() {
        // vUv.x along arc (0..1), vUv.y radial (0 inner .. 1 outer cutting edge)
        float arcEnv = sin(vUv.x * 3.14159265);
        float outerBlade = exp(-pow((vUv.y - 0.86) * 8.5, 2.0));
        float trail = smoothstep(0.1, 0.88, vUv.y);

        vec3 col = mix(uColorB, uColorA, vUv.y) * (0.9 + outerBlade * 1.7);
        col += vec3(1.0) * pow(outerBlade, 2.0) * 1.85;
        col *= arcEnv * uFade;

        float alpha = clamp((trail * 0.45 + outerBlade) * arcEnv * uFade, 0.0, 0.96);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
