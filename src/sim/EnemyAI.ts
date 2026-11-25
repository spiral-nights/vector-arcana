import {
  ARENA_HALF_H,
  ARENA_HALF_W,
  EnemyArchetype,
  EnemyEntity,
  PlayerState,
  SimEvent,
} from './types';

function clampArena(x: number, y: number, pad: number): { x: number; y: number } {
  return {
    x: Math.max(-ARENA_HALF_W + pad, Math.min(ARENA_HALF_W - pad, x)),
    y: Math.max(-ARENA_HALF_H + pad, Math.min(ARENA_HALF_H - pad, y)),
  };
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
  wave: number
): EnemyEntity {
  const hpScale = 1 + Math.max(0, wave - 1) * 0.24;
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
      break;
    case 'STALKER':
      base.radius = 16;
      base.hp = Math.round(85 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.2;
      break;
    case 'WEAVER':
      base.radius = 19;
      base.hp = Math.round(110 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.4;
      break;
    case 'SPLITTER':
      base.radius = 20;
      base.hp = Math.round(135 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.5;
      break;
    case 'WARDEN':
      base.radius = 46;
      base.hp = Math.round(720 + wave * 90);
      base.maxHp = base.hp;
      base.baseArmor = 0.25;
      base.armor = 0.25;
      base.bossShieldAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
      base.aiTimer = 1.6;
      break;
  }

  return base;
}

export interface EnemyAIHooks {
  spawnProjectile: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnBeam: (enemy: EnemyEntity, angle: number) => void;
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
  events: SimEvent[]
): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt);

  if (e.archetype === 'WARDEN') {
    for (let i = 0; i < e.bossShieldAngles.length; i++) {
      e.bossShieldAngles[i] = normalizeAngle(e.bossShieldAngles[i]! + 0.55 * dt);
    }
  }

  if (e.statuses.FROZEN) {
    e.vx *= 0.85;
    e.vy *= 0.85;
    return;
  }

  const speedMult = e.statuses.CHILLED ? 0.5 : 1.0;
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
        hooks.spawnHazard(e.x, e.y, 108, 0.8, 22, 0xe6f0ff);
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
            hooks.spawnProjectile(e.x, e.y, Math.cos(fa) * 320, Math.sin(fa) * 320, 14);
          }
          const blinkAngle = targetAngle + (Math.random() > 0.5 ? 1.05 : -1.05);
          const pos = clampArena(e.x + Math.cos(blinkAngle) * 150, e.y + Math.sin(blinkAngle) * 150, e.radius + 16);
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
        hooks.spawnHazard(player.x, player.y, 72, 1.0, 20, 0xe8741a);
      }
      break;
    }

    case 'WARDEN': {
      e.aiTimer -= dt * speedMult;
      const spd = 38 * speedMult;
      e.vx += (dirX * spd - e.vx) * Math.min(1, 5 * dt);
      e.vy += (dirY * spd - e.vy) * Math.min(1, 5 * dt);
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 1.3;
          e.beamAngle = targetAngle;
        }
      } else if (e.aiState === 'CHARGE') {
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 2.4;
          hooks.spawnBeam(e, e.beamAngle);
          for (let i = 0; i < 2; i++) {
            const sa = i * Math.PI + Math.random() * 0.5;
            const pos = clampArena(e.x + Math.cos(sa) * 70, e.y + Math.sin(sa) * 70, 18);
            hooks.spawnMinion('SWARMER', pos.x, pos.y);
          }
        }
      } else if (e.aiState === 'FIRE') {
        e.beamAngle = normalizeAngle(e.beamAngle + 0.24 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.8;
        }
      } else {
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 2.0;
        }
      }
      break;
    }
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  const clamped = clampArena(e.x, e.y, e.radius + 6);
  e.x = clamped.x;
  e.y = clamped.y;

  const contactDist = e.radius + 16;
  const pdx = player.x - e.x;
  const pdy = player.y - e.y;
  if (pdx * pdx + pdy * pdy < contactDist * contactDist) {
    const contactDmg = e.archetype === 'WARDEN' ? 22 : e.archetype === 'BASTION' ? 14 : 10;
    hooks.damagePlayer(contactDmg, e);
  }
}
