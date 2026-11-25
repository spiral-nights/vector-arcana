import { MusicPlayer } from './audio/MusicPlayer';
import { SynthAudio } from './audio/SynthAudio';
import { DEFAULT_SETTINGS, GameSettings, loadSettings, saveSettings } from './settings';
import { EntityRenderer } from './render/EntityRenderer';
import { MotionTrails } from './render/MotionTrails';
import { SceneManager } from './render/SceneManager';
import { SpaceBackdrop } from './render/SpaceBackdrop';
import { SpellVFX } from './render/SpellVFX';
import { WarpingGrid } from './render/WarpingGrid';
import { setWatercolorTime } from './render/WatercolorAssets';
import { GameSim } from './sim/GameSim';
import { getShipDef } from './sim/Ships';
import { BaseElement, CastMode, ELEMENT_META, FIXED_DT } from './sim/types';
import { HUD } from './ui/HUD';

const HIGHSCORE_KEY = 'vector-arcana-highscores-v1';

interface HighScoreEntry {
  score: number;
  wave: number;
}

function loadHighScores(): HighScoreEntry[] {
  try {
    const raw = window.localStorage.getItem(HIGHSCORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is HighScoreEntry => typeof x?.score === 'number' && typeof x?.wave === 'number')
      .slice(0, 5);
  } catch {
    return [];
  }
}

function recordHighScore(score: number, wave: number): HighScoreEntry[] {
  const next = [...loadHighScores(), { score: Math.round(score), wave }]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  try {
    window.localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota / privacy mode restrictions
  }
  return next;
}

const KEY_TO_ELEMENT: Record<string, BaseElement> = {
  KeyQ: 'FLUX',
  KeyW: 'NANO',
  KeyE: 'BARRIER',
  KeyR: 'CRYO',
  KeyA: 'VOLT',
  KeyS: 'VOID',
  KeyD: 'KINETIC',
  KeyF: 'THERMAL',
};

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const sceneManager = new SceneManager(appEl);
const spaceBackdrop = new SpaceBackdrop(sceneManager.scene);
const warpingGrid = new WarpingGrid(sceneManager.scene);
const entityRenderer = new EntityRenderer(sceneManager.scene);
const spellVFX = new SpellVFX(sceneManager.scene);
const motionTrails = new MotionTrails(sceneManager.scene);
const synthAudio = new SynthAudio();
const musicPlayer = new MusicPlayer();
const sim = new GameSim('TITLE');

let settings: GameSettings = loadSettings();
let hitStopTimer = 0;
let calloutCooldown = 0;
let highScores = loadHighScores();

const keysDown = new Set<string>();
let lmbDown = false;
let rmbDown = false;
let mmbDown = false;
let clientMouseX = window.innerWidth / 2;
let clientMouseY = window.innerHeight / 2;
let pendingQueue: BaseElement[] = [];
let pendingCast: CastMode | null = null;
let pendingDash = false;
let pendingMoveClick: { x: number; y: number } | null = null;

function clearHeldInputs(): void {
  keysDown.clear();
  lmbDown = false;
  rmbDown = false;
  mmbDown = false;
}

function syncShiftFromMouse(e: MouseEvent): void {
  if (!e.shiftKey) {
    keysDown.delete('ShiftLeft');
    keysDown.delete('ShiftRight');
  }
}

let hud: HUD;

function applyAllSettings(next: GameSettings): void {
  settings = { ...next };
  saveSettings(settings);
  synthAudio.setMuted(settings.muted);
  synthAudio.setVolumes(settings.masterVolume, settings.sfxVolume);
  musicPlayer.setMuted(settings.muted);
  musicPlayer.setVolumes(settings.masterVolume, settings.musicVolume);
  sceneManager.setTilt(settings.cameraTilt);
  sceneManager.setArtStyle(settings.artStyle);
  sceneManager.setBloomIntensity(settings.bloomIntensity);
  sceneManager.setScreenShakeScale(settings.screenShake);
  sceneManager.setPixelRatioCap(settings.pixelRatioCap);
  spaceBackdrop.setArtStyle(settings.artStyle);
  warpingGrid.setArtStyle(settings.artStyle);
  warpingGrid.setWarpEnabled(settings.gridWarp);
  entityRenderer.setArtStyle(settings.artStyle);
  spellVFX.setArtStyle(settings.artStyle);
  spellVFX.setParticleQuality(settings.particleQuality);
  motionTrails.setArtStyle(settings.artStyle);
  motionTrails.setParticleQuality(settings.particleQuality);
  sim.setDifficulty(settings.difficulty);
  sim.setShip(settings.selectedShip);
  hud?.applySettings(settings);
}

hud = new HUD(hudEl, {
  onToggleTilt: () => {
    applyAllSettings({ ...settings, cameraTilt: !settings.cameraTilt });
  },
  onToggleControls: () => {
    applyAllSettings({
      ...settings,
      controlPreset: settings.controlPreset === 'CLASSIC' ? 'ARROWS_LMB' : 'CLASSIC',
    });
  },
  onToggleMute: () => {
    applyAllSettings({ ...settings, muted: !settings.muted });
  },
  onTogglePause: () => {
    const snap = sim.getSnapshot();
    if (snap.phase === 'PLAYING') sim.setPhase('PAUSED');
    else if (snap.phase === 'PAUSED') sim.setPhase('PLAYING');
  },
  onStartGame: () => {
    synthAudio.unlock();
    musicPlayer.unlock();
    clearHeldInputs();
    sim.startNewRun();
    musicPlayer.restart();
  },
  onPickAugment: (index: number) => {
    synthAudio.unlock();
    musicPlayer.unlock();
    clearHeldInputs();
    sim.pickAugment(index);
  },
  onSettingsChange: (patch: Partial<GameSettings>) => {
    applyAllSettings({ ...settings, ...patch });
  },
  onResetSettings: () => {
    applyAllSettings({ ...DEFAULT_SETTINGS });
  },
  onRestartRun: () => {
    synthAudio.unlock();
    musicPlayer.unlock();
    clearHeldInputs();
    sim.startNewRun();
    musicPlayer.restart();
  },
});

applyAllSettings(settings);

const stopContextMenu = (e: Event): void => {
  e.preventDefault();
  e.stopPropagation();
  clearHeldInputs();
};
window.addEventListener('contextmenu', stopContextMenu, { capture: true });
document.addEventListener('contextmenu', stopContextMenu, { capture: true });
sceneManager.renderer.domElement.addEventListener('contextmenu', stopContextMenu, { capture: true });
window.addEventListener('blur', clearHeldInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearHeldInputs();
});
window.addEventListener('auxclick', (e) => {
  if (e.button === 1 || e.button === 2) e.preventDefault();
}, { capture: true });

window.addEventListener('mousemove', (e) => {
  syncShiftFromMouse(e);
  clientMouseX = e.clientX;
  clientMouseY = e.clientY;
});

window.addEventListener('mousedown', (e) => {
  synthAudio.unlock();
  musicPlayer.unlock();
  syncShiftFromMouse(e);
  if ((e.target as HTMLElement | null)?.closest('#hud') || sim.getSnapshot().phase !== 'PLAYING') {
    return;
  }
  if (e.button === 1) {
    e.preventDefault();
    mmbDown = true;
    pendingCast = 'SELF';
    return;
  }
  if (e.button === 0) {
    lmbDown = true;
    if (settings.controlPreset === 'CLASSIC') {
      if (e.shiftKey) {
        pendingDash = true;
      } else {
        pendingMoveClick = sceneManager.screenToWorld(e.clientX, e.clientY);
      }
    } else {
      pendingCast = 'FORWARD';
    }
  } else if (e.button === 2) {
    e.preventDefault();
    rmbDown = true;
    if (settings.controlPreset === 'CLASSIC') {
      pendingCast = e.shiftKey ? 'NOVA' : 'FORWARD';
    } else {
      pendingCast = 'NOVA';
    }
  }
});

window.addEventListener('mouseup', (e) => {
  syncShiftFromMouse(e);
  if (e.button === 0) lmbDown = false;
  if (e.button === 1) mmbDown = false;
  if (e.button === 2) {
    e.preventDefault();
    rmbDown = false;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  synthAudio.unlock();
  musicPlayer.unlock();
  keysDown.add(e.code);

  const curPhase = sim.getSnapshot().phase;
  if (curPhase === 'AUGMENT_CHOICE') {
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      const idx = e.code === 'Digit1' ? 0 : e.code === 'Digit2' ? 1 : 2;
      clearHeldInputs();
      sim.pickAugment(idx);
    }
    return;
  }

  if (e.code === 'Escape') {
    if (curPhase === 'PLAYING') sim.setPhase('PAUSED');
    else if (curPhase === 'PAUSED') sim.setPhase('PLAYING');
    return;
  }

  if (e.code === 'Enter') {
    if (curPhase === 'TITLE' || curPhase === 'GAME_OVER') {
      clearHeldInputs();
      sim.startNewRun();
      musicPlayer.restart();
    }
    return;
  }

  if (curPhase !== 'PLAYING') return;

  const el = KEY_TO_ELEMENT[e.code];
  if (el) {
    pendingQueue.push(el);
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    pendingCast = 'NOVA';
  } else if (e.code === 'KeyC') {
    pendingCast = 'SELF';
  } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (settings.controlPreset === 'ARROWS_LMB') {
      pendingDash = true;
    }
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

let lastTime = performance.now();
let accumulator = 0;
let hudTimer = 0;

const COMIC_KILL_WORDS = ['BAM!', 'BOM!', 'POP!'] as const;

function pickCalloutVariant(elements: readonly string[]): 'FIRE' | 'CYAN' | 'MAGENTA' | 'LIME' {
  if (elements.includes('NANO')) return 'LIME';
  if (elements.includes('CRYO') || elements.includes('CRYSTAL') || elements.includes('FLUX')) return 'CYAN';
  if (elements.includes('VOID') || elements.includes('PLASMA')) return 'MAGENTA';
  return 'FIRE';
}

function frame(now: number): void {
  const rawDt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  calloutCooldown = Math.max(0, calloutCooldown - rawDt);
  const timeSec = now / 1000;
  if (settings.artStyle === 'WATERCOLOR_INK') {
    setWatercolorTime(timeSec);
  }

  if (hitStopTimer > 0) {
    hitStopTimer = Math.max(0, hitStopTimer - rawDt);
    musicPlayer.update(rawDt);
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
    const castHeld = settings.controlPreset === 'CLASSIC' ? rmbDown && !shiftHeld : lmbDown;
    const selfHeld = mmbDown || keysDown.has('KeyC');
    const moveToCursor = settings.controlPreset === 'CLASSIC' && lmbDown;

    sim.step({
      moveX,
      moveY,
      moveToCursor,
      moveClickTarget: moveToCursor && !pendingDash ? aimWorld : pendingMoveClick,
      aimX: aimWorld.x,
      aimY: aimWorld.y,
      queuedElements: pendingQueue,
      castAction: pendingCast,
      castHeld,
      selfHeld,
      dashPressed: pendingDash,
    });
    pendingQueue = [];
    pendingCast = null;
    pendingDash = false;
    pendingMoveClick = null;
    accumulator -= FIXED_DT;
  }

  for (const ev of sim.drainEvents()) {
    if (ev.type === 'grid_impulse') {
      warpingGrid.applyRadialImpulse(ev.x, ev.y, ev.strength, ev.radius, ev.colorHex);
    } else if (ev.type === 'grid_well') {
      warpingGrid.applyGravityWell(ev.x, ev.y, ev.strength, ev.radius, ev.colorHex);
    } else if (ev.type === 'screen_shake') {
      sceneManager.addScreenShake(ev.intensity);
    } else if (ev.type === 'hit_stop') {
      hitStopTimer = Math.max(hitStopTimer, ev.duration);
    } else if (ev.type === 'vfx_burst') {
      spellVFX.spawnBurst(ev.x, ev.y, ev.colorHex, ev.count);
    } else if (ev.type === 'vfx_shards') {
      spellVFX.spawnShards(ev.x, ev.y, ev.colors, ev.count, ev.speedScale);
    } else if (ev.type === 'vfx_ring') {
      spellVFX.spawnRing(ev.x, ev.y, ev.radius, ev.colorHex, ev.duration);
    } else if (ev.type === 'vfx_storm_strike') {
      spellVFX.spawnStormStrike(ev.x, ev.y, ev.colorHex, ev.secondaryColorHex, ev.radius);
    } else if (ev.type === 'vfx_lightning') {
      spellVFX.spawnLightning(ev.points, ev.colors);
    } else if (ev.type === 'vfx_spray') {
      spellVFX.spawnSpray(ev.x, ev.y, ev.angle, ev.spread, ev.range, ev.colors, ev.isNova, ev.elements);
    } else if (ev.type === 'vfx_element_explosion') {
      spellVFX.spawnElementExplosion(ev.x, ev.y, ev.radius, ev.elements, ev.colors, ev.power);
      warpingGrid.stampColorSplash(ev.x, ev.y, ev.radius, ev.colors[0] ?? 0x00f5ff, 0.95);
      if (settings.artStyle === 'WATERCOLOR_INK' && (ev.power >= 1.35 || calloutCooldown <= 0)) {
        const pt = sceneManager.worldToScreen(ev.x, ev.y, 24);
        if (pt.visible) {
          const word = ev.elements.includes('VOLT')
            ? 'ZAP!'
            : ev.elements.includes('FLUX')
            ? 'SPLASH!'
            : COMIC_KILL_WORDS[Math.floor(Math.random() * COMIC_KILL_WORDS.length)]!;
          hud.spawnComicCallout(pt.x, pt.y - 12, word, pickCalloutVariant(ev.elements));
          calloutCooldown = 0.14;
        }
      }
    } else if (ev.type === 'vfx_enemy_death') {
      spellVFX.spawnEnemyDeath(
        ev.x,
        ev.y,
        ev.radius,
        ev.colorHex,
        ev.secondaryColorHex,
        ev.isBoss,
        ev.statuses
      );
      sceneManager.addScreenShake(ev.isBoss ? 12 : 3.5);
      sceneManager.triggerImpactPost(ev.x, ev.y, ev.isBoss ? 0.011 : 0.0025, ev.isBoss ? 0.024 : 0);
      warpingGrid.stampColorSplash(ev.x, ev.y, ev.radius * 3.2, ev.colorHex, ev.isBoss ? 1.0 : 0.65);
      if (settings.artStyle === 'WATERCOLOR_INK' && (ev.isBoss || calloutCooldown <= 0)) {
        const pt = sceneManager.worldToScreen(ev.x, ev.y, 24);
        if (pt.visible) {
          const word = ev.isBoss ? 'BOOM!' : COMIC_KILL_WORDS[Math.floor(Math.random() * COMIC_KILL_WORDS.length)]!;
          const variant = ev.isBoss ? 'FIRE' : ev.statuses.includes('PRIMED') ? 'CYAN' : 'FIRE';
          hud.spawnComicCallout(pt.x, pt.y - 16, word, variant);
          calloutCooldown = ev.isBoss ? 0.05 : 0.14;
        }
      }
    } else if (ev.type === 'damage_number') {
      if (settings.damageNumbers) {
        const pt = sceneManager.worldToScreen(ev.x, ev.y, 28);
        if (pt.visible) {
          hud.spawnFloatingText(pt.x, pt.y, ev.text, ev.colorHex, ev.big);
        }
      }
    } else if (ev.type === 'vfx_shatter') {
      spellVFX.spawnBurst(ev.x, ev.y, ev.colorHex, 24, 1.4);
      spellVFX.spawnFloorDecal(ev.x, ev.y, 64, 0x00f5ff, 4.5);
      warpingGrid.stampColorSplash(ev.x, ev.y, 130, 0x00f5ff, 0.9);
      sceneManager.triggerImpactPost(ev.x, ev.y, 0.0055, 0.015);
      if (settings.artStyle === 'WATERCOLOR_INK') {
        const pt = sceneManager.worldToScreen(ev.x, ev.y, 24);
        if (pt.visible) {
          hud.spawnComicCallout(pt.x, pt.y - 14, 'CRACK!', 'CYAN');
        }
      }
    } else if (ev.type === 'beam_clash') {
      spellVFX.spawnBurst(ev.x, ev.y, ev.colorHex, 8, 1.1);
      spellVFX.spawnShards(ev.x, ev.y, [0x00f5ff, 0xb429ff], 3, 0.9);
      sceneManager.addScreenShake(2.5);
      sceneManager.triggerImpactPost(ev.x, ev.y, 0.004, 0);
      if (settings.artStyle === 'WATERCOLOR_INK' && calloutCooldown <= 0) {
        const pt = sceneManager.worldToScreen(ev.x, ev.y, 20);
        if (pt.visible) {
          hud.spawnComicCallout(pt.x, pt.y - 10, 'ZAP!', 'MAGENTA');
          calloutCooldown = 0.18;
        }
      }
    } else if (ev.type === 'wave_start') {
      hud.showWaveBanner(ev.wave, ev.isBoss);
    } else if (ev.type === 'gate_open') {
      hud.showGateOpenBanner();
    } else if (ev.type === 'sfx') {
      synthAudio.play(ev.sound, ev.colorHex, ev.elements);
    } else if (ev.type === 'player_hit') {
      hud.triggerDamageFlash(ev.hpRatio, ev.absorbedByArmor);
      sceneManager.triggerImpactPost(ev.x, ev.y, 0.011, 0.022);
      warpingGrid.stampColorSplash(ev.x, ev.y, 175, ev.absorbedByArmor ? 0xffaa44 : 0xff1e2d, 1.0);
    } else if (ev.type === 'game_over') {
      highScores = recordHighScore(ev.score, ev.wave);
    }
  }

  warpingGrid.update(rawDt);
  const snapshot = sim.getSnapshot();
  musicPlayer.setPhase(snapshot.phase);
  musicPlayer.update(rawDt);
  sceneManager.setArenaBoundary(snapshot.arenaBoundary, snapshot.wave);
  warpingGrid.setArenaBoundary(snapshot.arenaBoundary);
  warpingGrid.setSectorTheme(snapshot.wave);
  spaceBackdrop.setSectorTheme(snapshot.wave);
  spaceBackdrop.update(rawDt, timeSec, snapshot.player.x, snapshot.player.y);
  sceneManager.setCameraTarget(snapshot.player.x, snapshot.player.y, aimWorld.x, aimWorld.y, rawDt);
  if (snapshot.player.moving || snapshot.player.dashTimer > 0) {
    const thrustColor = snapshot.player.queue[0]
      ? ELEMENT_META[snapshot.player.queue[0]].colorHex
      : getShipDef(snapshot.shipId).colorHex;
    spellVFX.spawnThruster(snapshot.player.x, snapshot.player.y, snapshot.player.aimAngle, thrustColor);
  }
  entityRenderer.update(snapshot, aimWorld, timeSec);
  motionTrails.update(snapshot, rawDt);
  spellVFX.update(snapshot, rawDt, timeSec);

  hudTimer += rawDt;
  if (hudTimer >= 0.05) {
    hudTimer = 0;
    const shiftHeld = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
    hud.update(snapshot, highScores, settings.controlPreset === 'CLASSIC' && shiftHeld);
  }

  sceneManager.render(rawDt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
