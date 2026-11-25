import * as THREE from 'three';

export function setShaderUniform(mat: THREE.Material | THREE.Material[], key: string, value: number): void {
  if (mat instanceof THREE.ShaderMaterial) {
    const u = mat.uniforms[key];
    if (u) u.value = value;
  }
}

/**
 * Builds a 2D polyline / polygon triangle-strip ribbon geometry in the XY plane
 * with safe miter clamping so sharp corners never spike or NaN.
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
 * High-intensity additive neon ribbon material with hue-preserving luminance clamping.
 */
export function createNeonRibbonMaterial(
  colorHex: number,
  boost = 1.15,
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
        float edge = abs(vUv.y - 0.5) * 2.0;
        float core = exp(-edge * edge * 28.0);
        float halo = exp(-edge * edge * 4.5);
        vec3 col = mix(uColor * uBoost, vec3(1.0) * (uBoost * 0.95), core * 0.25);
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.25) col *= 1.25 / peak;
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
 * Normal-blended beam core shader:
 * - Nano/standard (!isVoid): almost-solid white-hot core with vibrant saturated border
 * - Void (isVoid): pitch-dark obsidian/black-violet center core occluding background grid,
 *   rimmed tightly by blazing neon violet-magenta lightning edges.
 */
export function createBeamCoreMaterial(
  colorA: number,
  colorB: number,
  isVoid = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uIsVoid: { value: isVoid ? 1.0 : 0.0 },
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
      uniform float uIsVoid;
      uniform float uTime;
      uniform float uLength;
      uniform float uFade;
      varying vec2 vUv;

      void main() {
        float x = vUv.x * max(uLength, 1.0);
        float y = (vUv.y - 0.5) * 2.0;

        float muzzle = smoothstep(0.0, 0.16, x);
        float tail = 1.0 - smoothstep(max(uLength - 0.35, 0.0), uLength, x);
        float env = muzzle * tail * uFade;

        float ay = abs(y);
        float surge = 0.88 + 0.16 * sin(x * 6.0 - uTime * 34.0);

        if (uIsVoid > 0.5) {
          float ripple = sin(x * 7.5 - uTime * 28.0) * 0.025 + sin(x * 13.0 + uTime * 19.0) * 0.015;
          float d = abs(y + ripple);
          float darkMask = smoothstep(0.21, 0.08, d);
          float rimMask = exp(-pow((d - 0.21) * 18.0, 2.0));
          float outerGlow = exp(-d * d * 12.0) * 0.6;

          vec3 darkCore = vec3(0.04, 0.0, 0.08);
          vec3 rimCol = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 3.0 - uTime * 14.0)) * 1.45;
          vec3 col = mix(rimCol, darkCore, darkMask);
          float alpha = clamp((darkMask * 0.96 + rimMask * 0.92 + outerGlow) * env, 0.0, 0.98);
          gl_FragColor = vec4(col, alpha);
        } else {
          float whiteMask = smoothstep(0.23, 0.055, ay);
          float rimMask = exp(-pow((ay - 0.22) * 14.0, 2.0));
          float outerGlow = exp(-ay * ay * 9.0) * 0.55;

          vec3 edgeTint = mix(uColorA, uColorB, 0.45 + 0.35 * sin(x * 3.5 - uTime * 16.0));
          vec3 whiteCore = mix(edgeTint, vec3(1.0, 0.99, 0.96), 0.88) * (1.28 * surge);
          vec3 col = mix(edgeTint * 1.15, whiteCore, whiteMask);
          float alpha = clamp((whiteMask * 0.97 + rimMask * 0.88 + outerGlow) * env, 0.0, 0.98);
          gl_FragColor = vec4(col, alpha);
        }
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Volumetric Silk-Braided Energy Beam Shader wrapping around the beam core:
 * - Organic undulating braided plasma ribbons in mixed element colors
 * - Thin crisp center filaments along strands & intersection node flares
 */
export function createBraidedBeamMaterial(
  colorA: number,
  colorB: number,
  colorC: number,
  isVoid = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uColorC: { value: new THREE.Color(colorC) },
      uIsVoid: { value: isVoid ? 1.0 : 0.0 },
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
      uniform float uIsVoid;
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
        float y = (vUv.y - 0.5) * 2.0;

        float muzzle = smoothstep(0.0, 0.25, x);
        float tail = 1.0 - smoothstep(max(uLength - 0.45, 0.0), uLength, x);
        float env = muzzle * tail * uFade;

        // Void beams get jagged crackling distortion along Y; Nano beams flow silky & organic
        float crackle = (noise1(x * 5.2 - uTime * 19.0) - 0.5) * 0.22 * uIsVoid;
        float flowTurb = (noise1(x * 1.4 - uTime * 8.5) - 0.5) * 0.14;
        float yy = y + crackle + flowTurb * 0.45;

        // Layer 1: Continuous unbroken glowing volume across the whole beam
        float volWide = exp(-yy * yy * 2.1) * (0.42 - 0.08 * uIsVoid);
        float volInner = exp(-yy * yy * 8.5) * 0.52;
        vec3 baseTint = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 0.65 - uTime * 4.0));
        vec3 col = baseTint * volWide + mix(uColorA, uColorB, 0.35) * volInner;

        // Bright coursing energy core running rapidly down the beam center
        float beamCore = exp(-yy * yy * 26.0);
        float surge = 0.72 + 0.32 * sin(x * 4.2 - uTime * 30.0) + 0.16 * sin(x * 10.5 - uTime * 48.0);
        vec3 coreTint = mix(mix(uColorA, vec3(1.0), 0.72), mix(uColorB, vec3(1.0, 0.78, 1.0), 0.65), uIsVoid);
        col += coreTint * beamCore * surge * 1.15;

        // Layer 2: 5 intertwined braided organic silk ribbons (or jagged void tendrils)
        float freq = mix(1.85, 2.9, uIsVoid);
        float speed = mix(9.5, 16.0, uIsVoid);
        float amp = mix(0.26, 0.33, uIsVoid);

        float s0 = sin(x * freq - uTime * speed) * amp;
        float s1 = sin(x * (freq * 0.85) - uTime * (speed * 1.12) + 1.35) * (amp * 1.15);
        float s2 = sin(x * (freq * 1.18) - uTime * (speed * 0.92) + 2.7) * (amp * 0.95);
        float s3 = sin(x * (freq * 1.42) - uTime * (speed * 1.24) + 4.1) * (amp * 1.05);
        float s4 = sin(x * (freq * 0.65) - uTime * (speed * 0.8) + 5.2) * (amp * 1.25);

        float ribW = mix(13.0, 15.0, uIsVoid);
        float r0 = exp(-pow((yy - s0) * ribW, 2.0));
        float r1 = exp(-pow((yy - s1) * ribW, 2.0));
        float r2 = exp(-pow((yy - s2) * ribW, 2.0));
        float r3 = exp(-pow((yy - s3) * (ribW * 1.15), 2.0));
        float r4 = exp(-pow((yy - s4) * (ribW * 0.9), 2.0));

        col += uColorA * (r0 * 0.68 + r4 * 0.52);
        col += uColorB * (r1 * 0.72 + r3 * 0.52);
        col += uColorC * (r2 * 0.68);

        // Layer 3: Crisp luminous thin center filaments inside main ribbons
        float fil0 = exp(-pow((yy - s0) * 34.0, 2.0));
        float fil1 = exp(-pow((yy - s1) * 34.0, 2.0));
        float fil2 = exp(-pow((yy - s2) * 36.0, 2.0));
        vec3 filamentCol = mix(vec3(1.0, 0.96, 0.85), vec3(1.0, 0.45, 0.95), uIsVoid);
        col += filamentCol * (fil0 + fil1 + fil2 * 0.8) * 0.45;

        // Layer 4: Intersection node hotspot flares where ribbons cross
        float cross01 = exp(-pow((yy - s0) * 16.0, 2.0) - pow((yy - s1) * 16.0, 2.0));
        float cross12 = exp(-pow((yy - s1) * 16.0, 2.0) - pow((yy - s2) * 16.0, 2.0));
        float hotspot = clamp(cross01 + cross12, 0.0, 1.0);
        col += mix(uColorB, vec3(1.0), 0.45) * hotspot * 0.48;

        // Menacing Void pulse accent
        if (uIsVoid > 0.5) {
          float abyssEdge = exp(-pow((abs(yy) - 0.48) * 9.0, 2.0));
          float voidPulse = 0.7 + 0.3 * sin(x * 4.5 - uTime * 18.0);
          col += vec3(0.55, 0.05, 0.95) * abyssEdge * 0.42 * voidPulse;
        }

        // Gentle core-friendly rolloff so bright center blooms while edges stay deeply saturated
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.55) {
          col *= (1.55 + (peak - 1.55) * 0.14) / peak;
        }

        col *= env;
        float alpha = clamp((volWide * 1.1 + volInner + beamCore * 0.85 + (r0 + r1 + r2 + r3 + r4) * 0.42) * env, 0.0, 0.98);
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
 * Overhead billowing procedural Storm Cloud disk shader with swirling eye and lightning flashes.
 */
export function createStormCloudMaterial(colorA: number, colorB: number): THREE.ShaderMaterial {
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

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.03 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float swirlA = ang + (1.0 - r) * 2.2 - uTime * 1.4;
        vec2 swirlUv = vec2(cos(swirlA), sin(swirlA)) * r * 3.2;

        float cloud = fbm(swirlUv + vec2(uTime * 0.45, -uTime * 0.35));
        float cloud2 = fbm(swirlUv * 1.6 - vec2(uTime * 0.7, uTime * 0.4));

        float radialEdge = smoothstep(1.0, 0.32, r + (cloud - 0.5) * 0.32);
        float eyeRim = exp(-pow((r - 0.45) * 6.5, 2.0)) * cloud2;
        float flash = pow(max(0.0, sin(uTime * 10.5 + cloud * 12.0)), 14.0);

        vec3 darkBody = mix(uColorA, uColorB, 0.35) * (0.28 + cloud * 0.55);
        vec3 lightningVein = mix(uColorB, vec3(1.0), 0.45) * (flash * cloud2 * 1.15 + eyeRim * 0.7);
        vec3 col = (darkBody + lightningVein) * radialEdge;

        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.2) col *= 1.2 / peak;
        col *= uOpacity;

        float alpha = clamp((radialEdge * (0.42 + cloud * 0.42) + flash * 0.25) * uOpacity, 0.0, 0.9);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Full Vertical Forcefield Wall Panel Shader (with rising organic fire mode for THERMAL walls).
 */
export function createForcefieldWallMaterial(colorA: number, colorB: number, isFire = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uIsFire: { value: isFire ? 1.0 : 0.0 },
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
      uniform float uIsFire;
      uniform float uTime;
      uniform float uOpacity;
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
        if (uIsFire > 0.5) {
          float n1 = noise(vec2(vUv.x * 7.5, vUv.y * 4.5 - uTime * 3.8));
          float n2 = noise(vec2(vUv.x * 15.0 + 3.1, vUv.y * 8.0 - uTime * 6.2));
          float tongues = smoothstep(0.18, 0.95, (1.0 - vUv.y * 0.72) * (0.45 + 0.55 * n1) + n2 * 0.25);
          float baseEmber = exp(-pow(vUv.y * 6.5, 2.0));
          vec3 col = mix(uColorA, uColorB, n2) * (tongues * 0.95 + baseEmber * 0.85);
          float peak = max(col.r, max(col.g, col.b));
          if (peak > 1.2) col *= 1.2 / peak;
          col *= uOpacity;
          float alpha = clamp((tongues * 0.65 + baseEmber * 0.5) * uOpacity, 0.0, 0.88);
          gl_FragColor = vec4(col, alpha);
          return;
        }

        float bottomRail = exp(-pow(vUv.y * 12.0, 2.0));
        float topRail = exp(-pow((1.0 - vUv.y) * 12.0, 2.0));
        float midBeam = exp(-pow((vUv.y - 0.5) * 5.0, 2.0)) * 0.45;

        float bars = pow(0.5 + 0.5 * sin(vUv.x * 24.0), 6.0) * 0.55;
        float chev = pow(0.5 + 0.5 * sin(vUv.x * 16.0 - abs(vUv.y - 0.5) * 14.0 - uTime * 5.0), 5.0);
        float scan = exp(-pow(fract(vUv.y - uTime * 0.75) * 10.0, 2.0)) * 0.5;

        vec3 glassTint = mix(uColorA, uColorB, 0.35) * 0.32;
        vec3 col = glassTint;
        col += uColorA * (bottomRail * 1.05 + topRail * 1.05 + midBeam + bars);
        col += uColorB * (chev * 0.75 + scan);
        col += vec3(1.0) * (bottomRail + topRail) * 0.22;

        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.2) col *= 1.2 / peak;
        col *= uOpacity;

        float alpha = clamp((0.34 + bottomRail * 0.6 + topRail * 0.6 + chev * 0.28 + scan * 0.25) * uOpacity, 0.0, 0.9);
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
 * Calm static-shoreline organic water puddle with gentle shimmering glints.
 */
export function createLiquidPoolMaterial(colorA: number, colorB: number, seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uSeed: { value: seed },
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
      uniform float uSeed;
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
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float ang = atan(p.y, p.x);

        // Static organic shoreline
        float edgeRadius = 0.82 + 0.1 * sin(ang * 3.0 + uSeed) + 0.05 * cos(ang * 5.0 - uSeed * 1.7);
        if (r > edgeRadius) discard;

        float normR = r / edgeRadius;
        float rim = exp(-pow((normR - 0.94) * 16.0, 2.0));
        float glint = pow(noise(p * 4.5 + vec2(uTime * 0.45, -uTime * 0.35)), 2.2);
        float body = smoothstep(1.0, 0.15, normR) * 0.42;

        vec3 col = uColorA * (body + rim * 0.85) + uColorB * glint * 0.42;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.1) col *= 1.1 / peak;
        col *= uOpacity;

        float alpha = clamp((body + rim * 0.65 + glint * 0.2) * uOpacity, 0.0, 0.78);
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
 * 360-degree Hex-Mesh Fresnel Dome shader.
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

        float z = sqrt(max(0.0, 1.0 - r * r));
        vec2 hexUv = p / (0.65 + z * 0.55) * 4.4;
        float hex = hexEdge(hexUv + vec2(uTime * 0.12, -uTime * 0.08));

        float fresnel = pow(r, 2.2) * 0.5 + smoothstep(0.92, 0.995, r) * 0.95;
        float outerRim = exp(-pow((r - 0.97) * 32.0, 2.0));

        float ang = atan(p.y, p.x) + uTime * 0.7;
        float dash = smoothstep(0.1, 0.25, sin(ang * 10.0));
        float innerRing = exp(-pow((r - 0.84) * 40.0, 2.0)) * dash;

        float sweep = 0.85 + 0.15 * sin(ang * 2.0 - uTime * 2.5);

        vec3 col = vec3(0.0);
        col += uColorA * (fresnel * 0.65 + outerRim * 1.05);
        col += uColorB * (hex * (0.22 + 0.42 * r) + innerRing * 0.95);
        col += vec3(0.95, 1.0, 1.0) * (outerRim * 0.25 + innerRing * 0.15);
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.15) col *= 1.15 / peak;
        col *= sweep * uOpacity;

        float alpha = clamp((fresnel * 0.45 + hex * 0.4 + outerRim * 0.85 + innerRing * 0.7) * uOpacity, 0.0, 0.88);
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
 * Forward directional curved geodesic crescent barrier shader.
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
        float frontEdge = smoothstep(0.75, 1.0, vUv.y);
        float backEdge = smoothstep(0.18, 0.0, vUv.y) * 0.4;
        float arcFade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);

        float g1 = abs(fract(vUv.x * 12.0 + vUv.y * 2.0) - 0.5);
        float g2 = abs(fract(vUv.x * 12.0 - vUv.y * 2.0) - 0.5);
        float tri = smoothstep(0.08, 0.015, min(g1, g2));

        float scan = 0.82 + 0.18 * sin(vUv.x * 18.0 - uTime * 5.5);

        vec3 col = uColorA * (0.35 + frontEdge * 1.0 + backEdge * 0.45);
        col += uColorB * (tri * 0.85 + frontEdge * 0.45);
        col += vec3(0.95, 1.0, 1.0) * pow(frontEdge, 2.0) * 0.35;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.15) col *= 1.15 / peak;
        col *= scan * arcFade * uOpacity;

        float alpha = clamp((0.28 + frontEdge * 0.6 + tri * 0.4) * arcFade * uOpacity, 0.0, 0.88);
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
 * Volumetric Spray Cone shader with multi-octave swirling turbulence and foaming wave arcs.
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

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p *= 2.1;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        float x = vUv.x;
        float y = (vUv.y - 0.5) * 2.0;
        float r = length(vec2(x, y));
        if (x <= 0.0 || r > 1.0) discard;

        float ang = abs(atan(y, x));
        float normAng = ang / max(uHalfAngle, 0.05);
        if (normAng > 1.0) discard;

        float angularEnv = smoothstep(1.0, 0.42, normAng);
        float radialEnv = smoothstep(0.0, 0.07, r) * smoothstep(1.0, 0.25, r);

        float mist = fbm(vec2(r * 6.5 - uTime * 6.2, (y / max(r, 0.14)) * 4.2));
        float mist2 = fbm(vec2(r * 11.0 - uTime * 9.0 + 4.1, ang * 8.0));

        float wavePhase = fract(r * 4.5 - uTime * 3.8);
        float waveLine = exp(-pow((wavePhase - 0.5) * 8.0, 2.0));
        float dashBreak = mix(1.0, smoothstep(0.18, 0.65, sin(ang * 24.0 + r * 7.0 - uTime * 4.0)), smoothstep(0.28, 0.85, r));
        float arcs = waveLine * dashBreak * (1.0 - r * 0.45);

        float muzzleWedge = exp(-r * 10.5) * smoothstep(0.85, 0.0, normAng);

        vec3 col = mix(uColorA, uColorB, 0.2 + 0.7 * mist2) * (0.45 + mist * 0.85) * radialEnv;
        col += mix(uColorB, vec3(0.95, 1.0, 1.0), 0.25) * arcs * 0.85;
        col += mix(uColorB, vec3(0.95, 1.0, 1.0), 0.35) * muzzleWedge * 0.85;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.15) col *= 1.15 / peak;
        col *= angularEnv * uOpacity;

        float alpha = clamp((radialEnv * (0.35 + mist * 0.35) + arcs * 0.5 + muzzleWedge * 0.65) * angularEnv * uOpacity, 0.0, 0.88);
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
 * Crystal Blade shader mixing CRYSTAL cyan (uColorA) with any infused element (uColorB).
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
        float distFromSpine = abs(vUv.y - 0.5) * 2.0;
        float spine = exp(-distFromSpine * distFromSpine * 22.0);
        float tipGlow = smoothstep(0.4, 1.0, vUv.x);
        float facetRim = smoothstep(0.62, 0.98, distFromSpine);
        float shimmer = 0.88 + 0.12 * sin(vUv.x * 10.0 - uTime * 14.0);

        vec3 grad = mix(uColorA, uColorB, 0.28 + 0.55 * vUv.x + 0.17 * distFromSpine);
        vec3 col = grad * (0.95 + facetRim * 0.65) + uColorB * (facetRim * 0.45) + vec3(1.0) * (spine * 0.45 + tipGlow * 0.28);
        col *= shimmer;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.25) col *= 1.25 / peak;

        float alpha = clamp(0.8 + spine * 0.2, 0.0, 1.0);
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
 * Ground Vortex rune shader for storm impact zone.
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
        col += uColorA * (spiral1 * 0.78 * eye + innerRing * 0.45);
        col += uColorB * (spiral2 * 0.88 * eye);
        float edgeFade = smoothstep(1.0, 0.65, r);
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.1) col *= 1.1 / peak;
        col *= edgeFade * uOpacity;

        float alpha = clamp(((spiral1 + spiral2) * 0.42 * eye + innerRing * 0.4 + 0.12) * edgeFade * uOpacity, 0.0, 0.8);
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
        float arcEnv = sin(vUv.x * 3.14159265);
        float outerBlade = exp(-pow((vUv.y - 0.86) * 8.5, 2.0));
        float trail = smoothstep(0.1, 0.88, vUv.y);

        vec3 col = mix(uColorB, uColorA, vUv.y) * (0.7 + outerBlade * 1.1);
        col += vec3(1.0) * pow(outerBlade, 2.0) * 0.42;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.25) col *= 1.25 / peak;
        col *= arcEnv * uFade;

        float alpha = clamp((trail * 0.42 + outerBlade * 0.88) * arcEnv * uFade, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
