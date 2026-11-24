import { BASE_ELEMENTS, ControlPreset, ELEMENT_META, QueueElement, SimSnapshot } from '../sim/types';

export interface HUDCallbacks {
  onToggleTilt: () => void;
  onToggleControls: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onStartGame: () => void;
  onPickAugment: (index: number) => void;
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
    case 'AEGIS':
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
  private readonly queueEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly slotEls = new Map<QueueElement, HTMLElement>();
  private readonly tiltBtn: HTMLButtonElement;
  private readonly ctrlBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;

  private readonly startModal: HTMLElement;
  private readonly augmentModal: HTMLElement;
  private readonly augmentGrid: HTMLElement;
  private readonly gameOverModal: HTMLElement;
  private readonly gameOverSub: HTMLElement;
  private readonly highscoresEl: HTMLElement;

  constructor(container: HTMLElement, callbacks: HUDCallbacks) {
    this.root = container;
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-panel hud-stats">
          <div class="stat-block">
            <span class="stat-label">Wave</span>
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
        <div class="hud-controls">
          <button class="hud-btn" id="btn-tilt">TILT: 0°</button>
          <button class="hud-btn" id="btn-ctrl">CLASSIC</button>
          <button class="hud-btn" id="btn-mute">AUDIO: ON</button>
          <button class="hud-btn" id="btn-pause">PAUSE</button>
        </div>
      </div>

      <div class="boss-bar-wrap" id="boss-wrap">
        <div class="boss-label">SECTOR WARDEN</div>
        <div class="boss-track"><div class="boss-fill" id="boss-fill" style="width:100%"></div></div>
      </div>

      <div class="hud-bottom">
        <div class="queue-preview" id="hud-queue">QUEUE: EMPTY</div>
        <div class="hotbar" id="hud-hotbar"></div>
        <div class="controls-hint" id="hud-hint"></div>
      </div>

      <div class="modal-backdrop" id="modal-start">
        <div class="modal-card">
          <div class="modal-title">Vector Arcana</div>
          <div class="modal-sub">
            Queue up to 3 elements with <strong>Q W E R</strong> / <strong>A S D F</strong>.<br/>
            Hold <strong>LMB</strong> or <strong>Arrows</strong> to move · <strong>RMB</strong> Forward Cast · <strong>Shift+RMB</strong> Nova · <strong>MMB/Space</strong> Self · <strong>Shift+LMB</strong> Phase Slash.
          </div>
          <button class="primary-btn" id="btn-start">Launch Construct</button>
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
    this.queueEl = this.root.querySelector('#hud-queue')!;
    this.hintEl = this.root.querySelector('#hud-hint')!;
    this.tiltBtn = this.root.querySelector('#btn-tilt')!;
    this.ctrlBtn = this.root.querySelector('#btn-ctrl')!;
    this.muteBtn = this.root.querySelector('#btn-mute')!;

    this.startModal = this.root.querySelector('#modal-start')!;
    this.augmentModal = this.root.querySelector('#modal-augment')!;
    this.augmentGrid = this.root.querySelector('#augment-grid')!;
    this.gameOverModal = this.root.querySelector('#modal-gameover')!;
    this.gameOverSub = this.root.querySelector('#gameover-sub')!;
    this.highscoresEl = this.root.querySelector('#highscores-list')!;

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
    this.root.querySelector('#btn-pause')!.addEventListener('click', callbacks.onTogglePause);
    this.root.querySelector('#btn-start')!.addEventListener('click', callbacks.onStartGame);
    this.root.querySelector('#btn-restart')!.addEventListener('click', callbacks.onStartGame);
    this.setPreset('CLASSIC');
    this.augmentGrid.addEventListener('click', (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-aug-index]');
      if (card) {
        callbacks.onPickAugment(Number(card.dataset.augIndex));
      }
    });
  }

  public setTilt(enabled: boolean): void {
    this.tiltBtn.textContent = enabled ? 'TILT: 8°' : 'TILT: 0°';
    this.tiltBtn.classList.toggle('active', enabled);
  }

  public setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON';
  }

  public setPreset(preset: ControlPreset): void {
    if (preset === 'CLASSIC') {
      this.ctrlBtn.textContent = 'CLASSIC';
      this.hintEl.textContent = 'LMB/Arrows: Move · RMB: Forward Cast · Shift+RMB: Nova · MMB/Space: Self · Shift+LMB: Phase Slash';
    } else {
      this.ctrlBtn.textContent = 'ARROWS + LMB';
      this.hintEl.textContent = 'Arrows: Move · LMB: Forward Cast · RMB: Nova · MMB/Space: Self · Shift: Phase Slash';
    }
  }

  public update(snapshot: SimSnapshot, highScores: Array<{ score: number; wave: number }>): void {
    this.waveEl.textContent = String(snapshot.wave);
    this.scoreEl.textContent = snapshot.score.toLocaleString();
    this.multEl.textContent = `x${snapshot.multiplier}`;

    const hpPct = Math.max(0, Math.min(100, (snapshot.player.hp / snapshot.player.maxHp) * 100));
    this.hullFill.style.width = `${hpPct}%`;
    this.hullFill.classList.toggle('low', hpPct <= 35);
    this.hullText.textContent = `${Math.ceil(snapshot.player.hp)}/${snapshot.player.maxHp}`;

    const odPct = Math.max(0, Math.min(100, (snapshot.player.overclockTimer / snapshot.player.overclockMax) * 100));
    this.overdriveFill.style.width = `${odPct}%`;

    if (snapshot.boss) {
      this.bossWrap.classList.add('visible');
      this.bossFill.style.width = `${Math.max(0, (snapshot.boss.hp / snapshot.boss.maxHp) * 100)}%`;
    } else {
      this.bossWrap.classList.remove('visible');
    }

    // Queue preview
    const q = snapshot.player.queue;
    if (q.length === 0) {
      this.queueEl.textContent = 'QUEUE: EMPTY';
    } else {
      this.queueEl.innerHTML = q
        .map((el) => {
          const m = ELEMENT_META[el];
          return `<span style="color:${m.color};font-weight:700">${m.name.toUpperCase()}</span>`;
        })
        .join(' <span style="opacity:0.4">+</span> ');
    }

    for (const el of BASE_ELEMENTS) {
      const slot = this.slotEls.get(el)!;
      const isQueued = q.includes(el);
      const meta = ELEMENT_META[el];
      slot.classList.toggle('queued', isQueued);
      slot.style.boxShadow = isQueued ? `0 0 16px ${meta.color}88` : 'none';
      slot.style.borderColor = isQueued ? meta.color : `${meta.color}55`;
    }

    this.startModal.classList.toggle('open', snapshot.phase === 'TITLE');
    this.augmentModal.classList.toggle('open', snapshot.phase === 'AUGMENT_CHOICE');
    this.gameOverModal.classList.toggle('open', snapshot.phase === 'GAME_OVER');

    if (snapshot.phase === 'AUGMENT_CHOICE' && snapshot.pendingAugments.length > 0) {
      this.augmentGrid.innerHTML = snapshot.pendingAugments
        .map(
          (aug, idx) => `
          <div class="augment-card" data-aug-index="${idx}" style="border-color:${aug.color}88">
            <span class="augment-tag" style="color:${aug.color}">[${idx + 1}] ${aug.tag}</span>
            <span class="augment-name">${aug.name}</span>
            <span class="augment-desc">${aug.description}</span>
          </div>`
        )
        .join('');
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
