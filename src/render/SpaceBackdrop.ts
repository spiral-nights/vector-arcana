import * as THREE from 'three';

const SECTOR_THEMES = [0x00d8ff, 0xff5522, 0x44f5ff, 0x39ff88, 0xb429ff] as const;

interface DeepMonolith {
  obj: THREE.LineSegments;
  baseX: number;
  baseY: number;
  rotSpeedX: number;
  rotSpeedY: number;
  rotSpeedZ: number;
}

function createStarSpriteTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class SpaceBackdrop {
  private readonly starGroup = new THREE.Group();
  private readonly subGridMat: THREE.LineBasicMaterial;
  private readonly monolithMats: THREE.LineBasicMaterial[] = [];
  private readonly monoliths: DeepMonolith[] = [];
  private currentThemeIdx = -1;

  constructor(scene: THREE.Scene) {
    const tex = createStarSpriteTexture();

    // Layer A: Deep parallax starfield in two depth strata
    const starPalette = [0xffffff, 0x70d8ff, 0x9ab8ff, 0x66ffe0, 0xc89bff];
    const starCount = 860;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 4600;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 3400;
      positions[i * 3 + 2] = -140 - Math.random() * 420;
      col.setHex(starPalette[i % starPalette.length]!);
      const bright = 0.4 + Math.random() * 0.6;
      colors[i * 3] = col.r * bright;
      colors[i * 3 + 1] = col.g * bright;
      colors[i * 3 + 2] = col.b * bright;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starPts = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 11,
        map: tex,
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    starPts.frustumCulled = false;
    this.starGroup.add(starPts);
    scene.add(this.starGroup);

    // Layer B: Sub-floor architectural circuit lattice at z = -54
    const subPts: number[] = [];
    const extentX = 1650;
    const extentY = 1200;
    const step = 220;
    for (let x = -extentX; x <= extentX; x += step) {
      subPts.push(x, -extentY, -54, x, extentY, -54);
    }
    for (let y = -extentY; y <= extentY; y += step) {
      subPts.push(-extentX, y, -54, extentX, y, -54);
    }
    // Diagonal cyber trusses every other cell
    for (let x = -extentX; x < extentX; x += step * 2) {
      for (let y = -extentY; y < extentY; y += step * 2) {
        subPts.push(x, y, -58, x + step, y + step, -58);
      }
    }
    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.Float32BufferAttribute(subPts, 3));
    this.subGridMat = new THREE.LineBasicMaterial({
      color: 0x00d8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const subGrid = new THREE.LineSegments(subGeo, this.subGridMat);
    subGrid.frustumCulled = false;
    scene.add(subGrid);

    // Layer C: Slowly rotating deep geometric monolith rings/polyhedra below floor
    const geos = [
      new THREE.WireframeGeometry(new THREE.OctahedronGeometry(95, 0)),
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(110, 0)),
      new THREE.WireframeGeometry(new THREE.TorusGeometry(130, 18, 6, 12)),
    ];
    for (let i = 0; i < 14; i++) {
      const geo = geos[i % geos.length]!;
      const mat = new THREE.LineBasicMaterial({
        color: 0x00d8ff,
        transparent: true,
        opacity: 0.15 + (i % 3) * 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(geo, mat);
      const bx = ((i % 5) - 2) * 520 + (Math.random() - 0.5) * 180;
      const by = (Math.floor(i / 5) - 1) * 480 + (Math.random() - 0.5) * 160;
      mesh.position.set(bx, by, -150 - (i % 4) * 55);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scene.add(mesh);
      this.monolithMats.push(mat);
      this.monoliths.push({
        obj: mesh,
        baseX: bx,
        baseY: by,
        rotSpeedX: (Math.random() - 0.5) * 0.16,
        rotSpeedY: (Math.random() - 0.5) * 0.16,
        rotSpeedZ: (Math.random() - 0.5) * 0.2,
      });
    }

    this.setSectorTheme(1);
  }

  public setSectorTheme(wave: number): void {
    const idx = Math.max(0, wave - 1) % SECTOR_THEMES.length;
    if (idx === this.currentThemeIdx) return;
    this.currentThemeIdx = idx;
    const col = SECTOR_THEMES[idx]!;
    this.subGridMat.color.setHex(col);
    for (const mat of this.monolithMats) {
      mat.color.setHex(col);
    }
  }

  public update(dt: number, timeSec: number, focusX: number, focusY: number): void {
    this.starGroup.position.set(-focusX * 0.14, -focusY * 0.14, 0);
    for (let i = 0; i < this.monoliths.length; i++) {
      const m = this.monoliths[i]!;
      m.obj.rotation.x += m.rotSpeedX * dt;
      m.obj.rotation.y += m.rotSpeedY * dt;
      m.obj.rotation.z += m.rotSpeedZ * dt;
      m.obj.position.x = m.baseX - focusX * 0.08 + Math.sin(timeSec * 0.25 + i) * 24;
      m.obj.position.y = m.baseY - focusY * 0.08 + Math.cos(timeSec * 0.22 + i) * 20;
    }
  }
}
