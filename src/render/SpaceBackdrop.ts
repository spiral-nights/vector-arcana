import * as THREE from 'three';
import { ArtStyle } from '../settings';
import { createPaperSubstrateMaterial, getWatercolorAssets } from './WatercolorAssets';

const SECTOR_STAR_TINTS = [0x6fd8ff, 0xffaa66, 0x70f8ff, 0x6bffb8, 0xc878ff] as const;

function createStarSpriteTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.62)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class SpaceBackdrop {
  private readonly scene: THREE.Scene;
  private readonly starGroup = new THREE.Group();
  private readonly tintedMat: THREE.PointsMaterial;
  private currentThemeIdx = -1;
  private artStyle: ArtStyle = 'VECTOR_NEON';
  private paperMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const tex = createStarSpriteTexture();

    // Subtle deep white starfield well below the arena plane
    const baseCount = 480;
    const basePos = new Float32Array(baseCount * 3);
    const baseCol = new Float32Array(baseCount * 3);
    for (let i = 0; i < baseCount; i++) {
      basePos[i * 3] = (Math.random() - 0.5) * 4600;
      basePos[i * 3 + 1] = (Math.random() - 0.5) * 3400;
      basePos[i * 3 + 2] = -260 - Math.random() * 420;
      const b = 0.32 + Math.random() * 0.45;
      baseCol[i * 3] = b * 0.85;
      baseCol[i * 3 + 1] = b * 0.92;
      baseCol[i * 3 + 2] = b;
    }
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
    baseGeo.setAttribute('color', new THREE.BufferAttribute(baseCol, 3));
    const basePts = new THREE.Points(
      baseGeo,
      new THREE.PointsMaterial({
        size: 7.5,
        map: tex,
        vertexColors: true,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    basePts.frustumCulled = false;

    // Sparse sector-tinted distant stars for calm atmosphere without clutter
    const tintCount = 170;
    const tintPos = new Float32Array(tintCount * 3);
    for (let i = 0; i < tintCount; i++) {
      tintPos[i * 3] = (Math.random() - 0.5) * 4400;
      tintPos[i * 3 + 1] = (Math.random() - 0.5) * 3200;
      tintPos[i * 3 + 2] = -280 - Math.random() * 380;
    }
    const tintGeo = new THREE.BufferGeometry();
    tintGeo.setAttribute('position', new THREE.BufferAttribute(tintPos, 3));
    this.tintedMat = new THREE.PointsMaterial({
      size: 9.0,
      map: tex,
      color: SECTOR_STAR_TINTS[0],
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tintPts = new THREE.Points(tintGeo, this.tintedMat);
    tintPts.frustumCulled = false;

    this.starGroup.add(basePts, tintPts);
    scene.add(this.starGroup);
    this.setSectorTheme(1);
  }

  public setArtStyle(style: ArtStyle): void {
    if (this.artStyle === style) return;
    this.artStyle = style;
    const isWatercolor = style === 'WATERCOLOR_INK';
    this.starGroup.visible = !isWatercolor;
    if (isWatercolor && !this.paperMesh) {
      const assets = getWatercolorAssets();
      const geo = new THREE.PlaneGeometry(4600, 3600);
      const mat = createPaperSubstrateMaterial(assets.paperTileTex, assets.paperCloudTex);
      this.paperMesh = new THREE.Mesh(geo, mat);
      this.paperMesh.position.set(0, 0, -18);
      this.paperMesh.renderOrder = -10;
      this.paperMesh.frustumCulled = false;
      this.scene.add(this.paperMesh);
    }
    if (this.paperMesh) {
      this.paperMesh.visible = isWatercolor;
    }
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % SECTOR_STAR_TINTS.length;
    if (idx === this.currentThemeIdx) return;
    this.currentThemeIdx = idx;
    this.tintedMat.color.setHex(SECTOR_STAR_TINTS[idx]!);
  }

  public update(_dt: number, _timeSec: number, focusX: number, focusY: number): void {
    this.starGroup.position.set(-focusX * 0.08, -focusY * 0.08, 0);
  }
}
