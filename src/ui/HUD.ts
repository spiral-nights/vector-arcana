import { GameSettings, ParticleQuality } from '../settings';
import { getAugmentDef } from '../sim/Augments';
import { SHIP_CATALOG } from '../sim/Ships';
import { formatSpellPreview } from '../sim/SpellResolver';
import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  AugmentId,
  BASE_ELEMENTS,
  ControlPreset,
  DifficultyId,
  ELEMENT_META,
  QueueElement,
  ShipId,
  SimSnapshot,
} from '../sim/types';

export interface HUDCallbacks {
  onToggleTilt: () => void;
  onToggleControls: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onStartGame: () => void;
  onPickAugment: (index: number) => void;
  onSettingsChange: (patch: Partial<GameSettings>) => void;
  onResetSettings: () => void;
  onRestartRun: () => void;
}

function getElementSvg(id: QueueElement, color: string): string {
  switch (id) {
    case 'FLUX':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8">
        <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity="0.8"/><circle cx="12" cy="12" r="10" opacity="0.45"/>
      </svg>`;
    case 'NANO':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="square">
        <line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>
      </svg>`;
    case 'BARRIER':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
        <polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8"/>
      </svg>`;
    case 'CRYO':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8">
        <polygon points="12,2 20,7 20,17 12,22 4,17 4,7"/>
        <line x1="12" y1="2" x2="12" y2="22" opacity="0.65"/>
        <line x1="4" y1="7" x2="20" y2="17" opacity="0.65"/>
        <line x1="20" y1="7" x2="4" y2="17" opacity="0.65"/>
      </svg>`;
    case 'VOLT':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round">
        <polyline points="14,2 7,12 13,12 10,22"/>
      </svg>`;
    case 'VOID':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round">
        <circle cx="12" cy="12" r="8.5" fill="#07050a" stroke="${color}" stroke-width="1.3"/>
        <path d="M12 12a2 2 0 1 0 2-2 4 4 0 1 0-4 4 6 6 0 1 0 6-6 8 8 0 1 0-8 8"/>
      </svg>`;
    case 'KINETIC':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8">
        <rect x="4" y="7" width="11" height="11"/><rect x="9" y="3" width="11" height="11" opacity="0.7"/>
        <line x1="4" y1="7" x2="9" y2="3"/><line x1="15" y1="7" x2="20" y2="3"/><line x1="15" y1="18" x2="20" y2="14"/>
      </svg>`;
    case 'THERMAL':
      return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linejoin="round">
        <polygon points="12,3 21,20 3,20"/>
      </svg>`;
    default:
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>`;
  }
}

function renderShipCardsHtml(selectedShip: ShipId): string {
  return SHIP_CATALOG.map((ship) => {
    const sel = ship.id === selectedShip;
    return `
      <div class="ship-card${sel ? ' selected' : ''}" data-ship-id="${ship.id}"
           style="border-color:${sel ? ship.color : 'rgba(255,255,255,0.16)'};box-shadow:${sel ? `0 0 18px ${ship.color}44` : 'none'}">
        <span class="ship-role" style="color:${ship.color}">${ship.role}</span>
        <span class="ship-name">${ship.name}</span>
        <span class="ship-desc">${ship.description}</span>
      </div>`;
  }).join('');
}

export class HUD {
  private readonly root: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly hullFill: HTMLElement;
  private readonly hullText: HTMLElement;
  private readonly overdriveFill: HTMLElement;
  private readonly bossWrap: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly waveBanner: HTMLElement;
  private readonly combatTextLayer: HTMLElement;
  private readonly damageVignette: HTMLElement;
  private readonly statsPanel: HTMLElement;
  private damageFlashTimer: number | null = null;
  private hitJoltTimer: number | null = null;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D | null;
  private bannerTimer: number | null = null;
  private readonly queueEl: HTMLElement;
  private readonly channelWrap: HTMLElement;
  private readonly channelLabel: HTMLElement;
  private readonly channelFill: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly slotEls = new Map<QueueElement, HTMLElement>();
  private readonly tiltBtn: HTMLButtonElement;
  private readonly ctrlBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly augmentsStrip: HTMLElement;

  private readonly startModal: HTMLElement;
  private readonly titleShipGrid: HTMLElement;
  private readonly pauseModal: HTMLElement;
  private readonly pauseShipGrid: HTMLElement;
  private readonly augmentModal: HTMLElement;
  private readonly augmentGrid: HTMLElement;
  private readonly gameOverModal: HTMLElement;
  private readonly gameOverSub: HTMLElement;
  private readonly highscoresEl: HTMLElement;

  private readonly masterVolSlider: HTMLInputElement;
  private readonly musicVolSlider: HTMLInputElement;
  private readonly sfxVolSlider: HTMLInputElement;
  private readonly bloomSlider: HTMLInputElement;
  private readonly masterVolVal: HTMLElement;
  private readonly musicVolVal: HTMLElement;
  private readonly sfxVolVal: HTMLElement;
  private readonly bloomVal: HTMLElement;
  private readonly muteSettingBtn: HTMLButtonElement;
  private readonly dmgNumsBtn: HTMLButtonElement;
  private readonly gridWarpBtn: HTMLButtonElement;
  private readonly camTiltBtn: HTMLButtonElement;

  private lastAugmentKey = '';
  private lastActiveAugKey = '';

  constructor(container: HTMLElement, callbacks: HUDCallbacks) {
    this.root = container;
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-top-left">
          <div class="hud-panel hud-stats">
            <div class="stat-block">
              <span class="stat-label">Sector</span>
              <span class="stat-value" id="hud-wave">1</span>
            </div>
            <div class="stat-block">
              <span class="stat-label">Score</span>
              <span class="stat-value" id="hud-score">0</span>
            </div>
            <div class="stat-block">
              <span class="stat-label">Mult</span>
              <span class="stat-value stat-mult" id="hud-mult">x1</span>
            </div>
            <div class="bars-stack">
              <div class="bar-row">
                <div class="bar-header"><span>HULL</span><span id="hud-hull-txt">100/100</span></div>
                <div class="bar-track"><div class="bar-fill hull" id="hud-hull-fill" style="width:100%"></div></div>
              </div>
              <div class="bar-row">
                <div class="bar-header"><span>OVERDRIVE</span></div>
                <div class="bar-track"><div class="bar-fill overdrive" id="hud-od-fill" style="width:0%"></div></div>
              </div>
            </div>
          </div>
          <div class="augments-strip" id="hud-augments"></div>
        </div>
        <div class="hud-controls">
          <button class="hud-btn active" id="btn-tilt">TILT: 26°</button>
          <button class="hud-btn" id="btn-ctrl">CLASSIC</button>
          <button class="hud-btn" id="btn-mute">AUDIO: ON</button>
          <button class="hud-btn" id="btn-pause">PAUSE</button>
        </div>
      </div>

      <div class="damage-vignette" id="damage-vignette"></div>
      <div class="combat-text-layer" id="combat-text-layer"></div>

      <div class="boss-bar-wrap" id="boss-wrap">
        <div class="boss-label">SECTOR WARDEN</div>
        <div class="boss-track"><div class="boss-fill" id="boss-fill" style="width:100%"></div></div>
      </div>

      <div id="wave-banner" style="position:fixed;top:24%;left:50%;transform:translateX(-50%);font-size:28px;font-weight:800;letter-spacing:0.2em;color:#00f5ff;text-shadow:0 0 18px rgba(0,245,255,0.7);opacity:0;transition:opacity 0.25s;pointer-events:none;"></div>

      <div class="hud-bottom">
        <div class="channel-wrap" id="hud-channel-wrap" style="display:none;width:240px;">
          <div class="bar-header"><span id="hud-channel-label">CHANNELING</span></div>
          <div class="bar-track"><div class="bar-fill" id="hud-channel-fill" style="width:100%;background:#00f5ff;"></div></div>
        </div>
        <div class="queue-preview" id="hud-queue">QUEUE: EMPTY</div>
        <div class="hotbar" id="hud-hotbar"></div>
        <div class="controls-hint" id="hud-hint"></div>
      </div>

      <div class="minimap-panel">
        <span class="minimap-label">SECTOR RADAR</span>
        <canvas id="hud-minimap" width="196" height="134"></canvas>
      </div>

      <div class="modal-backdrop" id="modal-start">
        <div class="modal-card wide">
          <div class="modal-title">Vector Arcana</div>
          <div class="modal-sub">
            Queue up to 3 elements with <strong>Q W E R</strong> / <strong>A S D F</strong>.<br/>
            Hold <strong>LMB</strong> or <strong>Arrows</strong> to move · <strong>RMB</strong> Forward Cast · <strong>Space</strong> / <strong>Shift+RMB</strong> Nova · <strong>MMB/C</strong> Self · <strong>Shift+LMB</strong> Phase Dash.
          </div>
          <div class="hangar-label">Select Construct Vessel</div>
          <div class="ship-grid" id="title-ship-grid"></div>
          <button class="primary-btn" id="btn-start">Launch Construct</button>
        </div>
      </div>

      <div class="modal-backdrop" id="modal-pause">
        <div class="modal-card wide">
          <div class="modal-title">System Paused · Settings</div>
          <div class="settings-grid">
            <div class="settings-section">
              <div class="settings-heading">Audio</div>
              <div class="setting-row">
                <div class="setting-label"><span>Master Volume</span><span class="setting-val" id="val-master-vol">85%</span></div>
                <input class="setting-slider" id="set-master-vol" type="range" min="0" max="100" value="85" />
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>Music Volume</span><span class="setting-val" id="val-music-vol">65%</span></div>
                <input class="setting-slider" id="set-music-vol" type="range" min="0" max="100" value="65" />
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>SFX Volume</span><span class="setting-val" id="val-sfx-vol">85%</span></div>
                <input class="setting-slider" id="set-sfx-vol" type="range" min="0" max="100" value="85" />
              </div>
              <div class="setting-row inline">
                <span class="setting-label">Audio Output</span>
                <button class="seg-btn active" id="set-mute">ENABLED</button>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-heading">Gameplay</div>
              <div class="setting-row">
                <div class="setting-label"><span>Difficulty</span></div>
                <div class="seg-group">
                  <button class="seg-btn" data-diff="RECRUIT">Recruit</button>
                  <button class="seg-btn active" data-diff="VETERAN">Veteran</button>
                  <button class="seg-btn" data-diff="OVERLORD">Overlord</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>Controls</span></div>
                <div class="seg-group">
                  <button class="seg-btn active" data-ctrl="CLASSIC">Classic</button>
                  <button class="seg-btn" data-ctrl="ARROWS_LMB">Arrows+LMB</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>Screen Shake</span></div>
                <div class="seg-group">
                  <button class="seg-btn" data-shake="0">Off</button>
                  <button class="seg-btn" data-shake="0.5">Low</button>
                  <button class="seg-btn active" data-shake="1">Full</button>
                </div>
              </div>
              <div class="setting-row inline">
                <span class="setting-label">Combat Text</span>
                <button class="seg-btn active" id="set-dmg-nums">ON</button>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-heading">Graphics</div>
              <div class="setting-row">
                <div class="setting-label"><span>Bloom Glow</span><span class="setting-val" id="val-bloom">100%</span></div>
                <input class="setting-slider" id="set-bloom" type="range" min="0" max="150" value="100" />
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>Particles</span></div>
                <div class="seg-group">
                  <button class="seg-btn" data-particles="LOW">Low</button>
                  <button class="seg-btn" data-particles="MEDIUM">Med</button>
                  <button class="seg-btn active" data-particles="HIGH">High</button>
                  <button class="seg-btn" data-particles="ULTRA">Ultra</button>
                </div>
              </div>
              <div class="setting-row inline">
                <span class="setting-label">Grid Warp</span>
                <button class="seg-btn active" id="set-grid-warp">ON</button>
              </div>
              <div class="setting-row inline">
                <span class="setting-label">Camera Tilt</span>
                <button class="seg-btn active" id="set-cam-tilt">26°</button>
              </div>
              <div class="setting-row">
                <div class="setting-label"><span>Render Scale</span></div>
                <div class="seg-group">
                  <button class="seg-btn" data-pixel-ratio="1">1x</button>
                  <button class="seg-btn active" data-pixel-ratio="2">2x</button>
                </div>
              </div>
            </div>
          </div>

          <div class="hangar-label">Construct Hangar (Persists Across Runs)</div>
          <div class="ship-grid" id="pause-ship-grid"></div>

          <div class="modal-actions">
            <button class="primary-btn" id="btn-resume">Resume Construct</button>
            <button class="secondary-btn" id="btn-pause-restart">Restart Run</button>
            <button class="secondary-btn" id="btn-reset-settings">Reset Defaults</button>
          </div>
        </div>
      </div>

      <div class="modal-backdrop" id="modal-augment">
        <div class="modal-card">
          <div class="modal-title">Construct Augment</div>
          <div class="modal-sub">Select one system modification (Keys 1 / 2 / 3 or Click)</div>
          <div class="augment-grid" id="augment-grid"></div>
        </div>
      </div>

      <div class="modal-backdrop" id="modal-gameover">
        <div class="modal-card">
          <div class="modal-title">Construct Shattered</div>
          <div class="modal-sub" id="gameover-sub"></div>
          <div class="highscores-list" id="highscores-list"></div>
          <button class="primary-btn" id="btn-restart">Reboot Construct</button>
        </div>
      </div>
    `;

    this.waveEl = this.root.querySelector('#hud-wave')!;
    this.scoreEl = this.root.querySelector('#hud-score')!;
    this.multEl = this.root.querySelector('#hud-mult')!;
    this.hullFill = this.root.querySelector('#hud-hull-fill')!;
    this.hullText = this.root.querySelector('#hud-hull-txt')!;
    this.overdriveFill = this.root.querySelector('#hud-od-fill')!;
    this.bossWrap = this.root.querySelector('#boss-wrap')!;
    this.bossFill = this.root.querySelector('#boss-fill')!;
    this.waveBanner = this.root.querySelector('#wave-banner')!;
    this.combatTextLayer = this.root.querySelector('#combat-text-layer')!;
    this.damageVignette = this.root.querySelector('#damage-vignette')!;
    this.statsPanel = this.root.querySelector('.hud-stats')!;
    this.minimapCanvas = this.root.querySelector('#hud-minimap')!;
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.queueEl = this.root.querySelector('#hud-queue')!;
    this.channelWrap = this.root.querySelector('#hud-channel-wrap')!;
    this.channelLabel = this.root.querySelector('#hud-channel-label')!;
    this.channelFill = this.root.querySelector('#hud-channel-fill')!;
    this.hintEl = this.root.querySelector('#hud-hint')!;
    this.tiltBtn = this.root.querySelector('#btn-tilt')!;
    this.ctrlBtn = this.root.querySelector('#btn-ctrl')!;
    this.muteBtn = this.root.querySelector('#btn-mute')!;
    this.pauseBtn = this.root.querySelector('#btn-pause')!;
    this.augmentsStrip = this.root.querySelector('#hud-augments')!;

    this.startModal = this.root.querySelector('#modal-start')!;
    this.titleShipGrid = this.root.querySelector('#title-ship-grid')!;
    this.pauseModal = this.root.querySelector('#modal-pause')!;
    this.pauseShipGrid = this.root.querySelector('#pause-ship-grid')!;
    this.augmentModal = this.root.querySelector('#modal-augment')!;
    this.augmentGrid = this.root.querySelector('#augment-grid')!;
    this.gameOverModal = this.root.querySelector('#modal-gameover')!;
    this.gameOverSub = this.root.querySelector('#gameover-sub')!;
    this.highscoresEl = this.root.querySelector('#highscores-list')!;

    this.masterVolSlider = this.root.querySelector('#set-master-vol')!;
    this.musicVolSlider = this.root.querySelector('#set-music-vol')!;
    this.sfxVolSlider = this.root.querySelector('#set-sfx-vol')!;
    this.bloomSlider = this.root.querySelector('#set-bloom')!;
    this.masterVolVal = this.root.querySelector('#val-master-vol')!;
    this.musicVolVal = this.root.querySelector('#val-music-vol')!;
    this.sfxVolVal = this.root.querySelector('#val-sfx-vol')!;
    this.bloomVal = this.root.querySelector('#val-bloom')!;
    this.muteSettingBtn = this.root.querySelector('#set-mute')!;
    this.dmgNumsBtn = this.root.querySelector('#set-dmg-nums')!;
    this.gridWarpBtn = this.root.querySelector('#set-grid-warp')!;
    this.camTiltBtn = this.root.querySelector('#set-cam-tilt')!;

    const hotbar = this.root.querySelector('#hud-hotbar')!;
    for (const el of BASE_ELEMENTS) {
      const meta = ELEMENT_META[el];
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      slot.style.borderColor = `${meta.color}66`;
      slot.innerHTML = `
        <span class="hotbar-key" style="color:${meta.color}">${meta.hotkey}</span>
        ${getElementSvg(el, meta.color)}
        <span class="hotbar-name" style="color:${meta.color}">${meta.name}</span>
      `;
      hotbar.appendChild(slot);
      this.slotEls.set(el, slot);
    }

    this.tiltBtn.addEventListener('click', callbacks.onToggleTilt);
    this.ctrlBtn.addEventListener('click', callbacks.onToggleControls);
    this.muteBtn.addEventListener('click', callbacks.onToggleMute);
    this.pauseBtn.addEventListener('click', callbacks.onTogglePause);
    this.root.querySelector('#btn-resume')!.addEventListener('click', callbacks.onTogglePause);
    this.root.querySelector('#btn-start')!.addEventListener('click', callbacks.onStartGame);
    this.root.querySelector('#btn-restart')!.addEventListener('click', callbacks.onStartGame);
    this.root.querySelector('#btn-pause-restart')!.addEventListener('click', callbacks.onRestartRun);
    this.root.querySelector('#btn-reset-settings')!.addEventListener('click', callbacks.onResetSettings);

    this.masterVolSlider.addEventListener('input', () => {
      callbacks.onSettingsChange({ masterVolume: Number(this.masterVolSlider.value) / 100 });
    });
    this.musicVolSlider.addEventListener('input', () => {
      callbacks.onSettingsChange({ musicVolume: Number(this.musicVolSlider.value) / 100 });
    });
    this.sfxVolSlider.addEventListener('input', () => {
      callbacks.onSettingsChange({ sfxVolume: Number(this.sfxVolSlider.value) / 100 });
    });
    this.bloomSlider.addEventListener('input', () => {
      callbacks.onSettingsChange({ bloomIntensity: Number(this.bloomSlider.value) / 100 });
    });

    this.muteSettingBtn.addEventListener('click', callbacks.onToggleMute);
    this.camTiltBtn.addEventListener('click', callbacks.onToggleTilt);
    this.dmgNumsBtn.addEventListener('click', () => {
      const next = this.dmgNumsBtn.textContent !== 'ON';
      callbacks.onSettingsChange({ damageNumbers: next });
    });
    this.gridWarpBtn.addEventListener('click', () => {
      const next = this.gridWarpBtn.textContent !== 'ON';
      callbacks.onSettingsChange({ gridWarp: next });
    });

    this.pauseModal.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const diffBtn = target.closest<HTMLElement>('[data-diff]');
      if (diffBtn) {
        callbacks.onSettingsChange({ difficulty: diffBtn.dataset.diff as DifficultyId });
        return;
      }
      const ctrlBtn = target.closest<HTMLElement>('[data-ctrl]');
      if (ctrlBtn) {
        callbacks.onSettingsChange({ controlPreset: ctrlBtn.dataset.ctrl as ControlPreset });
        return;
      }
      const shakeBtn = target.closest<HTMLElement>('[data-shake]');
      if (shakeBtn) {
        callbacks.onSettingsChange({ screenShake: Number(shakeBtn.dataset.shake) });
        return;
      }
      const partBtn = target.closest<HTMLElement>('[data-particles]');
      if (partBtn) {
        callbacks.onSettingsChange({ particleQuality: partBtn.dataset.particles as ParticleQuality });
        return;
      }
      const ratioBtn = target.closest<HTMLElement>('[data-pixel-ratio]');
      if (ratioBtn) {
        callbacks.onSettingsChange({ pixelRatioCap: Number(ratioBtn.dataset.pixelRatio) === 1 ? 1 : 2 });
        return;
      }
      const shipCard = target.closest<HTMLElement>('[data-ship-id]');
      if (shipCard) {
        callbacks.onSettingsChange({ selectedShip: shipCard.dataset.shipId as ShipId });
      }
    });

    this.titleShipGrid.addEventListener('click', (ev) => {
      const shipCard = (ev.target as HTMLElement).closest<HTMLElement>('[data-ship-id]');
      if (shipCard) {
        callbacks.onSettingsChange({ selectedShip: shipCard.dataset.shipId as ShipId });
      }
    });

    this.setPreset('CLASSIC');
    this.augmentGrid.addEventListener('click', (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-aug-index]');
      if (card) {
        callbacks.onPickAugment(Number(card.dataset.augIndex));
      }
    });
  }

  public applySettings(s: GameSettings): void {
    this.setTilt(s.cameraTilt);
    this.setPreset(s.controlPreset);
    this.setMuted(s.muted);

    const mv = Math.round(s.masterVolume * 100);
    const muv = Math.round(s.musicVolume * 100);
    const sv = Math.round(s.sfxVolume * 100);
    const bv = Math.round(s.bloomIntensity * 100);
    this.masterVolSlider.value = String(mv);
    this.musicVolSlider.value = String(muv);
    this.sfxVolSlider.value = String(sv);
    this.bloomSlider.value = String(bv);
    this.masterVolVal.textContent = `${mv}%`;
    this.musicVolVal.textContent = `${muv}%`;
    this.sfxVolVal.textContent = `${sv}%`;
    this.bloomVal.textContent = `${bv}%`;

    this.muteSettingBtn.textContent = s.muted ? 'MUTED' : 'ENABLED';
    this.muteSettingBtn.classList.toggle('active', !s.muted);
    this.dmgNumsBtn.textContent = s.damageNumbers ? 'ON' : 'OFF';
    this.dmgNumsBtn.classList.toggle('active', s.damageNumbers);
    this.gridWarpBtn.textContent = s.gridWarp ? 'ON' : 'OFF';
    this.gridWarpBtn.classList.toggle('active', s.gridWarp);
    this.camTiltBtn.textContent = s.cameraTilt ? '26°' : '0°';
    this.camTiltBtn.classList.toggle('active', s.cameraTilt);

    for (const el of this.pauseModal.querySelectorAll<HTMLElement>('[data-diff]')) {
      el.classList.toggle('active', el.dataset.diff === s.difficulty);
    }
    for (const el of this.pauseModal.querySelectorAll<HTMLElement>('[data-ctrl]')) {
      el.classList.toggle('active', el.dataset.ctrl === s.controlPreset);
    }
    for (const el of this.pauseModal.querySelectorAll<HTMLElement>('[data-shake]')) {
      el.classList.toggle('active', Math.abs(Number(el.dataset.shake) - s.screenShake) < 0.05);
    }
    for (const el of this.pauseModal.querySelectorAll<HTMLElement>('[data-particles]')) {
      el.classList.toggle('active', el.dataset.particles === s.particleQuality);
    }
    for (const el of this.pauseModal.querySelectorAll<HTMLElement>('[data-pixel-ratio]')) {
      el.classList.toggle('active', Number(el.dataset.pixelRatio) === s.pixelRatioCap);
    }

    const shipsHtml = renderShipCardsHtml(s.selectedShip);
    this.titleShipGrid.innerHTML = shipsHtml;
    this.pauseShipGrid.innerHTML = shipsHtml;
  }

  public setTilt(enabled: boolean): void {
    this.tiltBtn.textContent = enabled ? 'TILT: 26°' : 'TILT: 0°';
    this.tiltBtn.classList.toggle('active', enabled);
  }

  public spawnFloatingText(screenX: number, screenY: number, text: string, colorHex: number, big = false): void {
    while (this.combatTextLayer.childElementCount >= 24) {
      this.combatTextLayer.firstElementChild?.remove();
    }
    const el = document.createElement('span');
    el.className = big ? 'combat-num big' : 'combat-num';
    el.textContent = text;
    const cssColor = `#${colorHex.toString(16).padStart(6, '0')}`;
    el.style.color = cssColor;
    el.style.left = `${Math.round(screenX)}px`;
    el.style.top = `${Math.round(screenY)}px`;
    this.combatTextLayer.appendChild(el);
    window.setTimeout(() => {
      el.remove();
    }, big ? 820 : 620);
  }

  public setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON';
  }

  public triggerDamageFlash(hpRatio: number, absorbedByArmor: boolean): void {
    this.damageVignette.classList.toggle('armor', absorbedByArmor);
    this.damageVignette.style.transition = 'none';
    this.damageVignette.style.opacity = absorbedByArmor ? '0.62' : hpRatio <= 0.35 ? '0.96' : '0.82';
    void this.damageVignette.offsetWidth;
    if (this.damageFlashTimer !== null) window.clearTimeout(this.damageFlashTimer);
    this.damageFlashTimer = window.setTimeout(() => {
      this.damageVignette.style.transition = 'opacity 0.36s ease-out';
      this.damageVignette.style.opacity = '0';
    }, 80);

    this.statsPanel.classList.remove('hit-flash');
    void this.statsPanel.offsetWidth;
    this.statsPanel.classList.add('hit-flash');
    if (this.hitJoltTimer !== null) window.clearTimeout(this.hitJoltTimer);
    this.hitJoltTimer = window.setTimeout(() => {
      this.statsPanel.classList.remove('hit-flash');
    }, 300);
  }

  public showWaveBanner(wave: number, isBoss: boolean): void {
    this.waveBanner.textContent = isBoss ? `BOSS SECTOR ${wave} — SECTOR WARDEN` : `SECTOR ${wave}`;
    this.waveBanner.style.color = isBoss ? '#ff2e97' : '#00f5ff';
    this.waveBanner.style.opacity = '1';
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.waveBanner.style.opacity = '0';
    }, 2200);
  }

  public showGateOpenBanner(): void {
    this.waveBanner.textContent = 'SECTOR CLEAR — ENTER EAST GATE →';
    this.waveBanner.style.color = '#39ff14';
    this.waveBanner.style.opacity = '1';
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.waveBanner.style.opacity = '0';
    }, 2600);
  }

  public setPreset(preset: ControlPreset): void {
    if (preset === 'CLASSIC') {
      this.ctrlBtn.textContent = 'CLASSIC';
      this.hintEl.textContent = 'LMB: Click/Hold Move · RMB: Cast · Space: Area Nova · MMB/C: Self · Shift+LMB: Phase Slash';
    } else {
      this.ctrlBtn.textContent = 'ARROWS + LMB';
      this.hintEl.textContent = 'Arrows: Move · LMB: Cast · RMB/Space: Area Nova · MMB/C: Self · Shift: Phase Slash';
    }
  }

  private drawMinimap(snapshot: SimSnapshot): void {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const toX = (wx: number): number => ((wx + ARENA_HALF_W) / (ARENA_HALF_W * 2)) * w;
    const toY = (wy: number): number => ((ARENA_HALF_H - wy) / (ARENA_HALF_H * 2)) * h;
    const scale = w / (ARENA_HALF_W * 2);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(3, 5, 12, 0.94)';
    ctx.fillRect(0, 0, w, h);

    // Arena floor polygon shape
    if (snapshot.arenaBoundary.length >= 3) {
      ctx.beginPath();
      const v0 = snapshot.arenaBoundary[0]!;
      ctx.moveTo(toX(v0.x), toY(v0.y));
      for (let i = 1; i < snapshot.arenaBoundary.length; i++) {
        const v = snapshot.arenaBoundary[i]!;
        ctx.lineTo(toX(v.x), toY(v.y));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(9, 16, 36, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Subtle grid
    ctx.strokeStyle = 'rgba(26, 107, 255, 0.14)';
    ctx.lineWidth = 1;
    for (let gx = 1; gx < 6; gx++) {
      const px = (gx / 6) * w;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let gy = 1; gy < 4; gy++) {
      const py = (gy / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Irregular / Massive Arena Obstacles
    ctx.fillStyle = 'rgba(0, 216, 255, 0.36)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.78)';
    ctx.lineWidth = 1;
    for (const obs of snapshot.obstacles) {
      if (obs.vertices.length < 3) continue;
      ctx.beginPath();
      const v0 = obs.vertices[0]!;
      ctx.moveTo(toX(v0.x), toY(v0.y));
      for (let i = 1; i < obs.vertices.length; i++) {
        const v = obs.vertices[i]!;
        ctx.lineTo(toX(v.x), toY(v.y));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Legacy Blocks & Cover Pillars
    for (const blk of snapshot.blocks) {
      const bx = toX(blk.x - blk.halfW);
      const by = toY(blk.y + blk.halfH);
      const bw = Math.max(3, blk.halfW * 2 * scale);
      const bh = Math.max(3, blk.halfH * 2 * scale);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
    }

    ctx.fillStyle = 'rgba(26, 107, 255, 0.62)';
    for (const pil of snapshot.pillars) {
      ctx.beginPath();
      ctx.arc(toX(pil.x), toY(pil.y), Math.max(2.5, pil.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Pools
    for (const pool of snapshot.pools) {
      ctx.fillStyle = pool.kind === 'PLASMA' ? 'rgba(255, 94, 153, 0.28)' : 'rgba(26, 107, 255, 0.28)';
      ctx.beginPath();
      ctx.arc(toX(pool.x), toY(pool.y), Math.max(2, pool.radius * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Walls & Mines
    ctx.fillStyle = '#e6f0ff';
    for (const wall of snapshot.walls) {
      ctx.fillRect(toX(wall.x) - 1.5, toY(wall.y) - 1.5, 3, 3);
    }
    ctx.fillStyle = '#fff733';
    for (const mine of snapshot.mines) {
      ctx.fillRect(toX(mine.x) - 1, toY(mine.y) - 1, 2, 2);
    }

    // Spawn Rifts
    ctx.strokeStyle = '#b429ff';
    ctx.lineWidth = 1.5;
    for (const rift of snapshot.rifts) {
      ctx.beginPath();
      ctx.arc(toX(rift.x), toY(rift.y), Math.max(4, rift.radius * scale), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Enemies
    for (const e of snapshot.enemies) {
      ctx.fillStyle =
        e.archetype === 'WARDEN' ? '#ff2e97' :
        e.archetype === 'BASTION' ? '#e6f0ff' :
        e.archetype === 'STALKER' ? '#00f5ff' :
        e.archetype === 'PYRO_SPRAYER' ? '#ff6a00' :
        e.archetype === 'GEO_BOMBER' ? '#a86b3e' :
        e.archetype === 'WEAVER' ? '#b429ff' :
        e.archetype === 'SPLITTER' ? '#fff733' : '#ff2e97';
      const r = e.archetype === 'WARDEN' ? 5 : 2.3;
      ctx.beginPath();
      ctx.arc(toX(e.x), toY(e.y), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // East Gate
    const gx = toX(snapshot.gate.x);
    const gy = toY(snapshot.gate.y);
    ctx.fillStyle = snapshot.gate.open ? '#39ff14' : '#4a5568';
    ctx.fillRect(gx - 3, gy - 8, 5, 16);

    // Waypoint
    const p = snapshot.player;
    if (p.moveTarget) {
      ctx.strokeStyle = '#00f5ff';
      ctx.beginPath();
      ctx.arc(toX(p.moveTarget.x), toY(p.moveTarget.y), 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Player chevron
    const px = toX(p.x);
    const py = toY(p.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-p.aimAngle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3, 3);
    ctx.lineTo(-3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  public update(
    snapshot: SimSnapshot,
    highScores: Array<{ score: number; wave: number }>,
    shiftHeld = false
  ): void {
    this.waveEl.textContent = String(snapshot.wave);
    this.scoreEl.textContent = snapshot.score.toLocaleString();
    this.multEl.textContent = `x${snapshot.multiplier}`;

    const hpPct = Math.max(0, Math.min(100, (snapshot.player.hp / snapshot.player.maxHp) * 100));
    this.hullFill.style.width = `${hpPct}%`;
    this.hullFill.classList.toggle('low', hpPct <= 35);
    const armorTxt = snapshot.player.armorHp > 0 ? ` +${Math.ceil(snapshot.player.armorHp)}` : '';
    this.hullText.textContent = `${Math.ceil(snapshot.player.hp)}/${snapshot.player.maxHp}${armorTxt}`;

    const odPct = Math.max(0, Math.min(100, (snapshot.player.overclockTimer / snapshot.player.overclockMax) * 100));
    this.overdriveFill.style.width = `${odPct}%`;

    if (snapshot.boss) {
      this.bossWrap.classList.add('visible');
      this.bossFill.style.width = `${Math.max(0, (snapshot.boss.hp / snapshot.boss.maxHp) * 100)}%`;
    } else {
      this.bossWrap.classList.remove('visible');
    }

    const ch = snapshot.player.channel;
    const charge = snapshot.player.charge;
    if (ch) {
      this.channelWrap.style.display = 'flex';
      this.channelWrap.style.flexDirection = 'column';
      this.channelWrap.style.gap = '3px';
      this.channelLabel.textContent = `CHANNELING ${ch.delivery.replace('_', ' ')}`;
      this.channelFill.style.width = `${Math.max(0, (ch.remaining / ch.maxDuration) * 100)}%`;
      this.channelFill.style.background = `#${ch.composition.primaryColorHex.toString(16).padStart(6, '0')}`;
    } else if (charge) {
      this.channelWrap.style.display = 'flex';
      this.channelWrap.style.flexDirection = 'column';
      this.channelWrap.style.gap = '3px';
      const pct = Math.round(charge.ratio * 100);
      this.channelLabel.textContent = `CHARGING ${charge.delivery.replace('_', ' ')} (${pct}%)`;
      this.channelFill.style.width = `${pct}%`;
      this.channelFill.style.background = `#${charge.composition.primaryColorHex.toString(16).padStart(6, '0')}`;
    } else {
      this.channelWrap.style.display = 'none';
    }

    const q = snapshot.player.queue;
    if (q.length === 0) {
      this.queueEl.textContent = 'QUEUE: EMPTY';
    } else {
      const previewMode = shiftHeld ? 'NOVA' : 'FORWARD';
      const prefix = shiftHeld ? 'NOVA: ' : '';
      this.queueEl.innerHTML = `<span style="color:#ffffff;font-weight:700">${prefix}${formatSpellPreview(q, previewMode)}</span>`;
    }

    for (const el of BASE_ELEMENTS) {
      const slot = this.slotEls.get(el)!;
      const isQueued = q.includes(el);
      const meta = ELEMENT_META[el];
      slot.classList.toggle('queued', isQueued);
      slot.style.boxShadow = isQueued ? `0 0 16px ${meta.color}88` : 'none';
      slot.style.borderColor = isQueued ? meta.color : `${meta.color}55`;
    }

    this.drawMinimap(snapshot);

    const activeAugEntries = (Object.entries(snapshot.augments) as Array<[AugmentId, number]>).filter(([, n]) => n > 0);
    const activeAugKey = activeAugEntries.map(([id, n]) => `${id}:${n}`).join('|');
    if (activeAugKey !== this.lastActiveAugKey) {
      this.lastActiveAugKey = activeAugKey;
      this.augmentsStrip.innerHTML = activeAugEntries
        .map(([id, n]) => {
          const def = getAugmentDef(id);
          return `<span class="augment-badge" style="border-color:${def.color}88;color:${def.color}">${def.name}${n > 1 ? ` ×${n}` : ''}</span>`;
        })
        .join('');
    }

    this.pauseBtn.classList.toggle('active', snapshot.phase === 'PAUSED');
    this.startModal.classList.toggle('open', snapshot.phase === 'TITLE');
    this.pauseModal.classList.toggle('open', snapshot.phase === 'PAUSED');
    this.augmentModal.classList.toggle('open', snapshot.phase === 'AUGMENT_CHOICE');
    this.gameOverModal.classList.toggle('open', snapshot.phase === 'GAME_OVER');

    if (snapshot.phase === 'AUGMENT_CHOICE' && snapshot.pendingAugments.length > 0) {
      const augKey = snapshot.pendingAugments.map((a) => `${a.id}:${snapshot.augments[a.id] ?? 0}`).join('|');
      if (augKey !== this.lastAugmentKey) {
        this.lastAugmentKey = augKey;
        this.augmentGrid.innerHTML = snapshot.pendingAugments
          .map((aug, idx) => {
            const owned = snapshot.augments[aug.id] ?? 0;
            const rankBadge = owned > 0 ? `RANK ${owned + 1}` : 'NEW';
            return `
            <div class="augment-card" data-aug-index="${idx}" style="border-color:${aug.color}88">
              <span class="augment-tag" style="color:${aug.color}">[${idx + 1}] ${aug.tag} · ${rankBadge}</span>
              <span class="augment-name">${aug.name}</span>
              <span class="augment-desc">${aug.description}</span>
            </div>`;
          })
          .join('');
      }
    } else if (this.lastAugmentKey !== '') {
      this.lastAugmentKey = '';
    }

    if (snapshot.phase === 'GAME_OVER') {
      this.gameOverSub.textContent = `Final Score: ${snapshot.score.toLocaleString()} · Reached Wave ${snapshot.wave}`;
      this.highscoresEl.innerHTML =
        `<div style="color:#00ffff;margin-bottom:6px;letter-spacing:0.1em">LOCAL HIGH SCORES</div>` +
        (highScores.length === 0
          ? '<div class="highscore-row"><span>No runs recorded</span><span>—</span></div>'
          : highScores
              .map(
                (h, i) =>
                  `<div class="highscore-row"><span>#${i + 1} · Wave ${h.wave}</span><span>${h.score.toLocaleString()}</span></div>`
              )
              .join(''));
    }
  }
}
