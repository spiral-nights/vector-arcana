# AGENTS.md

Guidance for AI agents working in this repository. See `README.md` for the game pitch and
`docs/` for design/architecture prose. This file covers what you actually need to change code.

## Project

Vector Arcana is a single-player, top-down 2.5D arcade horde roguelite: a browser game built with
Three.js, Vite, TypeScript (strict) and Vitest. No framework, no asset pipeline: every mesh,
particle and HUD glyph is generated in code.

## Commands

```bash
pnpm install     # honors the 14-day minimum dependency age (see below)
pnpm dev         # Vite dev server (http://localhost:5173)
pnpm test        # vitest run, node environment, src/**/*.test.ts
pnpm typecheck   # tsc --noEmit
pnpm build       # tsc --noEmit && vite build   (this is what CI runs)
```

There is no lint step and no formatter configured; `tsc` is the only static gate. `pnpm build`
typechecks first, so a type error fails the deploy.

CI (`.github/workflows/deploy-pages.yml`) runs `pnpm install --frozen-lockfile`, then `pnpm test`,
then `pnpm build`, and publishes `dist/` to GitHub Pages on every push to `main`. `vite.config.ts`
sets `base: './'` so the bundle works from a subpath; do not change it to an absolute base.

### Dependency policy (gotcha)

`pnpm-workspace.yaml` (`minimumReleaseAge: 20160`) and `.npmrc` (`min-release-age=14`) forbid
installing any package version published less than 14 days ago. Adding a brand-new release will
fail to resolve; pick an older version or add the dep without a fresh pin. `packageManager` is
pinned to `pnpm@12.4.2`; the lockfile is `lockfileVersion: '9.0'` and CI uses `--frozen-lockfile`,
so commit `pnpm-lock.yaml` with any dependency change. The project runs on a single root package
(`pnpm-workspace.yaml` lists only `.`), so there is no monorepo indirection.

## Architecture

The one rule that matters: **`src/sim/` never imports Three.js and never touches DOM or browser
APIs** (no `window`, `document`, `AudioContext`, `localStorage`). This is enforced by convention
only, `tsc` will happily let you violate it. Unit tests import the sim directly in Node, so any
browser dependency added there breaks the test suite at import time.

```text
src/
  main.ts              fixed-timestep loop, all input bindings, SimEvent router
  settings.ts          GameSettings, localStorage load/save with per-field validation
  style.css            global styling, HUD + comic callout fonts
  sim/                 pure 2D deterministic simulation (no rendering, no DOM)
    types.ts           every shared type: elements, entities, SimInput, SimEvent, SimSnapshot
    GameSim.ts         facade: owns player state, combat, wave director, augments, event queue
    CombatEngine.ts    ~3.2k lines: hitboxes, beams, mines, storms, walls, combos, augments
    SpellResolver.ts   queue cancellation/fusion + the 10-delivery priority table
    EnemyAI.ts         per-archetype enemy behaviours, wave scaling
    WaveDirector.ts    sector arenas, wave composition, boss cadence, spawn rifts, gate
    Augments.ts        augment catalog + 3-card draft roll
    ArenaGeometry.ts   convex polygon math: containment, clamping, ray clipping
    Ships.ts           ship catalog + difficulty catalog
  render/              Three.js layer: scene, bloom, grid, entity meshes, spell VFX, shaders
  audio/               Web Audio synth SFX + music player
  ui/                  SVG/DOM HUD, augment modal, high scores
```

### Data flow (single direction per frame)

1. `main.ts` frame loop accumulates `rawDt` and runs `sim.step(input)` in a `while` loop at
   `FIXED_DT = 1/60` (`src/sim/types.ts:1`). Inputs are one-shot flags consumed each step:
   `pendingQueue`/`pendingCast`/`pendingDash` are cleared after every `step`, while held state
   (`lmbDown`, `keysDown`) is recomputed per step.
2. `sim.step()` early-returns unless `phase === 'PLAYING'`.
3. Each step, `GameSim` re-pushes run config into `CombatEngine`
   (`setAugments`, `setRunConfig`, `setArenaGeometry`), so mutating `sim.augments` or the wave
   director's arena between steps is sufficient and safe.
4. Sim systems push typed `SimEvent`s into an internal array. `main.ts` calls `sim.drainEvents()`
   and dispatches each event to the renderer/audio/HUD (see the `if/else` chain in
   `main.ts`, ~line 330 onward). Unknown event types are ignored silently.
5. Renderers pull a read-only `SimSnapshot` via `sim.getSnapshot()`; the HUD is updated at ~20 Hz
   (`hudTimer >= 0.05`), not every frame.

Player movement lives in `GameSim.step`: walk speed is `190 * ship.speedMult`, scaled to 0.68
while channelling a beam/spray and 0.65 while charging a rock/shards; dash is `235 / 0.19` world
units per second. `moveClickTarget`, arrow keys and hold-to-move all funnel into the same
accelerate-toward-target block, then get clamped against the arena and pushed out of pillars,
blocks and obstacles.

Adding a new gameplay effect therefore means: add a variant to the `SimEvent` union in
`src/sim/types.ts`, emit it from the sim, handle it in the dispatch chain in `main.ts`, and add a
method on the receiving renderer. Nothing subscribes or polls; if you forget the `main.ts` branch,
the event is dropped.

### Spell resolution

`resolveSpell(queue, castMode)` in `src/sim/SpellResolver.ts:267` is a **strict top-to-bottom
`if/else if` chain** — the order of the branches *is* the spell priority table. Current ranking:
`DASH → PHASE_SLASH` shortcut, then `BARRIER` alone → `SHIELD`, `BARRIER+KINETIC|CRYSTAL` → `WALL`,
`BARRIER+VOLT` → `STORM` (even with `VOID|NANO` attached), `BARRIER+VOID|NANO` → `MINES`,
`BARRIER+elemental` → `STORM`, then `KINETIC` → `ROCK_THROW`, `CRYSTAL` → `CRYSTAL_SHARDS`,
`VOLT` → `LIGHTNING_BOLT` (outranks `VOID|NANO`, which stay attached as elements), `VOID|NANO` →
`BEAM` (beats lightning when `PLASMA` is also present), remaining elemental
→ `SPRAY`. Inserting a branch anywhere but its correct priority silently reclassifies every
ambiguous composition, and `src/sim/SpellResolver.test.ts` pins the outcomes.
There is **no self-cast**: `CastMode` is only `'FORWARD' | 'NOVA' | 'DASH'`, and every cast goes
through `castSpell`/`startChannel`/`startCharge`. The old per-element self-cast resolver and its
`PlayerState` ward effect were deleted, so `wardRemaining`/`wardElement` stay at zero (the damage
rule and renderer arcs remain but are dormant); player armor now only comes from a ship's
`startArmor`, the gate restore, and `PHASE_RESONANCE` dash stacks.

Queue mutation (`enqueueElement`, `:51`) runs four steps **in this order**: 1-for-1 cancellation
from `CANCELLATION_MAP` (asymmetric: VOLT eats FLUX *and* KINETIC, FLUX only eats VOLT; the
incoming element is consumed, not added), then the single-BARRIER cap, then fusion
(`FLUX+CRYO → CRYSTAL`, `FLUX+THERMAL → PLASMA`, partner is replaced in place so length does not
grow), then capacity. `MAX_QUEUE_SIZE = 3`, overflow `'IGNORE'` in-game. Sub-elements are only
reachable through fusion. Everything downstream (rock size, spray range, mine count) is derived
from `computeComposition(...).totalPower` and per-element `counts`.

### Statuses and combos

`StatusType` is `PRIMED | CHILLED | FROZEN | IGNITED | CORRUPTED`; `CORRUPTED` is declared but
never applied (NANO uses the scalar `EnemyEntity.nanoMarkTimer`). All application logic is in
`applyElementalStatuses` (`src/sim/CombatEngine.ts:1718`) and the payoff logic earlier in
`applyElementalHit` (`:1464`):

- `FLUX` or `PLASMA` primes (`PRIMED` 5 s); `CRYO`/`CRYSTAL` on a primed enemy freezes it
  (`FROZEN` 2.5 s) directly, otherwise chills it. `THERMAL` thaws and ignites.
- `PRIMED` + `VOLT` → overload (`×1.4` damage plus splash). `FROZEN` + `KINETIC|VOID` → shatter
  (`+55` flat, radial shards, 3.5 s freeze immunity).
- Any blocked hit (front shield arc, boss rotating plate) **returns before** applying statuses or
  emitting a damage number, so "my CRYO did nothing" is usually a shield facing the beam.
- Armor is a divisor (`dmg / (1 + armor)`), halved while `IGNITED`; several DoT and splash paths
  deliberately bypass armor — copy the neighbouring expression rather than inventing one.

### State and entities

All sim entities are plain objects with numeric `id`s in arrays owned by `CombatEngine`; there is
no ECS and no pooling for entities. **`getSnapshot()` aliases that live state** for `player`,
`enemies` and every entity array — renderers must treat it as strictly read-only (mutating it
corrupts the simulation). Only `augments` and `pendingAugments` are copied. Dead entities are
removed from the arrays, so never cache snapshot indices across steps.

`this.pools` (`PoolEntity`) is dead code: declared, reset and rendered, but nothing ever spawns a
pool. Ground effects are `hazards`.

Ids come from a single monotonic `combat.nextId`; spawn helpers allocate them. Never hand out ids
yourself — `hitIds`, `ownerEnemyId` and cached beam ids all compare against it.

Notable caps: exactly one player shield can exist (`this.shields.length = 0` precedes every SHIELD
cast), `MAX_STORMS = 1`, `MAX_MINES = 8`, `MAX_WALL_PYLONS = 16`, score `multiplier` capped at 16.

### Geometry and ordering invariants

- Arena boundaries and obstacles are **convex, counter-clockwise** polygons. `createConvexObstacle`
  reverses vertices when the signed area is negative; break that and every ray/normal test inverts.
- Forcefield walls are polylines between consecutive pylons of the same `groupId` in **array
  order**, so splicing or reordering `walls` changes the collision surface.
- Enemy death is only processed at the end of `CombatEngine.step`, and `GameSim.step` runs
  `waveDirector.step` *before* `combat.step` (so a corpse still counts as an active enemy for one
  tick) and checks the sector gate *after* combat.

### Extending the sim

Each of these is a multi-file change; miss a step and the feature silently half-works:

- **New `SimEvent`**: add to the union in `src/sim/types.ts:506`, add an `else if (ev.type === ...)`
  branch in the drain loop in `src/main.ts` (~`:371`). There is no exhaustiveness check, so an
  unhandled event is dropped without error.
- **New entity type**: interface + snapshot field in `types.ts`, array + reset in
  `CombatEngine.reset()` *and* `clearTransientForSector()`, spawn helper, update loop in `step`,
  field in `GameSim.getSnapshot()`, plus a `sync...` call in `src/render/SpellVFX.ts`.
- **New enemy archetype**: `EnemyArchetype` union, a `case` in `createEnemy`, a `case` in
  `stepEnemyAI` (a missing case leaves the enemy passively clamping and dealing contact damage),
  the kill-colour ladder in the death loop, the score ladder (`WaveDirector.ts` `onEnemyKilled`),
  `ARCHETYPE_POOL`, `getEnemyWatercolorPalette` plus both mesh builders in
  `src/render/EntityRenderer.ts`, and the minimap colour in `src/ui/HUD.ts`.
- **New augment**: extend `AugmentId`, add a catalog entry in `src/sim/Augments.ts`, then add
  inline `getAugmentStacks(this.augments, 'ID')` checks at each effect site (there is no dispatch
  table; effects are read where they apply).

### Enemies

`src/sim/EnemyAI.ts` is fully decoupled from the engine: `stepEnemyAI(enemy, ctx, hooks)` mutates one
enemy and reaches back only through the `EnemyAIHooks` interface. Ground hazards (`hooks.spawnHazard`)
are only ever placed at the caster's own position or via `spawnBossHazard` (a telegraphed offset in
front of the boss); never spawn one at `player.x/player.y` — that is the "cheap unavoidable attack"
designer bug this codebase has already fixed twice (SPLITTER removed, WARDEN/MINELAYER retargeted). Behaviours are a `switch` on
`archetype` sharing one `aiState` enum (`SEEK | CHARGE | FIRE | TELEPORT_WINDUP | COOLDOWN`) plus an
`aiTimer`; scratch fields `beamAngle` and `spinPhase` are overloaded per archetype. `FROZEN`
short-circuits the AI after the boss plate rotation, so do not assume a frozen Warden stops moving
its plates. The Warden recomputes `bossPhase` from its HP ratio every tick (>0.65 / >0.3 / else) and
switches from 3 to 4 shield plates below 50% HP.

### Waves, sectors, scoring

`WaveDirector` regenerates the whole sector arena on wave change (`generateSectorArena`), so new
obstacle/arena work belongs there. Cadence facts worth knowing before tuning:

- Boss sector every `sector % 5 === 0`; non-boss sectors cycle 6 hand-built layouts.
- Enemy HP scaling: `(1 + (wave-1)*0.24) * 1.08^max(0, wave-3)`, times difficulty `enemyHpMult`,
  times 1.65 for elites. Armor grows +0.03/wave after wave 3, capped at 0.75.
- Spawn rifts telegraph ~2 s and place squad members on a radius-44 circle; every spawn position
  passes through `pushPointClearOfObstacles`, so new spawn helpers must too.
- Anti-stall: with zero active enemies but pending rifts, every rift timer is clamped to 1.2 s.
- The exit gate sits at `span.maxX - 36, y = 0, radius 68` and opens only when rifts are empty
  *and* no enemies remain. Walking into it advances the sector: heal 25, restore starter armor,
  clear transient combat state, roll a 3-card augment draft, `phase = 'AUGMENT_CHOICE'`.
- Kills grant `basePoints * (elite?2:1) * multiplier * scoreMult`, bump `multiplier` by 1 (cap 16)
  and reset its 4 s timer; taking damage resets it to 1.
- Augment drafts use `rollAugmentChoices(rng, 3, owned, recentlyOffered)` with an injectable `rng`
  (tests pass a constant). The pool falls back to the full catalog when every augment is maxed, so
  duplicates can reappear late in a run.


## Rendering, audio, UI

### Frame order (do not reorder)

`main.ts` runs, in this exact order each frame: watercolor time update (only in `WATERCOLOR_INK`),
hit-stop early-out (render + music only, no sim, no VFX/HUD), fixed-step sim loop, then
`spellVFX.setBlockedScene(preDrainSnapshot)` **before** `sim.drainEvents()`, then the event dispatch
chain, then `warpingGrid.update` / `entityRenderer.update` / `motionTrails.update` /
`spellVFX.update`, then the throttled HUD update, then `sceneManager.render`.
`setBlockedScene` must stay before the drain: spray/lightning VFX clip against the geometry snapshot
that existed when the events were produced.

### Render modules

- `SceneManager` owns the renderer, camera, bloom composer, screen shake, impact post pass and all
  screen↔world conversion. The camera is a `PerspectiveCamera` (the docs' "orthographic" claim is
  wrong) positioned top-down; tilt is 26°, not the 8° the docs and README mention.
- `WarpingGrid` is a 56 × 38 spring lattice (2,128 vertices) in preallocated `Float32Array`s; it
  accepts radial impulses / gravity wells / colour splashes and has no per-frame allocation.
- `EntityRenderer` batches the player ship, enemies, walls, mines, beams, shields, hazards and pips
  into preallocated instanced/line meshes; geometry is created once at construction and only
  transforms/colours change per frame.
- `SpellVFX` is ~4.7k lines and owns every particle system, plus a pool per particle flavour
  (orb 2400, spark 1200, fire/water/plasma/snow 900 each, cross 800, plus streaks, ink droplets and
  floor decals). Pools are fixed-capacity: adding emissions without raising a pool size will silently
  starve existing effects. `setParticleQuality` scales emission counts, not pool sizes.
- `MotionTrails`/`SpaceBackdrop` are purely additive ambience and consume only the snapshot.
- Shader code lives in `NeonShaders.ts` (GLSL strings + material factories); `GlowUtil.ts` is the
  shared additive/glow helper. Prefer reusing these factories over writing raw `ShaderMaterial`s.

### Art styles

`ArtStyle` is `'VECTOR_NEON' | 'WATERCOLOR_INK'` (`src/settings.ts`), persisted and validated like
every other setting. Every visual module implements `setArtStyle(style)`; settings changes are
broadcast from the single `applyAllSettings` function in `main.ts`, so a new style-sensitive module
must be added there or it will not react. `SpellVFX.setArtStyle` fans out to each pool and needs the
watercolor textures from `WatercolorAssets.getWatercolorAssets()`. `setWatercolorTime()` in
`WatercolorAssets.ts` drives one shared `WATERCOLOR_TIME_UNIFORM` and is only ticked in watercolor
sessions, so shaders must not assume the clock advances.

### Audio

`SynthAudio.play(sound: SfxId, colorHex?, elements?)` is a `switch` over the `SfxId` union in
`src/sim/types.ts`; all sound is procedural Web Audio, there are no sample files. Adding a sound
means: extend `SfxId`, add the `case` in `SynthAudio.ts`, emit `{ type: 'sfx', sound, elements }`
from the sim. `MusicPlayer` streams `music/Last_Quarter_Surge.mp3` (~157 s) and needs `setPhase(snapshot.phase)`
each frame plus `restart()` on a new run. Both require a user-gesture `unlock()` (already wired into
every mouse/key handler); never start audio without it.

Looping uses two `HTMLAudioElement` decks crossfading at `min(TARGET_FADE_START_SEC, duration - 4)`.
Both decks also have `loop = true` as a safety net, and a rejected `next.play()` (browser autoplay
policy blocking the second element) aborts the crossfade instead of promoting a silent deck. Without
those two guards the track stops dead at the end of the first play-through. `src/audio/MusicPlayer.test.ts`
simulates the decks headlessly with a fake `Audio` element — keep that test green when touching the
fade math, and remember its loop is async because the `play()` rejection runs as a microtask.

### HUD

`HUD` builds all of its markup into `#hud` in its constructor (no template files) and exposes
imperative methods: `update(snapshot, highScores, shiftHeld)` (throttled to ~20 Hz by `main.ts`),
`applySettings`, `spawnComicCallout`, `spawnFloatingText`, `showWaveBanner`, `showGateOpenBanner`,
`triggerDamageFlash`. It owns the minimap canvas. All engine interaction happens through the
callbacks passed to its constructor (`onStartGame`, `onPickAugment`, `onRestartRun`,
`onSettingsChange`, `onResetSettings`, `onToggleTilt`, `onToggleControls`, `onToggleMute`,
`onTogglePause`) — the HUD never imports the sim's mutable state or drives the game directly, so new
UI actions need both a callback and a branch in `applyAllSettings` or the sim-facing dispatch.
Styling lives in `src/style.css`; comic callout fonts (Bangers, Comic Neue) come from Google Fonts in
`index.html`, so offline builds fall back to system fonts — do not rely on exact glyph metrics.

## Testing

`vite.config.ts` (root) sets `test.environment: 'node'` and `include: ['src/**/*.test.ts']`. Tests are
plain Vitest files colocated with the code, 5 files / ~98 tests today, runtime ~1 s.

Existing tests drive the real simulation rather than mocks:

```ts
function makeInput(overrides: Partial<SimInput> = {}): SimInput { /* all fields defaulted */ }

const sim = new GameSim();                        // starts directly in 'PLAYING'
sim.step(makeInput({ queuedElements: ['BARRIER', 'VOID'] }));
sim.combat.spawnEnemy('BASTION', 200, 0, 1);      // tests reach into public GameSim fields
const ev = sim.drainEvents().find((e) => e.type === 'vfx_spray');
```

Use `sim.combat` (public `readonly` field), `sim.augments`, `sim.waveDirector` for setup, and assert
on `getSnapshot()` contents or drained events. `src/settings.test.ts` shows the pattern for
browser-API code: it swaps `globalThis.window` for a fake `localStorage` and restores it in
`afterEach`.

**Determinism caveat:** there is no seeded RNG. The sim calls global `Math.random()` in ~20 places,
split between purely cosmetic jitter (damage-number offsets, particle trails, sfx throttles) and
gameplay-affecting rolls (storm strike placement, splitter spawn angle, stalker blink side, Warden
escort angles). Avoid asserting on positions of AI enemies that have ticked for many frames; place
enemies and cast immediately, or assert on quantities (counts, damage, statuses) instead. The only
injectable randomness is the augment draft (`rollAugmentChoices(rng, ...)`).

## Conventions

- TypeScript is strict plus `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`,
  `noFallthroughCasesInSwitch`. Indexed access yields `T | undefined`, which is why the codebase
  is full of `arr[0]!` and `obj[key] ?? fallback`. Unused locals/params are **errors**; prefix or
  delete them rather than leaving dead values.
- Imports use `allowImportingTsExtensions` but the code imports without extensions
  (`'./ArenaGeometry'`); follow that.
- Each module exports a class (`GameSim`, `CombatEngine`, `WaveDirector`, `HUD`, `SpellVFX`, ...)
  plus free functions for pure math (`ArenaGeometry.ts`) and catalog constants
  (`ELEMENT_META`, `SHIP_CATALOG`, `DIFFICULTY_CATALOG`, `AUGMENT_CATALOG`).
- Colours are duplicated as both `color: '#RRGGBB'` (CSS/HUD) and `colorHex: 0xRRGGBB` (WebGL);
  when adding a colour source, provide both. `ELEMENT_META` in `src/sim/types.ts` is the single
  source of truth for element colours.
- Data catalogs are `readonly T[] as const` plus a `getX(id)` accessor that never throws and falls
  back to entry `0` (`getShipDef`, `getDifficultyConfig`, `getAugmentDef`). Keep that contract when
  adding entries.
- Domain enum values are `SCREAMING_SNAKE_CASE` (`'FROZEN'`, `'ROCK_THROW'`, `'OVERLORD'`), class
  and type names are `PascalCase`, entity timers end in `Timer`/`Cooldown`/`Remaining`, and
  `SimEvent` type strings are snake_case prefixed by category (`vfx_*`, `grid_*`).
- Priority tables are written as `else if` chains because order is the semantics; `switch` is only
  used for exhaustive per-variant dispatch (`castSpell`, `createEnemy`, `stepEnemyAI`,
  `generateArenaBoundary`). Numbered comments like `// 1. Opposite element cancellation` document
  required ordering — keep them when editing those blocks.
- `src/sim/CombatEngine.ts` and `src/render/SpellVFX.ts` are the two giant files (3.2k / 4.7k
  lines) and hold many `private` helpers. Edit surgically with exact-match edits and keep related
  helpers adjacent; do not reformat them.
- Commit subjects follow `feat:` / `fix:` / `fix(render):` / `ci:` with lowercase descriptions.
  Branches in use: `main` (deploys), `develop`, `styling`.

## Gotchas

- **`docs/` is stale.** `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` describe an earlier scope:
  6 enemy archetypes, 6 augments, arena `[-560, 560] × [-380, 380]`, an orthographic camera with
  an "8° tilt", and a `48 × 48` warping grid. The code has 15 archetypes in `EnemyArchetype`, 20
  augments in `AUGMENT_CATALOG`, `ARENA_HALF_W = 1100` / `ARENA_HALF_H = 750`
  (`src/sim/types.ts`), a `PerspectiveCamera` tilted 26°, and a 56 × 38 grid. `docs/DESIGN.md` also
  lists element hex colours that differ from `ELEMENT_META`. Trust the code, not the docs.
- Hit-stop is implemented in `main.ts`, not the sim: when a `hit_stop` event arrives the loop
  renders and skips simulation entirely for the duration.
- Mouse buttons: LMB moves (Classic) or forward-casts (Arrows+LMB), RMB forward-casts / Nova with
  Shift, **MMB is an Area Nova cast** in both presets. MMB is handled in the `mousedown` branch for
  `button === 1`; it does not set any held flag, so it fires once per press.
- `contextmenu`/`auxclick` are suppressed with capture-phase listeners and held inputs are cleared
  on `blur`/`visibilitychange`. When adding input paths, add them to `clearHeldInputs` handling or
  the game will act on stale keys after tab switches.
- Mouse aiming goes through `sceneManager.screenToWorld`, which intersects the mathematical `z = 0`
  plane; never hand-roll NDC math for pointer positions — the tilted camera makes naive math wrong.
- The music track is imported as a Vite asset URL (`music/Last_Quarter_Surge.mp3` via
  `src/audio/MusicPlayer.ts`) and typed by `declare module '*.mp3'` in `src/vite-env.d.ts`.
  `images/` is currently empty; there is no other external art.
- Audio must be unlocked by a user gesture (`synthAudio.unlock()` / `musicPlayer.unlock()` are
  called from every mouse/key handler). New audio triggers need the same unlock path.
