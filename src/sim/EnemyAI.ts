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

export function createEnemy(
  id: number,
  archetype: EnemyArchetype,
  x: number,
  y: number,
  wave: number,
  difficulty?: DifficultyConfig
): EnemyEntity {
  const hpMult = difficulty?.enemyHpMult ?? 1;
  const hpScale = (1 + Math.max(0, wave - 1) * 0.24) * hpMult;
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
    case 'SPLITTER':
      base.radius = 20;
      base.hp = Math.round(135 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.5;
      base.affinity = 'VOLT';
      base.weakness = 'KINETIC';
      break;
    case 'WARDEN':
      base.radius = 48;
      base.hp = Math.round((1450 + wave * 180) * hpMult);
      base.maxHp = base.hp;
      base.baseArmor = 0.28;
      base.armor = 0.28;
      base.bossPhase = 1;
      base.bossShieldAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
      base.aiTimer = 1.4;
      base.affinity = 'VOID';
      break;
  }

  return base;
}

export interface EnemyAIHooks {
  spawnProjectile: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnEnemyRock: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnEnemySpray: (x: number, y: number, angle: number, range: number, damage: number) => void;
  spawnBeam: (enemy: EnemyEntity, angle: number, offsetAngle?: number) => void;
  spawnMinion: (archetype: EnemyArchetype, x: number, y: number) => void;
  spawnHazard: (x: number, y: number, radius: number, delay: number, damage: number, colorHex: number) => void;
  damagePlayer: (amount: number, sourceEnemy?: EnemyEntity) => void;
}

export function stepEnemyAI(
  e: EnemyEntity,
  dt: number,
  player: PlayerState,
  allEnemies: readonly EnemyEntity[],
  hooks: EnemyAIHooks,
  events: SimEvent[],
  difficulty?: DifficultyConfig,
  arenaBoundary: readonly Vec2[] = DEFAULT_RECT_BOUNDARY
): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.nanoMarkTimer = Math.max(0, e.nanoMarkTimer - dt);
  e.freezeImmuneTimer = Math.max(0, e.freezeImmuneTimer - dt);
  const dmgMult = difficulty?.enemyDamageMult ?? 1;
  const spdDiffMult = difficulty?.enemySpeedMult ?? 1;

  if (e.archetype === 'WARDEN') {
    const hpRatio = e.hp / Math.max(1, e.maxHp);
    const phase = hpRatio > 0.65 ? 1 : hpRatio > 0.3 ? 2 : 3;
    e.bossPhase = phase;
    if (hpRatio <= 0.5 && e.bossShieldAngles.length < 4) {
      e.bossShieldAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 130, colorHex: 0xff2e97, duration: 0.35 });
    }
    const plateSpeed = phase === 1 ? 0.65 : phase === 2 ? 0.95 : 1.3;
    for (let i = 0; i < e.bossShieldAngles.length; i++) {
      e.bossShieldAngles[i] = normalizeAngle(e.bossShieldAngles[i]! + plateSpeed * dt);
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

      e.aiTimer -= dt * speedMult;
      if (dist < 115 && e.aiTimer <= 0) {
        e.aiTimer = 2.2;
        hooks.spawnHazard(e.x, e.y, 108, 0.8, Math.round(22 * dmgMult), 0xe6f0ff);
      }
      break;
    }

    case 'STALKER': {
      e.angle = targetAngle;
      e.aiTimer -= dt * speedMult;
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
      e.aiTimer -= dt * speedMult;
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

    case 'SPLITTER': {
      e.angle = targetAngle;
      const spd = 68 * speedMult;
      e.vx += (dirX * spd + sepX - e.vx) * Math.min(1, 7 * dt);
      e.vy += (dirY * spd + sepY - e.vy) * Math.min(1, 7 * dt);

      e.aiTimer -= dt * speedMult;
      if (e.aiTimer <= 0 && dist < 460) {
        e.aiTimer = 2.3;
        hooks.spawnHazard(player.x, player.y, 72, 1.0, Math.round(20 * dmgMult), 0xfff733);
      }
      break;
    }

    case 'PYRO_SPRAYER': {
      e.aiTimer -= dt * speedMult;
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
      e.aiTimer -= dt * speedMult;
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

    case 'WARDEN': {
      e.aiTimer -= dt * speedMult;
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
            hooks.spawnHazard(player.x, player.y, 92, 0.9, Math.round(24 * dmgMult), 0xff2e97);
          }
          if (phase === 3) {
            hooks.spawnHazard(player.x + dirX * 95, player.y + dirY * 95, 86, 1.05, Math.round(22 * dmgMult), 0xff6a00);
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
            hooks.spawnHazard(player.x, player.y, 82, 0.95, Math.round(22 * dmgMult), 0xff2e97);
          } else if (phase === 2) {
            hooks.spawnBeam(e, e.beamAngle - 0.26, -0.26);
            hooks.spawnBeam(e, e.beamAngle + 0.26, 0.26);
            for (const off of [-0.22, 0.22]) {
              const ra = targetAngle + off;
              hooks.spawnEnemyRock(e.x, e.y, Math.cos(ra) * 360, Math.sin(ra) * 360, Math.round(22 * dmgMult));
            }
            const escort: EnemyArchetype[] = ['SWARMER', 'PYRO_SPRAYER'];
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
              hooks.spawnHazard(
                player.x + Math.cos(targetAngle + angOff) * 75,
                player.y + Math.sin(targetAngle + angOff) * 75,
                84,
                0.9,
                Math.round(22 * dmgMult),
                0xff2e97
              );
            }
            const sa = Math.random() * Math.PI * 2;
            const pos = clampArena(e.x + Math.cos(sa) * 78, e.y + Math.sin(sa) * 78, 22, arenaBoundary);
            hooks.spawnMinion(Math.random() < 0.5 ? 'PYRO_SPRAYER' : 'GEO_BOMBER', pos.x, pos.y);
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
    const contactDmg = Math.round((e.archetype === 'WARDEN' ? 22 : e.archetype === 'BASTION' ? 14 : 10) * dmgMult);
    hooks.damagePlayer(contactDmg, e);
  }
}
