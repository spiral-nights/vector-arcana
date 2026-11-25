import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ARENA_HALF_H, ARENA_HALF_W } from '../sim/types';

const SECTOR_BORDER_COLORS = [0x00d8ff, 0xff5522, 0x44f5ff, 0x39ff88, 0xb429ff] as const;

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly ndcVec = new THREE.Vector2();
  private readonly hitVec = new THREE.Vector3();

  private borderMat!: THREE.LineBasicMaterial;
  private outerBorderMat!: THREE.LineBasicMaterial;
  private currentThemeWave = -1;

  private tiltEnabled = true;
  private shakeIntensity = 0;
  private camX = 0;
  private camY = 0;
  private readonly camDist = 1160;
  private baseCamPos = new THREE.Vector3(0, 0, 1160);
  private frustumHalfW = 580;
  private frustumHalfH = 400;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(38, Math.max(0.1, width / Math.max(1, height)), 50, 4000);
    this.updateCameraFrustum(width, height);
    this.applyCameraTransform(0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.56, 0.36, 0.64);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // 3D Lighting for solid opaque hulls, pillars, and arena blocks
    const hemi = new THREE.HemisphereLight(0xaaccff, 0x161b2e, 1.15);
    this.scene.add(hemi);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(380, -450, 720);
    this.scene.add(dirLight);

    this.createArenaBorder();
    this.setSectorTheme(1);
    window.addEventListener('resize', this.handleResize);
  }

  private createArenaBorder(): void {
    const pts = [
      new THREE.Vector3(-ARENA_HALF_W, -ARENA_HALF_H, 0.5),
      new THREE.Vector3(ARENA_HALF_W, -ARENA_HALF_H, 0.5),
      new THREE.Vector3(ARENA_HALF_W, ARENA_HALF_H, 0.5),
      new THREE.Vector3(-ARENA_HALF_W, ARENA_HALF_H, 0.5),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.borderMat = new THREE.LineBasicMaterial({ color: 0x00d8ff, transparent: true, opacity: 0.82 });
    const loop = new THREE.LineLoop(geo, this.borderMat);
    this.scene.add(loop);

    const pad = 12;
    const outerPts = [
      new THREE.Vector3(-ARENA_HALF_W - pad, -ARENA_HALF_H - pad, 0),
      new THREE.Vector3(ARENA_HALF_W + pad, -ARENA_HALF_H - pad, 0),
      new THREE.Vector3(ARENA_HALF_W + pad, ARENA_HALF_H + pad, 0),
      new THREE.Vector3(-ARENA_HALF_W - pad, ARENA_HALF_H + pad, 0),
    ];
    const outerGeo = new THREE.BufferGeometry().setFromPoints(outerPts);
    this.outerBorderMat = new THREE.LineBasicMaterial({ color: 0x1a3366, transparent: true, opacity: 0.55 });
    this.scene.add(new THREE.LineLoop(outerGeo, this.outerBorderMat));
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % SECTOR_BORDER_COLORS.length;
    if (idx === this.currentThemeWave) return;
    this.currentThemeWave = idx;
    const col = SECTOR_BORDER_COLORS[idx]!;
    this.borderMat.color.setHex(col);
    this.outerBorderMat.color.setHex(col).multiplyScalar(0.38);
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
    this.shakeIntensity = Math.min(24, Math.max(this.shakeIntensity, intensity));
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
    this.applyCameraTransform(sx, sy);
    this.composer.render();
  }

  private handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.updateCameraFrustum(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  };

  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
