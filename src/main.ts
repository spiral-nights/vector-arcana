import { SceneManager } from './render/SceneManager';
import { WarpingGrid } from './render/WarpingGrid';
import { EntityRenderer } from './render/EntityRenderer';
import { SpellVFX } from './render/SpellVFX';
import { GameSim } from './sim/GameSim';
import { BaseElement, CastMode, ControlPreset, FIXED_DT } from './sim/types';
import { HUD } from './ui/HUD';

const KEY_TO_ELEMENT: Record<string, BaseElement> = {
  KeyQ: 'FLUX',
  KeyW: 'NANO',
  KeyE: 'AEGIS',
  KeyR: 'CRYO',
  KeyA: 'VOLT',
  KeyS: 'VOID',
  KeyD: 'KINETIC',
  KeyF: 'THERMAL',
};

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const sceneManager = new SceneManager(appEl);
const warpingGrid = new WarpingGrid(sceneManager.scene);
const entityRenderer = new EntityRenderer(sceneManager.scene);
const spellVFX = new SpellVFX(sceneManager.scene);
const sim = new GameSim();

let preset: ControlPreset = 'CLASSIC';
let muted = false;
let hitStopTimer = 0;

const keysDown = new Set<string>();
let lmbDown = false;
let rmbDown = false;
let clientMouseX = window.innerWidth / 2;
let clientMouseY = window.innerHeight / 2;
let pendingQueue: BaseElement[] = [];
let pendingCast: CastMode | null = null;
let pendingDash = false;

const hud = new HUD(hudEl, {
  onToggleTilt: () => {
    const next = !sceneManager.isTiltEnabled();
    sceneManager.setTilt(next);
    hud.setTilt(next);
  },
  onToggleControls: () => {
    preset = preset === 'CLASSIC' ? 'ARROWS_LMB' : 'CLASSIC';
    hud.setPreset(preset);
  },
  onToggleMute: () => {
    muted = !muted;
    hud.setMuted(muted);
  },
  onTogglePause: () => {
    const snap = sim.getSnapshot();
    if (snap.phase === 'PLAYING') sim.setPhase('PAUSED');
    else if (snap.phase === 'PAUSED') sim.setPhase('PLAYING');
  },
  onStartGame: () => {
    sim.startNewRun();
  },
  onPickAugment: () => {},
});

const stopContextMenu = (e: Event): void => {
  e.preventDefault();
  e.stopPropagation();
};
window.addEventListener('contextmenu', stopContextMenu, { capture: true });
document.addEventListener('contextmenu', stopContextMenu, { capture: true });
sceneManager.renderer.domElement.addEventListener('contextmenu', stopContextMenu, { capture: true });
window.addEventListener('auxclick', (e) => {
  if (e.button === 1 || e.button === 2) e.preventDefault();
}, { capture: true });
window.addEventListener('mousemove', (e) => {
  clientMouseX = e.clientX;
  clientMouseY = e.clientY;
});

window.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    e.preventDefault();
    pendingCast = 'SELF';
    return;
  }
  if (e.button === 0) {
    lmbDown = true;
    if (preset === 'CLASSIC') {
      if (e.shiftKey) {
        pendingDash = true;
      }
    } else {
      pendingCast = 'FORWARD';
    }
  } else if (e.button === 2) {
    e.preventDefault();
    rmbDown = true;
    if (preset === 'CLASSIC') {
      pendingCast = e.shiftKey ? 'NOVA' : 'FORWARD';
    } else {
      pendingCast = 'NOVA';
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) lmbDown = false;
  if (e.button === 2) {
    e.preventDefault();
    rmbDown = false;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keysDown.add(e.code);

  const el = KEY_TO_ELEMENT[e.code];
  if (el) {
    pendingQueue.push(el);
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    pendingCast = e.shiftKey ? 'NOVA' : 'SELF';
  } else if (e.code === 'KeyC') {
    pendingCast = 'NOVA';
  } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (preset === 'ARROWS_LMB') {
      pendingDash = true;
    }
  } else if (e.code === 'Escape') {
    const snap = sim.getSnapshot();
    if (snap.phase === 'PLAYING') sim.setPhase('PAUSED');
    else if (snap.phase === 'PAUSED') sim.setPhase('PLAYING');
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

let lastTime = performance.now();
let accumulator = 0;
let hudTimer = 0;

function frame(now: number): void {
  const rawDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (hitStopTimer > 0) {
    hitStopTimer = Math.max(0, hitStopTimer - rawDt);
    sceneManager.render(rawDt);
    requestAnimationFrame(frame);
    return;
  }

  const aimWorld = sceneManager.screenToWorld(clientMouseX, clientMouseY);
  accumulator += rawDt;

  while (accumulator >= FIXED_DT) {
    const shiftHeld = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
    const moveX = (keysDown.has('ArrowRight') ? 1 : 0) - (keysDown.has('ArrowLeft') ? 1 : 0);
    const moveY = (keysDown.has('ArrowUp') ? 1 : 0) - (keysDown.has('ArrowDown') ? 1 : 0);
    const castHeld = preset === 'CLASSIC' ? rmbDown && !shiftHeld : lmbDown;

    sim.step({
      moveX,
      moveY,
      moveToCursor: preset === 'CLASSIC' && lmbDown && !shiftHeld,
      aimX: aimWorld.x,
      aimY: aimWorld.y,
      queuedElements: pendingQueue,
      castAction: pendingCast,
      castHeld,
      dashPressed: pendingDash,
    });
    pendingQueue = [];
    pendingCast = null;
    pendingDash = false;
    accumulator -= FIXED_DT;
  }

  for (const ev of sim.drainEvents()) {
    if (ev.type === 'grid_impulse') {
      warpingGrid.applyRadialImpulse(ev.x, ev.y, ev.strength, ev.radius);
    } else if (ev.type === 'grid_well') {
      warpingGrid.applyGravityWell(ev.x, ev.y, ev.strength, ev.radius);
    } else if (ev.type === 'screen_shake') {
      sceneManager.addScreenShake(ev.intensity);
    } else if (ev.type === 'hit_stop') {
      hitStopTimer = Math.max(hitStopTimer, ev.duration);
    } else if (ev.type === 'vfx_burst') {
      spellVFX.spawnBurst(ev.x, ev.y, ev.colorHex, ev.count);
    } else if (ev.type === 'vfx_ring') {
      spellVFX.spawnRing(ev.x, ev.y, ev.radius, ev.colorHex, ev.duration);
    } else if (ev.type === 'vfx_storm_strike') {
      spellVFX.spawnStormStrike(ev.x, ev.y, ev.colorHex, ev.secondaryColorHex, ev.radius);
    } else if (ev.type === 'vfx_lightning') {
      spellVFX.spawnLightning(ev.points, ev.colors);
    } else if (ev.type === 'vfx_spray') {
      spellVFX.spawnSpray(ev.x, ev.y, ev.angle, ev.spread, ev.range, ev.colors, ev.isNova);
    } else if (ev.type === 'vfx_shatter') {
      spellVFX.spawnBurst(ev.x, ev.y, ev.colorHex, 24, 1.4);
    }
  }

  warpingGrid.update(rawDt);
  const snapshot = sim.getSnapshot();
  const timeSec = now / 1000;
  entityRenderer.update(snapshot, aimWorld, timeSec);
  spellVFX.update(snapshot, rawDt, timeSec);

  hudTimer += rawDt;
  if (hudTimer >= 0.05) {
    hudTimer = 0;
    const shiftHeld = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
    hud.update(snapshot, [], preset === 'CLASSIC' && shiftHeld);
  }

  sceneManager.render(rawDt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
