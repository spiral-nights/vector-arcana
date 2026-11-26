import { clampPointToConvexPoly, DEFAULT_RECT_BOUNDARY } from './ArenaGeometry';
import {
  DifficultyConfig,
  EnemyArchetype,
  EnemyEntity,
  PlayerState,
  SimEvent,
  Vec2,
} from './types';

function clampArena(
  x: number,
  y: number,
  pad: number,
  boundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY
): { x: number; y: number } {
  return clampPointToConvexPoly(x, y, pad, boundary);
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function getWaveScaling(wave: number): {
  hpScale: number;
  dmgScale: number;
  speedScale: number;
  rateScale: number;
  bonusArmor: number;
} {
  const w = Math.max(0, wave - 1);
  return {
    hpScale: (1 + w * 0.24) * Math.pow(1.08, Math.max(0, w - 2)),
    dmgScale: 1 + w * 0.11 + Math.max(0, w - 5) * 0.05,
    speedScale: 1 + Math.min(0.85, w * 0.045),
    rateScale: 1 + Math.min(1.0, w * 0.055),
    bonusArmor: Math.min(0.45, Math.max(0, wave - 3) * 0.03),
  };
}

export function createEnemy(
  id: number,
  archetype: EnemyArchetype,
  x: number,
  y: number,
  wave: number,
  difficulty?: DifficultyConfig,
  isElite = false
): EnemyEntity {
  const ws = getWaveScaling(wave);
  const hpMult = difficulty?.enemyHpMult ?? 1;
  const eliteHp = isElite ? 1.65 : 1;
  const hpScale = ws.hpScale * hpMult * eliteHp;
  const base: EnemyEntity = {
    id,
    archetype,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    radius: 12,
    hp: 38,
    maxHp: 38,
    shieldHp: 0,
    maxShieldHp: 0,
    armor: 0,
    baseArmor: 0,
    shieldAngle: Math.PI,
    shieldArc: 1.15,
    hasFrontShield: false,
    bossShieldAngles: [],
    aiState: 'SEEK',
    aiTimer: 0.9,
    beamAngle: 0,
    statuses: {},
    hitFlash: 0,
    affinity: undefined,
    weakness: undefined,
    nanoMarkTimer: 0,
    freezeImmuneTimer: 0,
    isElite,
    spinPhase: 0,
  };

  switch (archetype) {
    case 'SWARMER':
      base.radius = 12;
      base.hp = Math.round(38 * hpScale);
      base.maxHp = base.hp;
      break;
    case 'BASTION':
      base.radius = 24;
      base.hp = Math.round(160 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.4;
      base.armor = 0.4;
      base.hasFrontShield = true;
      base.shieldHp = Math.round(150 * hpScale);
      base.maxShieldHp = base.shieldHp;
      base.shieldArc = 1.15;
      base.aiTimer = 1.1;
      base.affinity = 'CRYO';
      base.weakness = 'THERMAL';
      break;
    case 'STALKER':
      base.radius = 16;
      base.hp = Math.round(85 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.2;
      base.affinity = 'CRYO';
      base.weakness = 'THERMAL';
      break;
    case 'PYRO_SPRAYER':
      base.radius = 20;
      base.hp = Math.round(115 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.2;
      base.affinity = 'THERMAL';
      base.weakness = 'CRYO';
      break;
    case 'GEO_BOMBER':
      base.radius = 23;
      base.hp = Math.round(145 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.25;
      base.armor = 0.25;
      base.aiTimer = 1.6;
      base.affinity = 'KINETIC';
      base.weakness = 'VOLT';
      break;
    case 'WEAVER':
      base.radius = 19;
      base.hp = Math.round(110 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.4;
      base.affinity = 'VOID';
      base.weakness = 'NANO';
      break;
    case 'CINDER_WISP':
      base.radius = 20;
      base.hp = Math.round(125 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.9;
      base.affinity = 'THERMAL';
      base.weakness = 'CRYO';
      break;
    case 'LANCER':
      base.radius = 16;
      base.hp = Math.round(80 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.1;
      base.affinity = 'THERMAL';
      base.weakness = 'FLUX';
      break;
    case 'VOLT_SPRINTER':
      base.radius = 14;
      base.hp = Math.round(72 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 0.9;
      base.affinity = 'VOLT';
      base.weakness = 'KINETIC';
      break;
    case 'CRYO_SNIPER':
      base.radius = 17;
      base.hp = Math.round(90 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.4;
      base.affinity = 'CRYO';
      base.weakness = 'THERMAL';
      break;
    case 'MENDER':
      base.radius = 18;
      base.hp = Math.round(110 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.6;
      base.affinity = 'NANO';
      base.weakness = 'VOID';
      break;
    case 'VORTEX_DRONE':
      base.radius = 21;
      base.hp = Math.round(130 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.15;
      base.armor = 0.15;
      base.aiTimer = 1.4;
      base.affinity = 'FLUX';
      base.weakness = 'VOLT';
      break;
    case 'MINELAYER':
      base.radius = 23;
      base.hp = Math.round(155 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.2;
      base.armor = 0.2;
      base.aiTimer = 1.5;
      base.affinity = 'KINETIC';
      base.weakness = 'FLUX';
      break;
    case 'OBELISK':
      base.radius = 25;
      base.hp = Math.round(185 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.3;
      base.armor = 0.3;
      base.bossShieldAngles = [0];
      base.aiTimer = 1.3;
      base.affinity = 'THERMAL';
      base.weakness = 'KINETIC';
      break;
    case 'WARDEN':
      base.radius = 48;
      base.hp = Math.round((1450 + wave * 180) * Math.pow(1.09, Math.max(0, wave - 5)) * hpMult * eliteHp);
      base.maxHp = base.hp;
      base.baseArmor = 0.28;
      base.armor = 0.28;
      base.bossPhase = 1;
      base.bossShieldAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
      base.aiTimer = 1.4;
      base.affinity = 'VOID';
      break;
  }

  if (wave >= 4 || isElite) {
    base.baseArmor = Math.min(0.75, base.baseArmor + ws.bonusArmor + (isElite ? 0.12 : 0));
    base.armor = base.baseArmor;
  }
  if (isElite && archetype !== 'WARDEN') {
    base.radius = Math.round(base.radius * 1.2);
  }

  return base;
}

export interface EnemyAIHooks {
  spawnProjectile: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnTypedProjectile: (
    kind: 'CRYO_LANCE' | 'PLASMA_ORB' | 'VOLT_ORB',
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    damage: number,
    colorHex: number
  ) => void;
  spawnEnemyRock: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnEnemySpray: (x: number, y: number, angle: number, range: number, damage: number) => void;
  spawnBeam: (enemy: EnemyEntity, angle: number, offsetAngle?: number) => void;
  spawnMinion: (archetype: EnemyArchetype, x: number, y: number) => void;
  spawnHazard: (x: number, y: number, radius: number, delay: number, damage: number, colorHex: number) => void;
  damagePlayer: (amount: number, sourceEnemy?: EnemyEntity) => void;
}

function spawnBossHazard(
  e: EnemyEntity,
  angle: number,
  distance: number,
  radius: number,
  delay: number,
  damage: number,
  colorHex: number,
  hooks: EnemyAIHooks,
  boundary: readonly Vec2[]
): void {
  const pos = clampArena(e.x + Math.cos(angle) * distance, e.y + Math.sin(angle) * distance, radius * 0.6, boundary);
  hooks.spawnHazard(pos.x, pos.y, radius, delay, damage, colorHex);
}

export function stepEnemyAI(
  e: EnemyEntity,
  dt: number,
  player: PlayerState,
  allEnemies: readonly EnemyEntity[],
  hooks: EnemyAIHooks,
  events: SimEvent[],
  difficulty?: DifficultyConfig,
  arenaBoundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY,
  wave = 1
): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.nanoMarkTimer = Math.max(0, e.nanoMarkTimer - dt);
  e.freezeImmuneTimer = Math.max(0, e.freezeImmuneTimer - dt);
  const ws = getWaveScaling(wave);
  const dmgMult = (difficulty?.enemyDamageMult ?? 1) * ws.dmgScale * (e.isElite ? 1.25 : 1);
  const spdDiffMult = (difficulty?.enemySpeedMult ?? 1) * ws.speedScale * (e.isElite ? 1.12 : 1);
  const rateMult = (e.statuses.CHILLED ? 0.5 : 1.0) * ws.rateScale * (e.isElite ? 1.12 : 1);

  if (e.archetype === 'WARDEN') {
    const hpRatio = e.hp / Math.max(1, e.maxHp);
    const phase = hpRatio > 0.65 ? 1 : hpRatio > 0.3 ? 2 : 3;
    e.bossPhase = phase;
    if (hpRatio <= 0.5 && e.bossShieldAngles.length < 4) {
      e.bossShieldAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 130, colorHex: 0xff2e97, duration: 0.35 });
    }
    const plateSpeed = (phase === 1 ? 0.65 : phase === 2 ? 0.95 : 1.3) * (1 + Math.min(0.5, (wave - 5) * 0.04));
    for (let i = 0; i < e.bossShieldAngles.length; i++) {
      e.bossShieldAngles[i] = normalizeAngle(e.bossShieldAngles[i]! + plateSpeed * dt);
    }
  } else if (e.archetype === 'OBELISK' && e.bossShieldAngles.length > 0 && !e.statuses.FROZEN) {
    const obSpeed = 1.25 * (e.statuses.CHILLED ? 0.5 : 1.0) * spdDiffMult;
    for (let i = 0; i < e.bossShieldAngles.length; i++) {
      e.bossShieldAngles[i] = normalizeAngle(e.bossShieldAngles[i]! + obSpeed * dt);
    }
  }

  if (e.statuses.FROZEN) {
    e.vx *= 0.85;
    e.vy *= 0.85;
    return;
  }

  const speedMult = (e.statuses.CHILLED ? 0.5 : 1.0) * spdDiffMult;
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const dirX = dx / dist;
  const dirY = dy / dist;
  const targetAngle = Math.atan2(dy, dx);

  let sepX = 0;
  let sepY = 0;
  for (const other of allEnemies) {
    if (other.id === e.id) continue;
    const odx = e.x - other.x;
    const ody = e.y - other.y;
    const minD = e.radius + other.radius + 10;
    const d2 = odx * odx + ody * ody;
    if (d2 > 0.01 && d2 < minD * minD) {
      const d = Math.sqrt(d2);
      const push = (minD - d) / minD;
      sepX += (odx / d) * push * 110;
      sepY += (ody / d) * push * 110;
    }
  }

  switch (e.archetype) {
    case 'SWARMER': {
      e.angle = targetAngle;
      const spd = 104 * speedMult;
      e.vx += (dirX * spd + sepX - e.vx) * Math.min(1, 8 * dt);
      e.vy += (dirY * spd + sepY - e.vy) * Math.min(1, 8 * dt);
      break;
    }

    case 'BASTION': {
      const diff = normalizeAngle(targetAngle - e.angle);
      const maxTurn = 1.45 * speedMult * dt;
      e.angle = normalizeAngle(e.angle + Math.max(-maxTurn, Math.min(maxTurn, diff)));
      e.shieldAngle = e.angle;
      const spd = 54 * speedMult;
      e.vx += (dirX * spd + sepX * 0.5 - e.vx) * Math.min(1, 6 * dt);
      e.vy += (dirY * spd + sepY * 0.5 - e.vy) * Math.min(1, 6 * dt);

      e.aiTimer -= dt * rateMult;
      if (dist < 115 && e.aiTimer <= 0) {
        e.aiTimer = 2.2;
        hooks.spawnHazard(e.x, e.y, 108, 0.8, Math.round(22 * dmgMult), 0xe6f0ff);
      }
      break;
    }

    case 'STALKER': {
      e.angle = targetAngle;
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        const desired = 240;
        const radial = dist > desired + 30 ? 1 : dist < desired - 30 ? -0.75 : 0;
        const strafeX = -dirY * 0.7;
        const strafeY = dirX * 0.7;
        const spd = 88 * speedMult;
        e.vx += ((dirX * radial + strafeX) * spd + sepX - e.vx) * Math.min(1, 7 * dt);
        e.vy += ((dirY * radial + strafeY) * spd + sepY - e.vy) * Math.min(1, 7 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'TELEPORT_WINDUP';
          e.aiTimer = 0.6;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 34, colorHex: 0x00f5ff, duration: 0.5 });
        }
      } else if (e.aiState === 'TELEPORT_WINDUP') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        if (e.aiTimer <= 0) {
          const fireAngle = Math.atan2(player.y - e.y, player.x - e.x);
          for (const offset of [-0.24, 0, 0.24]) {
            const fa = fireAngle + offset;
            hooks.spawnProjectile(e.x, e.y, Math.cos(fa) * 320, Math.sin(fa) * 320, Math.round(14 * dmgMult));
          }
          const blinkAngle = targetAngle + (Math.random() > 0.5 ? 1.05 : -1.05);
          const pos = clampArena(e.x + Math.cos(blinkAngle) * 150, e.y + Math.sin(blinkAngle) * 150, e.radius + 16, arenaBoundary);
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 10, radius: 30 });
          e.x = pos.x;
          e.y = pos.y;
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 10, radius: 30 });
          e.aiState = 'SEEK';
          e.aiTimer = 1.95;
        }
      }
      break;
    }

    case 'WEAVER': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 310;
        const move = dist > desired + 35 ? 1 : dist < desired - 35 ? -0.6 : 0;
        const spd = 64 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 6 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 1.15;
          e.beamAngle = targetAngle;
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.84;
        e.vy *= 0.84;
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 2.0;
          hooks.spawnBeam(e, e.beamAngle);
        }
      } else if (e.aiState === 'FIRE') {
        e.vx *= 0.84;
        e.vy *= 0.84;
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.5;
        }
      } else {
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.8;
        }
      }
      break;
    }

    case 'CINDER_WISP': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 235;
        const move = dist > desired + 30 ? 0.85 : dist < desired - 40 ? -0.7 : 0.1;
        const spd = 96 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 6 * dt);
        if (e.aiTimer <= 0 && dist < 430) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.9;
          e.beamAngle = targetAngle;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 44, colorHex: 0xff6a00, duration: 0.85 });
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.86;
        e.vy *= 0.86;
        e.beamAngle = normalizeAngle(
          e.beamAngle + Math.max(-1.1 * dt, Math.min(1.1 * dt, normalizeAngle(targetAngle - e.beamAngle)))
        );
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 0.5;
          e.vx = Math.cos(e.beamAngle) * 330 * speedMult;
          e.vy = Math.sin(e.beamAngle) * 330 * speedMult;
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0xff6a00, count: 8, radius: 26 });
        }
      } else if (e.aiState === 'FIRE') {
        if (e.aiTimer <= 0) {
          hooks.spawnHazard(e.x, e.y, 74, 1.15, Math.round(18 * dmgMult), 0xff6a00);
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.25;
        }
      } else {
        e.angle = targetAngle;
        e.vx *= 0.94;
        e.vy *= 0.94;
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.9;
        }
      }
      break;
    }

    case 'PYRO_SPRAYER': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 190;
        const move = dist > desired + 25 ? 1 : dist < desired - 30 ? -0.5 : 0.15;
        const spd = 74 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 7 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 7 * dt);
        if (e.aiTimer <= 0 && dist < 270) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.55;
          e.beamAngle = targetAngle;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 36, colorHex: 0xff6a00, duration: 0.45 });
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.85;
        e.vy *= 0.85;
        e.angle = normalizeAngle(e.angle + Math.max(-1.8 * dt, Math.min(1.8 * dt, normalizeAngle(targetAngle - e.angle))));
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 1.4;
          e.beamAngle = 0; // sub-tick accumulator
        }
      } else if (e.aiState === 'FIRE') {
        const diff = normalizeAngle(targetAngle - e.angle);
        e.angle = normalizeAngle(e.angle + Math.max(-1.2 * dt, Math.min(1.2 * dt, diff)));
        e.vx *= 0.9;
        e.vy *= 0.9;
        e.beamAngle -= dt * speedMult;
        if (e.beamAngle <= 0) {
          e.beamAngle = 0.14;
          hooks.spawnEnemySpray(e.x, e.y, e.angle, 255, Math.round(7 * dmgMult));
        }
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.65;
        }
      }
      break;
    }

    case 'GEO_BOMBER': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 340;
        const move = dist > desired + 35 ? 1 : dist < desired - 35 ? -0.65 : 0;
        const spd = 52 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 6 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.85;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 40, colorHex: 0xa86b3e, duration: 0.65 });
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          hooks.spawnEnemyRock(e.x, e.y, Math.cos(targetAngle) * 360, Math.sin(targetAngle) * 360, Math.round(20 * dmgMult));
          e.aiState = 'SEEK';
          e.aiTimer = 2.2;
        }
      }
      break;
    }

    case 'LANCER': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 260;
        const move = dist > desired + 25 ? 1 : dist < desired - 40 ? -0.4 : 0.2;
        const spd = 105 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 8 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 8 * dt);
        if (e.aiTimer <= 0 && dist < 380) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.65;
          e.beamAngle = targetAngle;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 32, colorHex: 0xff4518, duration: 0.45 });
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        const turnDiff = normalizeAngle(targetAngle - e.beamAngle);
        e.beamAngle = normalizeAngle(e.beamAngle + Math.max(-1.1 * dt, Math.min(1.1 * dt, turnDiff)));
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 0.38;
          const lungeSpd = 520 * speedMult;
          e.vx = Math.cos(e.beamAngle) * lungeSpd;
          e.vy = Math.sin(e.beamAngle) * lungeSpd;
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0xff4518, count: 10, radius: 28 });
        }
      } else if (e.aiState === 'FIRE') {
        const lungeSpd = 520 * speedMult;
        e.vx = Math.cos(e.beamAngle) * lungeSpd;
        e.vy = Math.sin(e.beamAngle) * lungeSpd;
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = 0.8;
        }
      } else {
        e.vx *= 0.86;
        e.vy *= 0.86;
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.25;
        }
      }
      break;
    }

    case 'VOLT_SPRINTER': {
      e.angle = targetAngle;
      e.aiTimer -= dt * rateMult;
      e.spinPhase = (e.spinPhase ?? 0) + dt * 3.4;
      if (e.aiState === 'SEEK') {
        const zigSign = Math.sin(e.spinPhase) >= 0 ? 1 : -1;
        const desired = 230;
        const radial = dist > desired + 30 ? 0.9 : dist < desired - 30 ? -0.7 : 0.1;
        const spd = 128 * speedMult;
        e.vx += ((dirX * radial + -dirY * zigSign * 0.85) * spd + sepX - e.vx) * Math.min(1, 9 * dt);
        e.vy += ((dirY * radial + dirX * zigSign * 0.85) * spd + sepY - e.vy) * Math.min(1, 9 * dt);
        if (e.aiTimer <= 0 && dist < 380) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.38;
          e.beamAngle = targetAngle;
        }
      } else {
        e.vx *= 0.85;
        e.vy *= 0.85;
        if (e.aiTimer <= 0) {
          for (const off of [-0.14, 0.14]) {
            const fa = targetAngle + off;
            hooks.spawnTypedProjectile(
              'VOLT_ORB',
              e.x + Math.cos(fa) * 16,
              e.y + Math.sin(fa) * 16,
              Math.cos(fa) * 440,
              Math.sin(fa) * 440,
              8,
              Math.round(12 * dmgMult),
              0xfff733
            );
          }
          const juke = targetAngle + (Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5);
          e.vx = Math.cos(juke) * 260 * speedMult;
          e.vy = Math.sin(juke) * 260 * speedMult;
          e.aiState = 'SEEK';
          e.aiTimer = 1.45;
        }
      }
      break;
    }

    case 'CRYO_SNIPER': {
      e.aiTimer -= dt * rateMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 460;
        const move = dist > desired + 35 ? 1 : dist < desired - 40 ? -0.85 : 0;
        const spd = 72 * speedMult;
        e.vx += ((dirX * move + -dirY * 0.35) * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += ((dirY * move + dirX * 0.35) * spd + sepY - e.vy) * Math.min(1, 6 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 1.0;
          e.beamAngle = targetAngle;
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.84;
        e.vy *= 0.84;
        if (e.aiTimer > 0.3) {
          const diff = normalizeAngle(targetAngle - e.beamAngle);
          e.beamAngle = normalizeAngle(e.beamAngle + Math.max(-0.95 * dt, Math.min(0.95 * dt, diff)));
        }
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          hooks.spawnTypedProjectile(
            'CRYO_LANCE',
            e.x + Math.cos(e.beamAngle) * 20,
            e.y + Math.sin(e.beamAngle) * 20,
            Math.cos(e.beamAngle) * 760,
            Math.sin(e.beamAngle) * 760,
            8,
            Math.round(19 * dmgMult),
            0x80ffff
          );
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 8, radius: 22 });
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.5;
        }
      } else {
        e.angle = targetAngle;
        e.vx *= 0.9;
        e.vy *= 0.9;
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.2;
        }
      }
      break;
    }

    case 'MENDER': {
      e.aiTimer -= dt * rateMult;
      e.spinPhase = (e.spinPhase ?? 0) + dt * 2.2;
      let anchor: EnemyEntity | null = null;
      let bestScore = Infinity;
      for (const ally of allEnemies) {
        if (ally.id === e.id || ally.hp <= 0) continue;
        const dAlly = Math.hypot(ally.x - e.x, ally.y - e.y);
        if (dAlly > 520) continue;
        const ratio = ally.hp / Math.max(1, ally.maxHp);
        const score = ratio * 350 + dAlly * 0.35;
        if (score < bestScore) {
          bestScore = score;
          anchor = ally;
        }
      }
      const spd = 76 * speedMult;
      if (anchor) {
        const adx = anchor.x - e.x;
        const ady = anchor.y - e.y;
        const adist = Math.max(1, Math.hypot(adx, ady));
        const radial = adist > 130 ? 1 : adist < 85 ? -0.6 : 0;
        e.angle = Math.atan2(ady, adx);
        e.vx += (((adx / adist) * radial + (-ady / adist) * 0.6) * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += (((ady / adist) * radial + (adx / adist) * 0.6) * spd + sepY - e.vy) * Math.min(1, 6 * dt);
      } else {
        e.angle = targetAngle;
        const radial = dist > 320 ? 1 : dist < 240 ? -0.6 : 0;
        e.vx += ((dirX * radial + -dirY * 0.5) * spd + sepX - e.vx) * Math.min(1, 6 * dt);
        e.vy += ((dirY * radial + dirX * 0.5) * spd + sepY - e.vy) * Math.min(1, 6 * dt);
      }
      if (e.aiTimer <= 0) {
        e.aiTimer = 2.3;
        let healed = 0;
        for (const ally of allEnemies) {
          if (ally.id === e.id || ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
          if (Math.hypot(ally.x - e.x, ally.y - e.y) <= 280) {
            const rawHeal = Math.max(8, Math.round(ally.maxHp * 0.16));
            const applied = Math.min(rawHeal, ally.maxHp - ally.hp);
            if (applied > 0) {
              ally.hp = Math.min(ally.maxHp, ally.hp + applied);
              events.push({ type: 'vfx_lightning', points: [{ x: e.x, y: e.y }, { x: ally.x, y: ally.y }], colors: [0x39ff14, 0x80ff99] });
              events.push({ type: 'vfx_ring', x: ally.x, y: ally.y, radius: ally.radius * 1.8, colorHex: 0x39ff14, duration: 0.25 });
              events.push({ type: 'damage_number', x: ally.x, y: ally.y - ally.radius - 10, text: `+${applied}`, colorHex: 0x39ff14 });
              healed++;
              if (healed >= 2) break;
            }
          }
        }
        if (healed === 0 || dist < 240) {
          hooks.spawnTypedProjectile(
            'PLASMA_ORB',
            e.x + dirX * 18,
            e.y + dirY * 18,
            dirX * 290,
            dirY * 290,
            9,
            Math.round(11 * dmgMult),
            0x39ff14
          );
        }
      }
      break;
    }

    case 'VORTEX_DRONE': {
      e.angle = targetAngle;
      e.aiTimer -= dt * rateMult;
      e.spinPhase = (e.spinPhase ?? 0) + dt * 2.4;
      const desired = 230;
      const move = dist > desired + 30 ? 1 : dist < desired - 30 ? -0.5 : 0;
      const spd = 62 * speedMult;
      e.vx += ((dirX * move + -dirY * 0.45) * spd + sepX - e.vx) * Math.min(1, 6 * dt);
      e.vy += ((dirY * move + dirX * 0.45) * spd + sepY - e.vy) * Math.min(1, 6 * dt);
      if (dist < 220 && player.dashTimer <= 0) {
        player.vx -= dirX * 155 * dt;
        player.vy -= dirY * 155 * dt;
        if (Math.random() < 0.15) {
          events.push({ type: 'grid_well', x: e.x, y: e.y, strength: 95, radius: 190, colorHex: 0x1a88ff });
        }
      }
      if (e.aiTimer <= 0) {
        e.aiTimer = 1.9;
        const orbCount = e.isElite ? 8 : 6;
        const baseA = e.spinPhase;
        for (let k = 0; k < orbCount; k++) {
          const a = baseA + (k / orbCount) * Math.PI * 2;
          hooks.spawnTypedProjectile(
            'PLASMA_ORB',
            e.x + Math.cos(a) * 18,
            e.y + Math.sin(a) * 18,
            Math.cos(a) * 245,
            Math.sin(a) * 245,
            8,
            Math.round(12 * dmgMult),
            0x1a88ff
          );
        }
        events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 46, colorHex: 0x1a88ff, duration: 0.25 });
      }
      break;
    }

    case 'MINELAYER': {
      e.angle = targetAngle;
      e.aiTimer -= dt * rateMult;
      const desired = 330;
      const move = dist > desired + 35 ? 1 : dist < desired - 35 ? -0.6 : 0;
      const spd = 56 * speedMult;
      e.vx += ((dirX * move + -dirY * 0.55) * spd + sepX - e.vx) * Math.min(1, 6 * dt);
      e.vy += ((dirY * move + dirX * 0.55) * spd + sepY - e.vy) * Math.min(1, 6 * dt);
      if (e.aiTimer <= 0) {
        e.aiTimer = 2.3;
        const mineCount = e.isElite ? 3 : 2;
        for (let k = 0; k < mineCount; k++) {
          const spread = (k - (mineCount - 1) * 0.5) * 58;
          const tx = e.x - dirX * (28 + k * 26) - dirY * spread;
          const ty = e.y - dirY * (28 + k * 26) + dirX * spread;
          const safe = clampArena(tx, ty, 64, arenaBoundary);
          hooks.spawnHazard(safe.x, safe.y, 68, 1.15 + k * 0.22, Math.round(18 * dmgMult), 0xff5e99);
        }
        events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0xff5e99, count: 8, radius: 26 });
      }
      break;
    }

    case 'OBELISK': {
      e.angle = targetAngle;
      e.aiTimer -= dt * rateMult;
      const desired = 280;
      const move = dist > desired + 35 ? 1 : dist < desired - 35 ? -0.45 : 0;
      const spd = 42 * speedMult;
      e.vx += (dirX * move * spd + sepX * 0.4 - e.vx) * Math.min(1, 5 * dt);
      e.vy += (dirY * move * spd + sepY * 0.4 - e.vy) * Math.min(1, 5 * dt);
      if (e.aiTimer <= 0) {
        e.aiTimer = 1.65;
        const phaseFlip = Math.round(e.spinPhase ?? 0) % 2 === 1;
        e.spinPhase = (e.spinPhase ?? 0) + 1;
        const offset = phaseFlip ? Math.PI * 0.25 : 0;
        for (let k = 0; k < 4; k++) {
          const a = offset + (k / 4) * Math.PI * 2;
          hooks.spawnTypedProjectile(
            'PLASMA_ORB',
            e.x + Math.cos(a) * 24,
            e.y + Math.sin(a) * 24,
            Math.cos(a) * 295,
            Math.sin(a) * 295,
            9,
            Math.round(13 * dmgMult),
            0xff5e99
          );
        }
        if (dist < 130) {
          hooks.spawnHazard(e.x, e.y, 120, 0.75, Math.round(20 * dmgMult), 0xe6f0ff);
        }
      }
      break;
    }

    case 'WARDEN': {
      e.aiTimer -= dt * rateMult;
      const phase = e.bossPhase ?? 1;
      const spd = (phase === 3 ? 60 : phase === 2 ? 48 : 38) * speedMult;
      e.vx += (dirX * spd - e.vx) * Math.min(1, 5 * dt);
      e.vy += (dirY * spd - e.vy) * Math.min(1, 5 * dt);

      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = phase === 3 ? 0.95 : phase === 2 ? 1.1 : 1.3;
          e.beamAngle = targetAngle;
          if (phase >= 2) {
            spawnBossHazard(e, e.beamAngle, 165, 92, 1.25, Math.round(24 * dmgMult), 0xff2e97, hooks, arenaBoundary);
          }
          if (phase === 3) {
            spawnBossHazard(e, e.beamAngle - 0.5, 200, 86, 1.35, Math.round(22 * dmgMult), 0xff6a00, hooks, arenaBoundary);
            spawnBossHazard(e, e.beamAngle + 0.5, 200, 86, 1.35, Math.round(22 * dmgMult), 0xff6a00, hooks, arenaBoundary);
          }
        }
      } else if (e.aiState === 'CHARGE') {
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = phase === 3 ? 2.8 : phase === 2 ? 2.5 : 2.2;

          if (phase === 1) {
            hooks.spawnBeam(e, e.beamAngle, 0);
            for (const off of [-0.36, -0.18, 0, 0.18, 0.36]) {
              const fa = targetAngle + off;
              hooks.spawnProjectile(e.x, e.y, Math.cos(fa) * 310, Math.sin(fa) * 310, Math.round(14 * dmgMult));
            }
            spawnBossHazard(e, e.beamAngle, 150, 82, 1.3, Math.round(22 * dmgMult), 0xff2e97, hooks, arenaBoundary);
          } else if (phase === 2) {
            hooks.spawnBeam(e, e.beamAngle - 0.26, -0.26);
            hooks.spawnBeam(e, e.beamAngle + 0.26, 0.26);
            for (const off of [-0.22, 0.22]) {
              const ra = targetAngle + off;
              hooks.spawnEnemyRock(e.x, e.y, Math.cos(ra) * 360, Math.sin(ra) * 360, Math.round(22 * dmgMult));
            }
            const escort: EnemyArchetype[] = wave >= 8 ? ['LANCER', 'VOLT_SPRINTER'] : ['SWARMER', 'PYRO_SPRAYER'];
            for (let i = 0; i < escort.length; i++) {
              const sa = i * Math.PI + Math.random() * 0.5;
              const pos = clampArena(e.x + Math.cos(sa) * 76, e.y + Math.sin(sa) * 76, 20, arenaBoundary);
              hooks.spawnMinion(escort[i]!, pos.x, pos.y);
            }
          } else {
            hooks.spawnBeam(e, e.beamAngle - 0.38, -0.38);
            hooks.spawnBeam(e, e.beamAngle, 0);
            hooks.spawnBeam(e, e.beamAngle + 0.38, 0.38);
            for (let i = 0; i < 8; i++) {
              const na = targetAngle + (i / 8) * Math.PI * 2;
              hooks.spawnProjectile(e.x, e.y, Math.cos(na) * 340, Math.sin(na) * 340, Math.round(15 * dmgMult));
            }
            for (const angOff of [-0.45, 0, 0.45]) {
              spawnBossHazard(e, e.beamAngle + angOff, 185, 84, 1.4, Math.round(22 * dmgMult), 0xff2e97, hooks, arenaBoundary);
            }
            const sa = Math.random() * Math.PI * 2;
            const pos = clampArena(e.x + Math.cos(sa) * 78, e.y + Math.sin(sa) * 78, 22, arenaBoundary);
            const latePool: EnemyArchetype[] = wave >= 8 ? ['MENDER', 'VORTEX_DRONE', 'MINELAYER'] : ['PYRO_SPRAYER', 'GEO_BOMBER'];
            hooks.spawnMinion(latePool[Math.floor(Math.random() * latePool.length)]!, pos.x, pos.y);
          }
        }
      } else if (e.aiState === 'FIRE') {
        const sweepRate = phase === 3 ? 0.38 : phase === 2 ? 0.3 : 0.24;
        e.beamAngle = normalizeAngle(e.beamAngle + sweepRate * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = phase === 3 ? 1.15 : phase === 2 ? 1.4 : 1.7;
        }
      } else {
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = phase === 3 ? 1.2 : phase === 2 ? 1.5 : 1.8;
        }
      }
      break;
    }
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  const clamped = clampArena(e.x, e.y, e.radius + 6, arenaBoundary);
  e.x = clamped.x;
  e.y = clamped.y;

  const contactDist = e.radius + 16;
  const pdx = player.x - e.x;
  const pdy = player.y - e.y;
  if (pdx * pdx + pdy * pdy < contactDist * contactDist) {
    const baseContact =
      e.archetype === 'WARDEN' ? 22 :
      e.archetype === 'LANCER' && e.aiState === 'FIRE' ? 18 :
      e.archetype === 'BASTION' || e.archetype === 'OBELISK' ? 14 : 10;
    const contactDmg = Math.round(baseContact * dmgMult);
    hooks.damagePlayer(contactDmg, e);
  }
}
