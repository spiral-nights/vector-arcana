import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ArtStyle } from '../settings';
import { DEFAULT_RECT_BOUNDARY } from '../sim/ArenaGeometry';
import { ARENA_HALF_H, ARENA_HALF_W, Vec2 } from '../sim/types';
import { createGlowSprite } from './GlowUtil';
import { buildRibbonGeometry, createNeonRibbonMaterial } from './NeonShaders';
import {
  buildInkOutlineGeometry,
  createDropShadowMaterial,
  createSumiInkMaterial,
  createWatercolorWashMaterial,
  getPolygonWashTexture,
} from './WatercolorAssets';

const SECTOR_BORDER_COLORS = [0x00d8ff, 0xff5522, 0x44f5ff, 0x39ff88, 0xb429ff] as const;

const ImpactPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0.0 },
    uRippleStrength: { value: 0.0 },
    uRippleRadius: { value: 0.0 },
    uRippleCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.24 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uRippleStrength;
    uniform float uRippleRadius;
    uniform vec2 uRippleCenter;
    uniform float uVignette;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      if (uRippleStrength > 0.0002) {
        vec2 toP = uv - uRippleCenter;
        float dist = length(toP);
        float diff = abs(dist - uRippleRadius);
        float ring = smoothstep(0.085, 0.0, diff);
        uv += normalize(toP + vec2(0.0001)) * ring * uRippleStrength;
      }

      vec2 fromCenter = uv - vec2(0.5);
      float ab = uAberration * (0.4 + length(fromCenter) * 1.4);
      vec2 shift = normalize(fromCenter + vec2(0.0001)) * ab;

      float r = texture2D(tDiffuse, clamp(uv + shift, vec2(0.001), vec2(0.999))).r;
      float g = texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).g;
      float b = texture2D(tDiffuse, clamp(uv - shift, vec2(0.001), vec2(0.999))).b;
      vec3 col = vec3(r, g, b);

      float edgeDist = length(fromCenter) * 1.414;
      float vig = 1.0 - smoothstep(0.58, 1.18, edgeDist) * uVignette;
      gl_FragColor = vec4(col * vig, 1.0);
    }
  `,
};

function createBorderSkirtMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0.34 },
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
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float h = pow(1.0 - vUv.y, 1.85);
        float pulse = 0.88 + 0.12 * sin(vUv.x * 24.0);
        gl_FragColor = vec4(uColor * (0.85 + h * 0.55) * pulse, h * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createPolygonPts(sides: number, radius: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly impactPass: ShaderPass;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitVec = new THREE.Vector3();

  private readonly borderGroup = new THREE.Group();
  private artStyle: ArtStyle = 'VECTOR_NEON';
  private userBloomIntensity = 1.0;
  private currentThemeWave = -1;
  private lastBoundaryKey = '';
  private lastBoundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY;
  private lastWaveNum = 1;

  private tiltEnabled = true;
  private shakeIntensity = 0;
  private shakeScale = 1.0;
  private pixelRatioCap: 1 | 2 = 2;
  private aberration = 0;
  private rippleStrength = 0;
  private rippleRadius = 0;
  private camX = 0;
  private camY = 0;
  private readonly camDist = 1160;
  private baseCamPos = new THREE.Vector3(0, 0, 1160);
  private frustumHalfW = 580;
  private frustumHalfH = 400;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050c);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(38, Math.max(0.1, width / Math.max(1, height)), 50, 4000);
    this.updateCameraFrustum(width, height);
    this.applyCameraTransform(0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.56, 0.36, 0.64);
    this.composer.addPass(this.bloomPass);
    this.impactPass = new ShaderPass(ImpactPostShader);
    this.composer.addPass(this.impactPass);
    this.composer.addPass(new OutputPass());

    const hemi = new THREE.HemisphereLight(0xaaccff, 0x161b2e, 1.15);
    this.scene.add(hemi);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(380, -450, 720);
    this.scene.add(dirLight);

    this.scene.add(this.borderGroup);
    this.setArenaBoundary(DEFAULT_RECT_BOUNDARY, 1);
    window.addEventListener('resize', this.handleResize);
  }

  private clearBorderGroup(): void {
    while (this.borderGroup.children.length > 0) {
      const child = this.borderGroup.children[0]!;
      this.borderGroup.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Sprite) {
          obj.material.dispose();
        } else if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) obj.material.dispose();
        }
      });
    }
  }

  public setArenaBoundary(boundary: readonly Vec2[], wave: number): void {
    this.lastBoundary = boundary;
    this.lastWaveNum = wave;
    const themeIdx = Math.max(0, wave - 1) % SECTOR_BORDER_COLORS.length;
    const key = `${this.artStyle}:${themeIdx}:${boundary.map((v) => `${v.x},${v.y}`).join(';')}`;
    if (key === this.lastBoundaryKey) return;
    this.lastBoundaryKey = key;
    this.currentThemeWave = themeIdx;
    const colHex = SECTOR_BORDER_COLORS[themeIdx]!;

    this.clearBorderGroup();
    if (boundary.length < 3) return;

    let cx = 0;
    let cy = 0;
    for (const v of boundary) {
      cx += v.x;
      cy += v.y;
    }
    cx /= boundary.length;
    cy /= boundary.length;

    const outerPts = boundary.map((v) => {
      const dx = v.x - cx;
      const dy = v.y - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      return { x: v.x + (dx / len) * 16, y: v.y + (dy / len) * 16 };
    });

    if (this.artStyle === 'WATERCOLOR_INK') {
      const borderGlow = new THREE.Mesh(
        buildRibbonGeometry(boundary, 11.0, true, 1.0),
        createNeonRibbonMaterial(0x1fa2ff, 1.05, 0.56)
      );
      borderGlow.renderOrder = 3;
      const outerWash = new THREE.Mesh(
        buildRibbonGeometry(outerPts, 5.2, true, 0.8),
        createNeonRibbonMaterial(0xa838ff, 0.95, 0.42)
      );
      outerWash.renderOrder = 3;
      const inkBorder = new THREE.Mesh(
        buildInkOutlineGeometry(boundary, 6.2, true, 3.0, 4.0, 0.9),
        createSumiInkMaterial(0.98, 0.65)
      );
      inkBorder.renderOrder = 14;
      this.borderGroup.add(borderGlow, outerWash, inkBorder);

      const capPts = createPolygonPts(6, 12);
      const stamp = getPolygonWashTexture('arena-beacon-hex', capPts, 0.32);
      for (const v of boundary) {
        const shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(stamp.size * 0.92, stamp.size * 0.92),
          createDropShadowMaterial(stamp.texture, 0.58)
        );
        shadow.position.set(v.x + 6, v.y - 8, 1.2);
        shadow.renderOrder = 5;

        const wash = new THREE.Mesh(
          new THREE.PlaneGeometry(stamp.size, stamp.size),
          createWatercolorWashMaterial(stamp.texture, colHex, undefined, undefined, 0.92)
        );
        wash.position.set(v.x + 2.4, v.y - 2.0, 4.0);
        wash.renderOrder = 10;

        const inkCap = new THREE.Mesh(
          buildInkOutlineGeometry(capPts, 3.4, true, 6.0, 2.0, 0.45),
          createSumiInkMaterial(0.97, 0.55)
        );
        inkCap.position.set(v.x, v.y, 0);
        inkCap.renderOrder = 15;

        const glow = createGlowSprite(colHex, 36, 0.22);
        glow.position.set(v.x, v.y, 3.0);
        glow.renderOrder = 8;
        this.borderGroup.add(shadow, glow, wash, inkCap);
      }
      return;
    }

    // Primary neon border ribbon rail + soft outer rail
    this.borderGroup.add(
      new THREE.Mesh(
        buildRibbonGeometry(boundary, 6.8, true, 2.0),
        createNeonRibbonMaterial(colHex, 1.32, 0.96)
      ),
      new THREE.Mesh(
        buildRibbonGeometry(outerPts, 3.6, true, 0.8),
        createNeonRibbonMaterial(colHex, 0.85, 0.44)
      )
    );

    // Volumetric standing energy skirt along arena perimeter walls
    const n = boundary.length;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const indices: number[] = [];
    const skirtH = 26;
    for (let i = 0; i <= n; i++) {
      const v = boundary[i % n]!;
      const pBase = i * 6;
      positions[pBase] = v.x;
      positions[pBase + 1] = v.y;
      positions[pBase + 2] = 0.5;
      positions[pBase + 3] = v.x;
      positions[pBase + 4] = v.y;
      positions[pBase + 5] = skirtH;
      const uvBase = i * 4;
      uvs[uvBase] = i / n;
      uvs[uvBase + 1] = 0;
      uvs[uvBase + 2] = i / n;
      uvs[uvBase + 3] = 1;
      if (i < n) {
        const idx0 = i * 2;
        indices.push(idx0, idx0 + 1, idx0 + 2, idx0 + 2, idx0 + 1, idx0 + 3);
      }
    }
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    skirtGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    skirtGeo.setIndex(indices);
    this.borderGroup.add(new THREE.Mesh(skirtGeo, createBorderSkirtMaterial(colHex)));

    // 3D Corner Beacon Pylons at each polygon vertex
    const beaconGeo = new THREE.CylinderGeometry(8, 11, 34, 6, 1);
    beaconGeo.rotateX(Math.PI / 2);
    const capPts = createPolygonPts(6, 10.5);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0x10182b,
      emissive: colHex,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.45,
    });
    for (const v of boundary) {
      const pylon = new THREE.Mesh(beaconGeo.clone(), beaconMat.clone());
      pylon.position.set(v.x, v.y, 17);
      const capRing = new THREE.Mesh(
        buildRibbonGeometry(capPts, 2.8, true, 35),
        createNeonRibbonMaterial(colHex, 1.35, 0.95)
      );
      capRing.position.set(v.x, v.y, 0);
      const glow = createGlowSprite(colHex, 46, 0.24);
      glow.position.set(v.x, v.y, 26);
      this.borderGroup.add(pylon, capRing, glow);
    }
    beaconGeo.dispose();
    beaconMat.dispose();
  }

  public setArtStyle(style: ArtStyle): void {
    if (this.artStyle === style) return;
    this.artStyle = style;
    const isWatercolor = style === 'WATERCOLOR_INK';
    this.scene.background = new THREE.Color(isWatercolor ? 0x0b0f1a : 0x04050c);
    this.impactPass.uniforms.uVignette!.value = isWatercolor ? 0.36 : 0.24;
    this.applyBloomParams();
    this.lastBoundaryKey = '';
    this.setArenaBoundary(this.lastBoundary, this.lastWaveNum);
  }

  private applyBloomParams(): void {
    const clamped = this.userBloomIntensity;
    this.bloomPass.enabled = clamped > 0.01;
    if (this.artStyle === 'WATERCOLOR_INK') {
      // Tight selective neon bloom (> 0.72 luminance threshold) so black ink outlines stay razor-sharp
      this.bloomPass.threshold = 0.72;
      this.bloomPass.radius = 0.2;
      this.bloomPass.strength = 0.4 * clamped;
    } else {
      this.bloomPass.threshold = 0.64;
      this.bloomPass.radius = 0.36;
      this.bloomPass.strength = 0.56 * clamped;
    }
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % SECTOR_BORDER_COLORS.length;
    if (idx !== this.currentThemeWave) {
      this.lastBoundaryKey = '';
    }
  }

  public setBloomIntensity(intensity: number): void {
    this.userBloomIntensity = Math.max(0, Math.min(1.5, intensity));
    this.applyBloomParams();
  }

  public setScreenShakeScale(scale: number): void {
    this.shakeScale = Math.max(0, Math.min(1.5, scale));
  }

  public setPixelRatioCap(cap: 1 | 2): void {
    this.pixelRatioCap = cap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  public triggerImpactPost(worldX: number, worldY: number, aberrationAmount: number, rippleAmount = 0): void {
    if (this.shakeScale <= 0.01) return;
    const scale = Math.max(0.35, this.shakeScale);
    this.aberration = Math.min(0.014, Math.max(this.aberration, aberrationAmount * scale));
    if (rippleAmount > 0) {
      this.hitVec.set(worldX, worldY, 0).project(this.camera);
      const ux = Math.max(0.05, Math.min(0.95, this.hitVec.x * 0.5 + 0.5));
      const uy = Math.max(0.05, Math.min(0.95, this.hitVec.y * 0.5 + 0.5));
      (this.impactPass.uniforms.uRippleCenter!.value as THREE.Vector2).set(ux, uy);
      this.rippleStrength = Math.min(0.026, Math.max(this.rippleStrength, rippleAmount * scale));
      this.rippleRadius = 0.02;
    }
  }

  private updateCameraFrustum(width: number, height: number): void {
    const aspect = Math.max(0.1, width / Math.max(1, height));
    const targetHalfW = 580;
    const targetHalfH = 400;
    const targetAspect = targetHalfW / targetHalfH;

    if (aspect >= targetAspect) {
      this.frustumHalfH = targetHalfH;
      this.frustumHalfW = targetHalfH * aspect;
    } else {
      this.frustumHalfW = targetHalfW;
      this.frustumHalfH = targetHalfW / aspect;
    }

    const fovRad = 2 * Math.atan(this.frustumHalfH / this.camDist);
    this.camera.fov = THREE.MathUtils.radToDeg(fovRad);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setCameraTarget(targetX: number, targetY: number, aimX: number, aimY: number, dt: number): void {
    const lookX = Math.max(-90, Math.min(90, (aimX - targetX) * 0.1));
    const lookY = Math.max(-90, Math.min(90, (aimY - targetY) * 0.1));
    const maxCamX = Math.max(0, ARENA_HALF_W - this.frustumHalfW * 0.55);
    const maxCamY = Math.max(0, ARENA_HALF_H - this.frustumHalfH * 0.55);
    const desiredX = Math.max(-maxCamX, Math.min(maxCamX, targetX + lookX));
    const desiredY = Math.max(-maxCamY, Math.min(maxCamY, targetY + lookY));
    const alpha = 1 - Math.exp(-7 * Math.min(dt, 0.05));
    this.camX += (desiredX - this.camX) * alpha;
    this.camY += (desiredY - this.camY) * alpha;
  }

  private applyCameraTransform(shakeX: number, shakeY: number): void {
    if (this.tiltEnabled) {
      const rad = THREE.MathUtils.degToRad(26);
      this.baseCamPos.set(
        this.camX,
        this.camY - Math.sin(rad) * this.camDist,
        Math.cos(rad) * this.camDist
      );
    } else {
      this.baseCamPos.set(this.camX, this.camY, this.camDist);
    }
    this.camera.position.set(this.baseCamPos.x + shakeX, this.baseCamPos.y + shakeY, this.baseCamPos.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camX + shakeX * 0.3, this.camY + shakeY * 0.3, 0);
  }

  public setTilt(enabled: boolean): void {
    this.tiltEnabled = enabled;
    this.applyCameraTransform(0, 0);
  }

  public isTiltEnabled(): boolean {
    return this.tiltEnabled;
  }

  public addScreenShake(intensity: number): void {
    if (this.shakeScale <= 0.01) return;
    const scaled = intensity * this.shakeScale;
    this.shakeIntensity = Math.min(24, Math.max(this.shakeIntensity, scaled));
  }

  public screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.ndcVec.set(nx, ny);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitVec)) {
      return { x: this.hitVec.x, y: this.hitVec.y };
    }
    return { x: 0, y: 0 };
  }

  public worldToScreen(x: number, y: number, z = 24): { x: number; y: number; visible: boolean } {
    this.hitVec.set(x, y, z).project(this.camera);
    if (this.hitVec.z > 1 || this.hitVec.z < -1) {
      return { x: 0, y: 0, visible: false };
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (this.hitVec.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-this.hitVec.y * 0.5 + 0.5) * rect.height,
      visible: true,
    };
  }

  public render(dt: number): void {
    let sx = 0;
    let sy = 0;
    if (this.shakeIntensity > 0.1) {
      sx = (Math.random() * 2 - 1) * this.shakeIntensity;
      sy = (Math.random() * 2 - 1) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.015, dt);
    } else {
      this.shakeIntensity = 0;
    }

    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    this.aberration *= Math.pow(0.001, safeDt);
    if (this.aberration < 0.00015) this.aberration = 0;
    this.rippleRadius += safeDt * 2.1;
    this.rippleStrength *= Math.pow(0.006, safeDt);
    if (this.rippleStrength < 0.0002) this.rippleStrength = 0;

    this.impactPass.uniforms.uAberration!.value = this.aberration;
    this.impactPass.uniforms.uRippleStrength!.value = this.rippleStrength;
    this.impactPass.uniforms.uRippleRadius!.value = this.rippleRadius;

    this.applyCameraTransform(sx, sy);
    this.composer.render();
  }

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.updateCameraFrustum(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  };

  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.clearBorderGroup();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
