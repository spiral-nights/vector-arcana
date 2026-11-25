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
          float darkMask = smoothstep(0.25, 0.09, d);
          float rimMask = exp(-pow((d - 0.24) * 18.0, 2.0));
          float outerGlow = exp(-d * d * 11.0) * 0.65;

          vec3 darkCore = vec3(0.02, 0.01, 0.02);
          vec3 rimCol = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 3.0 - uTime * 14.0)) * 1.25;
          vec3 col = mix(rimCol, darkCore, darkMask);
          float alpha = clamp((darkMask * 0.98 + rimMask * 0.92 + outerGlow) * env, 0.0, 0.99);
          gl_FragColor = vec4(col, alpha);
        } else {
          float coreSoft = exp(-ay * ay * 6.2);
          float midGlow = exp(-ay * ay * 2.2);
          float softSurge = 0.94 + 0.06 * sin(x * 5.0 - uTime * 28.0);

          vec3 edgeTint = mix(uColorA, uColorB, 0.45 + 0.35 * sin(x * 3.5 - uTime * 16.0));
          vec3 centerCol = mix(edgeTint, vec3(0.86, 0.94, 0.90), 0.42);
          vec3 col = mix(edgeTint * 0.52, centerCol * (0.64 * softSurge), coreSoft);
          float alpha = clamp((coreSoft * 0.72 + midGlow * 0.44) * env, 0.0, 0.86);
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

        // Void beams mask additive light over the dark core; light beams keep center un-blown
        float centerCutout = mix(1.0, smoothstep(0.11, 0.27, abs(yy)), uIsVoid);

        // Layer 1: Soft glowing outer volume
        float volWide = exp(-yy * yy * 2.1) * mix(0.18, 0.24, uIsVoid) * centerCutout;
        float volInner = exp(-yy * yy * 8.5) * mix(0.13, 0.20, uIsVoid) * centerCutout;
        vec3 baseTint = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 0.65 - uTime * 4.0));
        vec3 col = baseTint * volWide + mix(uColorA, uColorB, 0.35) * volInner;

        // Subtle coursing pulse along standard beam core (zero for Void so dark center stays black)
        float beamCore = exp(-yy * yy * 26.0) * (1.0 - uIsVoid);
        float surge = 0.82 + 0.18 * sin(x * 4.2 - uTime * 30.0);
        vec3 coreTint = mix(uColorA, vec3(0.95, 1.0, 0.96), 0.45);
        col += coreTint * beamCore * surge * 0.06;

        // Layer 2: 5 intertwined braided organic silk ribbons (or jagged void tendrils)
        float freq = mix(1.85, 2.9, uIsVoid);
        float speed = mix(9.5, 16.0, uIsVoid);
        float amp = mix(0.26, 0.34, uIsVoid);

        float s0 = sin(x * freq - uTime * speed) * amp;
        float s1 = sin(x * (freq * 0.85) - uTime * (speed * 1.12) + 1.35) * (amp * 1.15);
        float s2 = sin(x * (freq * 1.18) - uTime * (speed * 0.92) + 2.7) * (amp * 0.95);
        float s3 = sin(x * (freq * 1.42) - uTime * (speed * 1.24) + 4.1) * (amp * 1.05);
        float s4 = sin(x * (freq * 0.65) - uTime * (speed * 0.8) + 5.2) * (amp * 1.25);

        float ribW = mix(13.0, 15.0, uIsVoid);
        float r0 = exp(-pow((yy - s0) * ribW, 2.0)) * centerCutout;
        float r1 = exp(-pow((yy - s1) * ribW, 2.0)) * centerCutout;
        float r2 = exp(-pow((yy - s2) * ribW, 2.0)) * centerCutout;
        float r3 = exp(-pow((yy - s3) * (ribW * 1.15), 2.0)) * centerCutout;
        float r4 = exp(-pow((yy - s4) * (ribW * 0.9), 2.0)) * centerCutout;

        col += uColorA * (r0 * 0.68 + r4 * 0.52);
        col += uColorB * (r1 * 0.72 + r3 * 0.52);
        col += uColorC * (r2 * 0.68);

        // Layer 3: Crisp luminous thin center filaments inside main ribbons
        float fil0 = exp(-pow((yy - s0) * 34.0, 2.0)) * centerCutout;
        float fil1 = exp(-pow((yy - s1) * 34.0, 2.0)) * centerCutout;
        float fil2 = exp(-pow((yy - s2) * 36.0, 2.0)) * centerCutout;
        vec3 filamentCol = mix(mix(uColorA, vec3(0.95), 0.45), mix(uColorA, vec3(1.0), 0.25), uIsVoid);
        col += filamentCol * (fil0 + fil1 + fil2 * 0.8) * mix(0.22, 0.35, uIsVoid);

        // Layer 4: Intersection node hotspot flares where ribbons cross
        float cross01 = exp(-pow((yy - s0) * 16.0, 2.0) - pow((yy - s1) * 16.0, 2.0)) * centerCutout;
        float cross12 = exp(-pow((yy - s1) * 16.0, 2.0) - pow((yy - s2) * 16.0, 2.0)) * centerCutout;
        float hotspot = clamp(cross01 + cross12, 0.0, 1.0);
        col += mix(uColorB, vec3(1.0), 0.28) * hotspot * 0.38;

        // Menacing Void pulse accent matching primary outline color
        if (uIsVoid > 0.5) {
          float abyssEdge = exp(-pow((abs(yy) - 0.48) * 9.0, 2.0)) * centerCutout;
          float voidPulse = 0.7 + 0.3 * sin(x * 4.5 - uTime * 18.0);
          col += uColorA * abyssEdge * 0.42 * voidPulse;
        }

        // Clean luminance cap so center never washes out to harsh white
        float peak = max(col.r, max(col.g, col.b));
        float maxPeak = mix(0.84, 1.08, uIsVoid);
        if (peak > maxPeak) {
          col *= (maxPeak + (peak - maxPeak) * 0.14) / peak;
        }

        col *= env;
        float alpha = clamp((volWide + volInner + beamCore * 0.45 + (r0 + r1 + r2 + r3 + r4) * 0.42) * env, 0.0, 0.95);
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
 * Overhead billowing procedural Storm Cloud disk shader tailored per element style.
 * Styles: 0=THERMAL/PLASMA inferno, 1=CRYO blizzard, 2=FLUX maelstrom, 3=VOLT storm, 4=VOID singularity, 5=NANO cyber-lattice
 */
export function createStormCloudMaterial(colorA: number, colorB: number, style = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uStyle: { value: style },
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
      uniform float uStyle;
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
        float radialEdge = smoothstep(1.0, 0.3, r);
        vec3 col = vec3(0.0);
        float alpha = 0.0;

        if (uStyle > 3.5 && uStyle < 4.5) {
          // 4: VOID black singularity vortex canopy
          float swirlA = ang - r * 3.8 + uTime * 2.2;
          vec2 uvS = vec2(cos(swirlA), sin(swirlA)) * r * 3.4;
          float cloud = fbm(uvS);
          float blackHole = smoothstep(0.32, 0.14, r);
          float photon = exp(-pow((r - 0.33) * 18.0, 2.0));
          vec3 rim = mix(uColorA, uColorB, cloud);
          col = mix(rim * (0.45 * cloud + photon * 1.1) * radialEdge, vec3(0.02, 0.01, 0.02), blackHole);
          alpha = clamp((blackHole * 0.92 + photon * 0.8 + cloud * 0.45 * radialEdge) * uOpacity, 0.0, 0.95);
        } else if (uStyle > 4.5) {
          // 5: NANO cybernetic telemetry halo canopy
          float ring1 = exp(-pow((r - 0.82) * 28.0, 2.0)) * (0.4 + 0.6 * sin(ang * 6.0 + uTime * 3.0));
          float ring2 = exp(-pow((r - 0.52) * 26.0, 2.0));
          float crossBars = max(exp(-abs(p.x) * 24.0), exp(-abs(p.y) * 24.0)) * smoothstep(0.65, 0.15, r);
          col = (uColorA * (ring1 + crossBars * 0.65) + uColorB * ring2 * 0.6) * radialEdge;
          alpha = clamp((ring1 * 0.55 + ring2 * 0.4 + crossBars * 0.4) * uOpacity, 0.0, 0.72);
        } else if (uStyle > 0.5 && uStyle < 1.5) {
          // 1: CRYO crisp 6-fold frost cyclone
          float spokes = pow(abs(cos((ang - uTime * 0.85 + r * 1.4) * 3.0)), 6.0);
          float frost = fbm(p * 3.5 + vec2(uTime * 0.2, -uTime * 0.15));
          col = mix(uColorA, uColorB, spokes) * (0.28 + frost * 0.38 + spokes * 0.55) * radialEdge;
          alpha = clamp((0.25 + spokes * 0.45 + frost * 0.25) * radialEdge * uOpacity, 0.0, 0.82);
        } else if (uStyle > 1.5 && uStyle < 2.5) {
          // 2: FLUX smooth sweeping rainband cyclone
          float band = 0.5 + 0.5 * sin(ang * 2.0 - r * 5.5 + uTime * 3.0);
          float mist = fbm(vec2(r * 3.0, ang) - vec2(0.0, uTime * 0.5));
          col = mix(uColorA, uColorB, band) * (0.26 + band * 0.42 + mist * 0.3) * radialEdge;
          alpha = clamp((0.3 + band * 0.42) * radialEdge * uOpacity, 0.0, 0.82);
        } else {
          // 0: THERMAL billowing ember cloud, or 3: VOLT flashing thunderhead
          float isVolt = step(2.5, uStyle);
          float swirlSpeed = mix(1.2, 2.2, isVolt);
          float swirlA = ang + (1.0 - r) * 2.4 - uTime * swirlSpeed;
          vec2 swirlUv = vec2(cos(swirlA), sin(swirlA)) * r * 3.2;
          float cloud = fbm(swirlUv + vec2(uTime * 0.45, -uTime * 0.35));
          float cloud2 = fbm(swirlUv * 1.7 - vec2(uTime * 0.7, uTime * 0.4));
          float cEdge = smoothstep(1.0, 0.32, r + (cloud - 0.5) * 0.3);
          float flash = isVolt * pow(max(0.0, sin(uTime * 12.0 + cloud * 14.0)), 14.0);
          float heatPulse = (1.0 - isVolt) * pow(cloud2, 2.0) * 0.75;
          col = (mix(uColorA, uColorB, cloud2) * (0.28 + cloud * 0.52 + heatPulse) + vec3(1.0, 0.98, 0.75) * (flash * cloud2 * 1.25)) * cEdge;
          alpha = clamp((cEdge * (0.38 + cloud * 0.4) + flash * 0.3) * uOpacity, 0.0, 0.88);
        }

        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.15) col *= 1.15 / peak;
        col *= uOpacity;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Element-Specific Vertical Barrier Wall Shader:
 * 0 = Kinetic stone glow seam, 1 = Cryo jagged glacier curtain, 2 = Thermal rising fire wall,
 * 3 = Flux cascading waterfall, 4 = Volt Tesla lightning fence, 5 = Void dark-matter rift (NormalBlending),
 * 6 = Nano emerald bio-cross lattice.
 */
export function createForcefieldWallMaterial(
  colorA: number,
  colorB: number,
  wallStyle = 6,
  isVoid = false
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uStyle: { value: wallStyle },
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
      uniform float uStyle;
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
        int st = int(uStyle + 0.5);

        if (st == 2) {
          // THERMAL / PLASMA: tall freely licking flames with molten base hearth
          float n1 = noise(vec2(vUv.x * 8.5, vUv.y * 3.8 - uTime * 4.4));
          float n2 = noise(vec2(vUv.x * 16.0 + 3.1, vUv.y * 7.5 - uTime * 6.8));
          float ridge = 0.55 + 0.45 * n1;
          float flameMask = smoothstep(vUv.y * 0.92, vUv.y * 0.92 + 0.28, ridge + n2 * 0.25);
          float hearth = exp(-pow(vUv.y * 5.2, 2.0));
          vec3 hot = mix(uColorA, uColorB, clamp(n2 * 0.8 + hearth * 0.4, 0.0, 1.0));
          vec3 col = hot * (flameMask * 1.05 + hearth * 0.95);
          float peak = max(col.r, max(col.g, col.b));
          if (peak > 1.2) col *= 1.2 / peak;
          float alpha = clamp((flameMask * 0.82 + hearth * 0.55) * (1.0 - smoothstep(0.86, 1.0, vUv.y)) * uOpacity, 0.0, 0.92);
          gl_FragColor = vec4(col * uOpacity, alpha);
          return;
        }

        if (st == 1) {
          // CRYO / CRYSTAL: jagged crystalline glacier silhouette & sharp frost facets
          float spike1 = abs(fract(vUv.x * 5.0 + 0.2) * 2.0 - 1.0);
          float spike2 = abs(fract(vUv.x * 9.0 + 0.6) * 2.0 - 1.0);
          float topCut = 0.62 + 0.26 * (1.0 - spike1) + 0.12 * (1.0 - spike2);
          if (vUv.y > topCut) discard;
          float edgeGlow = exp(-pow((topCut - vUv.y) * 14.0, 2.0));
          float facet = smoothstep(0.35, 0.85, noise(vec2(vUv.x * 14.0, vUv.y * 10.0)));
          float diag = pow(0.5 + 0.5 * sin(vUv.x * 34.0 + vUv.y * 20.0), 8.0) * 0.55;
          vec3 col = mix(uColorA, uColorB, facet * 0.65) * (0.48 + facet * 0.42)
            + vec3(0.85, 0.98, 1.0) * (edgeGlow * 0.85 + diag);
          float baseFrost = exp(-pow(vUv.y * 8.0, 2.0));
          col += uColorA * baseFrost * 0.7;
          float peak = max(col.r, max(col.g, col.b));
          if (peak > 1.2) col *= 1.2 / peak;
          float alpha = clamp((0.48 + edgeGlow * 0.45 + baseFrost * 0.3) * uOpacity, 0.0, 0.9);
          gl_FragColor = vec4(col * uOpacity, alpha);
          return;
        }

        if (st == 3) {
          // FLUX: undulating hydro-wave wall with cresting foam ripples
          float waveTop = 0.72 + 0.14 * sin(vUv.x * 14.0 - uTime * 4.5) + 0.08 * cos(vUv.x * 23.0 + uTime * 3.2);
          if (vUv.y > waveTop) discard;
          float crest = exp(-pow((waveTop - vUv.y) * 16.0, 2.0));
          float n = noise(vec2(vUv.x * 9.0 - uTime * 2.8, vUv.y * 7.0 + uTime * 1.8));
          float stream = pow(0.5 + 0.5 * sin(vUv.y * 22.0 + n * 5.0 - uTime * 4.2), 3.0);
          vec3 col = mix(uColorA, vec3(0.45, 0.88, 1.0), stream * 0.55) * (0.55 + n * 0.5)
            + vec3(0.85, 0.96, 1.0) * crest * 0.9;
          float peak = max(col.r, max(col.g, col.b));
          if (peak > 1.2) col *= 1.2 / peak;
          float alpha = clamp((0.46 + crest * 0.48 + stream * 0.25) * uOpacity, 0.0, 0.88);
          gl_FragColor = vec4(col * uOpacity, alpha);
          return;
        }

        if (st == 4) {
          // VOLT: high-voltage Tesla lightning fence with 3 crackling arcs
          float arcs = 0.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float centerY = 0.25 + fk * 0.26;
            float j = (noise(vec2(vUv.x * 22.0 + fk * 7.1, uTime * 18.0 + fk * 3.3)) - 0.5) * 0.16;
            arcs += exp(-pow((vUv.y - (centerY + j)) * 28.0, 2.0));
          }
          float haze = noise(vec2(vUv.x * 12.0, vUv.y * 8.0 + uTime * 9.0)) * 0.22;
          vec3 col = uColorA * (haze + arcs * 0.85) + vec3(1.0, 0.98, 0.85) * min(1.0, arcs) * 0.72;
          float peak = max(col.r, max(col.g, col.b));
          if (peak > 1.25) col *= 1.25 / peak;
          float alpha = clamp((haze * 0.7 + min(1.0, arcs) * 0.92) * uOpacity, 0.0, 0.95);
          gl_FragColor = vec4(col * uOpacity, alpha);
          return;
        }

        if (st == 5) {
          // VOID: pitch-black dark-matter rift framed by crackling elemental edges
          float swirl = noise(vec2(vUv.x * 8.0 - uTime * 1.8, vUv.y * 6.0 + uTime * 2.1));
          float edgeY = min(vUv.y, 1.0 - vUv.y);
          float rim = exp(-pow(edgeY * 9.0, 2.0));
          float tear = pow(0.5 + 0.5 * sin(vUv.x * 18.0 + swirl * 6.0 - uTime * 4.0), 6.0);
          vec3 darkCore = vec3(0.02, 0.01, 0.04);
          vec3 edgeGlow = mix(uColorA, uColorB, tear) * (rim * 1.1 + tear * 0.45);
          vec3 col = mix(darkCore, edgeGlow, clamp(rim + tear * 0.35, 0.0, 1.0));
          float alpha = clamp((0.86 - abs(vUv.y - 0.5) * 0.2 + rim * 0.15) * uOpacity, 0.0, 0.94);
          gl_FragColor = vec4(col, alpha);
          return;
        }

        // NANO / BARRIER (st == 6 or fallback): cellular bio-cross energy matrix
        vec2 cell = fract(vec2(vUv.x * 10.0, vUv.y * 4.5 - uTime * 1.4)) - 0.5;
        float crossH = step(abs(cell.x), 0.24) * step(abs(cell.y), 0.065);
        float crossV = step(abs(cell.y), 0.24) * step(abs(cell.x), 0.065);
        float crossGlyph = max(crossH, crossV);
        float rim = exp(-pow(vUv.y * 10.0, 2.0)) + exp(-pow((1.0 - vUv.y) * 10.0, 2.0));
        vec3 col = uColorA * (0.28 + rim * 0.75) + mix(uColorA, uColorB, 0.5) * crossGlyph * 0.85;
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.2) col *= 1.2 / peak;
        float alpha = clamp((0.28 + crossGlyph * 0.42 + rim * 0.45) * uOpacity, 0.0, 0.9);
        gl_FragColor = vec4(col * uOpacity, alpha);
      }
    `,
    transparent: true,
    blending: isVoid || wallStyle === 5 ? THREE.NormalBlending : THREE.AdditiveBlending,
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
 * Crystal Blade shader mixing CRYSTAL cyan (uColorA) with any infused element (uColorB),
 * or dark obsidian center with glowing element rim when Void is present.
 */
export function createCrystalBladeMaterial(colorA: number, colorB: number, isVoid = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uIsVoid: { value: isVoid ? 1.0 : 0.0 },
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
      uniform float uIsVoid;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        float distFromSpine = abs(vUv.y - 0.5) * 2.0;
        float spine = exp(-distFromSpine * distFromSpine * 22.0);
        float tipGlow = smoothstep(0.4, 1.0, vUv.x);
        float facetRim = smoothstep(0.58, 0.95, distFromSpine);
        float shimmer = 0.88 + 0.12 * sin(vUv.x * 10.0 - uTime * 14.0);

        if (uIsVoid > 0.5) {
          vec3 darkCore = vec3(0.03, 0.02, 0.04);
          vec3 rimCol = uColorB * (1.15 + tipGlow * 0.35) * shimmer;
          vec3 col = mix(darkCore, rimCol, facetRim);
          float alpha = clamp(0.95, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
          return;
        }

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
    blending: isVoid ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Ground Vortex rune shader tailored per element storm style (0=Fire, 1=Cryo, 2=Flux, 3=Volt, 4=Void, 5=Nano).
 */
export function createStormVortexMaterial(
  barrierColor: number,
  colorA: number,
  colorB: number,
  style = 0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorBarrier: { value: new THREE.Color(barrierColor) },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uStyle: { value: style },
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
      uniform float uStyle;
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

      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }

      float hexEdge(vec2 p) {
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        return smoothstep(0.08, 0.02, 0.5 - hexDist(gv));
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float edgeFade = smoothstep(1.0, 0.62, r);
        vec3 col = vec3(0.0);
        float alpha = 0.0;

        if (uStyle < 0.5) {
          // 0: THERMAL / PLASMA — Turbulent outward fire tongues
          float turb = noise(p * 4.5 - vec2(uTime * 1.4, -uTime * 1.2));
          float tongues = pow(0.5 + 0.5 * sin(ang * 4.0 - r * 7.5 + turb * 3.5 + uTime * 4.5), 2.8);
          float embers = pow(noise(p * 8.0 - vec2(0.0, uTime * 2.2)), 3.2);
          float eye = smoothstep(0.05, 0.25, r);
          col = (uColorA * (tongues * 0.95 * eye + 0.14) + uColorB * (embers * 0.85 + tongues * 0.35)) * edgeFade;
          alpha = clamp((tongues * 0.65 + embers * 0.4 + 0.14) * edgeFade * uOpacity, 0.0, 0.85);
        } else if (uStyle < 1.5) {
          // 1: CRYO / CRYSTAL — 6-fold geometric crystalline frost snowflake vortex
          float rotAng = ang - uTime * 1.1;
          float sixFold = pow(abs(cos(rotAng * 3.0 + r * 2.0)), 8.0);
          float frostHex = exp(-pow((hexDist(p * (0.9 + 0.05 * sin(uTime * 3.0))) - 0.62) * 18.0, 2.0));
          float frostHex2 = exp(-pow((hexDist(p) - 0.34) * 22.0, 2.0));
          col = (uColorA * (sixFold * 0.85 + frostHex2 * 0.7) + uColorB * (frostHex * 0.95 + sixFold * 0.3)) * edgeFade;
          alpha = clamp((sixFold * 0.58 + frostHex * 0.5 + frostHex2 * 0.4 + 0.1) * edgeFade * uOpacity, 0.0, 0.85);
        } else if (uStyle < 2.5) {
          // 2: FLUX — Concentric water ripples + smooth fluid spiral whirlpool
          float ripples = pow(0.5 + 0.5 * sin(r * 24.0 - uTime * 7.0), 3.5);
          float current = pow(0.5 + 0.5 * sin(ang * 2.0 - r * 9.5 + uTime * 4.2), 2.0);
          float eye = smoothstep(0.06, 0.28, r);
          col = (uColorA * (current * 0.72 * eye + ripples * 0.45) + uColorB * (ripples * 0.55)) * edgeFade;
          alpha = clamp((current * 0.45 + ripples * 0.38 + 0.12) * edgeFade * uOpacity, 0.0, 0.82);
        } else if (uStyle < 3.5) {
          // 3: VOLT — Jagged strobing lightning spokes & capacitor rings
          float boltWave = abs(sin(ang * 7.0 + sin(r * 16.0 - uTime * 18.0) * 1.4));
          float spokes = pow(boltWave, 14.0);
          float capRing = exp(-pow((r - 0.56) * 28.0, 2.0)) * (0.55 + 0.45 * sin(ang * 12.0 - uTime * 16.0));
          float flicker = 0.75 + 0.25 * sin(uTime * 32.0);
          col = (uColorA * (spokes * 1.1 + capRing * 0.9) + uColorB * (capRing * 0.6)) * flicker * edgeFade;
          alpha = clamp((spokes * 0.65 + capRing * 0.55 + 0.1) * edgeFade * uOpacity, 0.0, 0.85);
        } else if (uStyle < 4.5) {
          // 4: VOID — Black hole singularity core + glowing photon ring + inward accretion
          float blackHole = smoothstep(0.35, 0.16, r);
          float photon = exp(-pow((r - 0.35) * 22.0, 2.0));
          float inward = pow(0.5 + 0.5 * sin(ang * 6.0 + r * 18.0 + uTime * 8.5), 4.0) * smoothstep(0.28, 0.5, r);
          vec3 ringCol = (uColorA * (inward * 0.9 + photon * 1.2) + uColorB * (inward * 0.45 + photon * 0.4)) * edgeFade;
          col = mix(ringCol, vec3(0.02, 0.01, 0.02), blackHole);
          alpha = clamp((blackHole * 0.96 + photon * 0.92 + inward * 0.58 * edgeFade) * uOpacity, 0.0, 0.96);
        } else {
          // 5: NANO — Rotating cybernetic hex floor lattice + radar sweep + center cross
          float c = cos(uTime * 0.45);
          float s = sin(uTime * 0.45);
          vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
          float hex = hexEdge(rp * 4.5);
          float radar = smoothstep(0.7, 1.0, sin(ang - uTime * 3.5)) * smoothstep(0.95, 0.2, r);
          float crossMark = max(
            smoothstep(0.055, 0.015, abs(p.x)) * step(abs(p.y), 0.22),
            smoothstep(0.055, 0.015, abs(p.y)) * step(abs(p.x), 0.22)
          );
          col = (uColorA * (hex * 0.55 + radar * 0.55 + crossMark * 1.05) + uColorB * (hex * 0.35)) * edgeFade;
          alpha = clamp((hex * 0.38 + radar * 0.38 + crossMark * 0.72 + 0.1) * edgeFade * uOpacity, 0.0, 0.85);
        }

        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.1) col *= 1.1 / peak;
        col *= uOpacity;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: style === 4 ? THREE.NormalBlending : THREE.AdditiveBlending,
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
