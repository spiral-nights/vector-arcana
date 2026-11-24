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
  const hpScale = 1 + Math.max(0, wave - 1) * 0.12;
  const base: EnemyEntity = {
    id,
    archetype,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 12,
    hp: 25,
    maxHp: 25,
    shieldHp: 0,
    maxShieldHp: 0,
    armor: 0,
    baseArmor: 0,
    shieldAngle: 0,
    shieldArc: 1.15,
    hasFrontShield: false,
    bossShieldAngles: [],
    aiState: 'SEEK',
    aiTimer: 1.5,
    beamAngle: 0,
    statuses: {},
    hitFlash: 0,
  };

  switch (archetype) {
    case 'SWARMER':
      base.radius = 11;
      base.hp = Math.round(22 * hpScale);
      base.maxHp = base.hp;
      break;
    case 'BASTION':
      base.radius = 22;
      base.hp = Math.round(115 * hpScale);
      base.maxHp = base.hp;
      base.baseArmor = 0.4;
      base.armor = 0.4;
      base.hasFrontShield = true;
      base.shieldHp = Math.round(120 * hpScale);
      base.maxShieldHp = base.shieldHp;
      base.shieldArc = 1.15;
      break;
    case 'STALKER':
      base.radius = 15;
      base.hp = Math.round(55 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.4;
      break;
    case 'WEAVER':
      base.radius = 18;
      base.hp = Math.round(75 * hpScale);
      base.maxHp = base.hp;
      base.aiTimer = 1.6;
      break;
    case 'SPLITTER':
      base.radius = 19;
      base.hp = Math.round(95 * hpScale);
      base.maxHp = base.hp;
      break;
    case 'WARDEN':
      base.radius = 44;
      base.hp = Math.round(650 + wave * 80);
      base.maxHp = base.hp;
      base.baseArmor = 0.25;
      base.armor = 0.25;
      base.bossShieldAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
      base.aiTimer = 2.0;
      break;
  }

  return base;
}

export interface EnemyAIHooks {
  spawnProjectile: (x: number, y: number, vx: number, vy: number, damage: number) => void;
  spawnBeam: (enemy: EnemyEntity, angle: number) => void;
  spawnMinion: (archetype: EnemyArchetype, x: number, y: number) => void;
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
      e.bossShieldAngles[i] = normalizeAngle(e.bossShieldAngles[i]! + 0.75 * dt);
    }
  }

  // Frozen enemies cannot move or act
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

  // Separation force from nearby enemies
  let sepX = 0;
  let sepY = 0;
  for (const other of allEnemies) {
    if (other.id === e.id) continue;
    const odx = e.x - other.x;
    const ody = e.y - other.y;
    const minD = e.radius + other.radius + 6;
    const d2 = odx * odx + ody * ody;
    if (d2 > 0.01 && d2 < minD * minD) {
      const d = Math.sqrt(d2);
      const push = (minD - d) / minD;
      sepX += (odx / d) * push * 130;
      sepY += (ody / d) * push * 130;
    }
  }

  switch (e.archetype) {
    case 'SWARMER': {
      e.angle = targetAngle;
      const spd = 145 * speedMult;
      e.vx += (dirX * spd + sepX - e.vx) * Math.min(1, 10 * dt);
      e.vy += (dirY * spd + sepY - e.vy) * Math.min(1, 10 * dt);
      break;
    }

    case 'BASTION': {
      const diff = normalizeAngle(targetAngle - e.angle);
      const maxTurn = 1.65 * speedMult * dt;
      e.angle = normalizeAngle(e.angle + Math.max(-maxTurn, Math.min(maxTurn, diff)));
      e.shieldAngle = e.angle;
      const spd = 72 * speedMult;
      e.vx += (dirX * spd + sepX * 0.5 - e.vx) * Math.min(1, 7 * dt);
      e.vy += (dirY * spd + sepY * 0.5 - e.vy) * Math.min(1, 7 * dt);
      break;
    }

    case 'STALKER': {
      e.angle = targetAngle;
      e.aiTimer -= dt * speedMult;
      if (e.aiState === 'SEEK') {
        const desired = 210;
        const radial = dist > desired + 25 ? 1 : dist < desired - 25 ? -0.8 : 0;
        const strafeX = -dirY * 0.8;
        const strafeY = dirX * 0.8;
        const spd = 120 * speedMult;
        e.vx += ((dirX * radial + strafeX) * spd + sepX - e.vx) * Math.min(1, 8 * dt);
        e.vy += ((dirY * radial + strafeY) * spd + sepY - e.vy) * Math.min(1, 8 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'TELEPORT_WINDUP';
          e.aiTimer = 0.45;
          events.push({ type: 'vfx_ring', x: e.x, y: e.y, radius: 28, colorHex: 0x00f5ff, duration: 0.3 });
        }
      } else if (e.aiState === 'TELEPORT_WINDUP') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        if (e.aiTimer <= 0) {
          const blinkAngle = targetAngle + (Math.random() > 0.5 ? 0.9 : -0.9);
          const pos = clampArena(e.x + Math.cos(blinkAngle) * 140, e.y + Math.sin(blinkAngle) * 140, e.radius + 10);
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 10, radius: 30 });
          e.x = pos.x;
          e.y = pos.y;
          events.push({ type: 'vfx_burst', x: e.x, y: e.y, colorHex: 0x00f5ff, count: 10, radius: 30 });
          const fireAngle = Math.atan2(player.y - e.y, player.x - e.x);
          hooks.spawnProjectile(e.x, e.y, Math.cos(fireAngle) * 360, Math.sin(fireAngle) * 360, 12);
          e.aiState = 'SEEK';
          e.aiTimer = 1.9;
        }
      }
      break;
    }

    case 'WEAVER': {
      e.aiTimer -= dt * speedMult;
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        const desired = 270;
        const move = dist > desired + 30 ? 1 : dist < desired - 30 ? -0.7 : 0;
        const spd = 88 * speedMult;
        e.vx += (dirX * move * spd + sepX - e.vx) * Math.min(1, 7 * dt);
        e.vy += (dirY * move * spd + sepY - e.vy) * Math.min(1, 7 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.85;
          e.beamAngle = targetAngle;
        }
      } else if (e.aiState === 'CHARGE') {
        e.vx *= 0.85;
        e.vy *= 0.85;
        e.angle = e.beamAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 1.8;
          hooks.spawnBeam(e, e.beamAngle);
        }
      } else if (e.aiState === 'FIRE') {
        e.vx *= 0.85;
        e.vy *= 0.85;
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.2;
        }
      } else {
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.6;
        }
      }
      break;
    }

    case 'SPLITTER': {
      e.angle = targetAngle;
      const spd = 88 * speedMult;
      e.vx += (dirX * spd + sepX - e.vx) * Math.min(1, 8 * dt);
      e.vy += (dirY * spd + sepY - e.vy) * Math.min(1, 8 * dt);
      break;
    }

    case 'WARDEN': {
      e.aiTimer -= dt * speedMult;
      const spd = 54 * speedMult;
      e.vx += (dirX * spd - e.vx) * Math.min(1, 5 * dt);
      e.vy += (dirY * spd - e.vy) * Math.min(1, 5 * dt);
      if (e.aiState === 'SEEK') {
        e.angle = targetAngle;
        if (e.aiTimer <= 0) {
          e.aiState = 'CHARGE';
          e.aiTimer = 0.9;
          e.beamAngle = targetAngle;
        }
      } else if (e.aiState === 'CHARGE') {
        if (e.aiTimer <= 0) {
          e.aiState = 'FIRE';
          e.aiTimer = 2.2;
          hooks.spawnBeam(e, e.beamAngle);
          // Spawn 4 swarmers around hull
          for (let i = 0; i < 4; i++) {
            const sa = (i / 4) * Math.PI * 2;
            const pos = clampArena(e.x + Math.cos(sa) * 65, e.y + Math.sin(sa) * 65, 16);
            hooks.spawnMinion('SWARMER', pos.x, pos.y);
          }
        }
      } else if (e.aiState === 'FIRE') {
        e.beamAngle = normalizeAngle(e.beamAngle + 0.35 * dt);
        if (e.aiTimer <= 0) {
          e.aiState = 'COOLDOWN';
          e.aiTimer = 1.6;
        }
      } else {
        if (e.aiTimer <= 0) {
          e.aiState = 'SEEK';
          e.aiTimer = 1.8;
        }
      }
      break;
    }
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  const clamped = clampArena(e.x, e.y, e.radius + 4);
  e.x = clamped.x;
  e.y = clamped.y;

  // Contact damage with player
  const contactDist = e.radius + 16;
  const pdx = player.x - e.x;
  const pdy = player.y - e.y;
  if (pdx * pdx + pdy * pdy < contactDist * contactDist) {
    const contactDmg = e.archetype === 'WARDEN' ? 24 : e.archetype === 'BASTION' ? 16 : 10;
    hooks.damagePlayer(contactDmg, e);
  }
}
