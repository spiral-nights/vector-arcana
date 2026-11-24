# Vector Arcana — Development Roadmap

## Milestone 0: Repository, Package Policy & Documentation
- Initial `README.md` committed on `main`.
- Development branch `develop` created from `main`.
- `docs/ROADMAP.md`, `docs/DESIGN.md`, and `docs/ARCHITECTURE.md` committed on `develop`.
- `pnpm` configured with `minimumReleaseAge: 20160` (14 days / 2 weeks) in `pnpm-workspace.yaml` and `.npmrc` (`min-release-age=14`).
- Vite + TypeScript (strict) + Three.js + Vitest scaffolded and verified.

**Acceptance:** `pnpm install` honors the 14-day release-age cutoff; `pnpm typecheck` passes cleanly.

---

## Milestone 1: Arena, Warping Grid, Arrow-Ship & Classic Controls
- `SceneManager.ts`: Locked top-down `OrthographicCamera` with toggleable 8° depth tilt, accurate `z = 0` plane raycasting, `EffectComposer` + `UnrealBloomPass` + `OutputPass`, screen-shake, and hit-stop.
- `WarpingGrid.ts`: `48 × 48` 2D spring-mass vertex lattice with radial impulses, inward gravity wells, and zero-allocation buffer updates.
- `EntityRenderer.ts` (foundation): Asymmetrical neon wireframe arrow-ship construct, rear thruster wake, and diegetic hull/ward arcs.
- `GameSim.ts` (foundation): Fixed 60 Hz step, Classic movement (`LMB` toward cursor + `Arrow Keys`), smooth cursor aim, and `Shift` / `Shift + LMB` Phase Dash with grid ripples.
- `HUD.ts` (shell): Top bar + 8-element SVG glyph hotbar (`Q W E R` / `A S D F`).

**Verification:** `pnpm typecheck && pnpm build`.

---

## Milestone 2: 8-Element Queue & 10-Spell Deterministic Engine
- `SpellResolver.ts`: Pure queue engine implementing all 5 opposite-element cancellations (`THERMAL ↔ CRYO`, `FLUX ↔ VOLT`, `KINETIC ↔ VOLT`, `BARRIER ↔ VOLT`, `VOID ↔ NANO`), max-1 `BARRIER` cap, FIFO/IGNORE overflow, 3 sub-element fusions (`CRYSTAL`, `PLASMA`, `TOXIN`), and the strict 10-spell priority table.
- `SpellResolver.test.ts`: Full Vitest coverage of cancellations, fusions, priority edge cases, Nova casts, and Self casts.
- `CombatEngine.ts`: Full 2D arena execution for all 10 delivery types (`Shield`, `Wall`, `Mines`, `Storm`, `Rock Throw`, `Crystal Shards`, `Beam`, `Lightning Bolt`, `Spray`, `Phase Slash`), Nova (`Space` / `Shift + RMB`), and Self (`MMB`/`C`).
- `EntityRenderer.ts` & `SpellVFX.ts`: 3 orbiting elemental glyph pips around the ship + procedural 3D wireframe VFX for all 10 spells and grid puddles.

**Verification:** `pnpm test && pnpm typecheck && pnpm build`.

---

## Milestone 3: 6 Enemy Archetypes, Primer Combos & Wave Director
- Primer & status combo matrix in `CombatEngine.ts`:
  - `PRIMED` (`FLUX`/`PLASMA`): `2.0×` `VOLT` damage & `2×` chain range; instant `FROZEN` on `CRYO`.
  - `CHILLED` / `FROZEN` (`CRYO`): 50% slow / 2.5s freeze; `KINETIC` or `VOID` triggers `SHATTER` (bonus burst + 6 radial piercing shards).
  - `IGNITED` (`THERMAL`): burn DoT, 50% armor shred, thaws `FROZEN`/`CHILLED`.
  - `CORRUPTED` (`NANO`/`TOXIN`): shield drain, anti-regen, stacking corrosive DoT.
- `EnemyAI.ts`: All 6 geometric enemy constructs (`Vector Swarmer`, `Barrier Bastion`, `Cryo Stalker`, `Beam Weaver` with Beam Clash, `Singularity Splitter` with Frozen Shatter prevention, and `Sector Warden` boss every 5 waves).
- `WaveDirector.ts`: Escalating waves, score & combo multiplier (`x1`, `x2`, `x4`...), boss waves every 5 waves.
- `CombatEngine.test.ts`: Unit tests for combos, Bastion shield blocking/shatter, Splitter shatter, Beam Clash, and Wave 5 boss spawning.

**Verification:** `pnpm test && pnpm typecheck && pnpm build`.

---

## Milestone 4: Construct Augments, Procedural Audio & Polish
- `Augments.ts` & `Augments.test.ts`: 6 Construct Augments (`Superconductor`, `Permafrost Detonation`, `Prism Refraction`, `Tectonic Mines`, `Overclocked Queue`, `Singularity Pull`) wired into `CombatEngine.ts` with 3-card non-duplicate draft.
- `SynthAudio.ts`: Pure Web Audio API procedural SFX synthesizer (element queue chimes, cancellations, fusions, beams, clashes, lightning, shatters, sub-bass detonations, dashes, wave/boss cues).
- `HUD.ts`: Full reactive SVG/DOM HUD, between-wave Augment draft modal, Start overlay, Game-Over modal with `localStorage` top-5 high scores, preset/tilt/mute/pause controls.
- Hit-stop & screen-shake juice.

**Verification:** `pnpm test && pnpm typecheck && pnpm build` + zero Three.js/DOM imports in `src/sim/`.

---

## Post-MVP Ideas
- Gamepad dual-stick support (`Left Stick` move, `Right Stick` aim, triggers/bumpers for cast & element wheel).
- Endless Overdrive mutators and daily seeded runs.
- Additional compound sub-elements and boss variants.
