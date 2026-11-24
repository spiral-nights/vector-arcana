# Vector Arcana — Technical Architecture

## 1. Core Architectural Rule: Strict Sim/Render Separation

`src/sim/` is a pure TypeScript 2D (`x, y`) deterministic simulation engine:
- **Zero Three.js imports** and **zero DOM/Browser APIs** (`window`, `document`, `AudioContext`, `localStorage`) inside `src/sim/`.
- Advances in fixed `1/60s` (`FIXED_DT = 1 / 60`) ticks via `GameSim.step(input)`.
- Communicates outward exclusively via:
  1. **Typed `SimEvent` queue** (`grid_impulse`, `grid_well`, `hit_stop`, `screen_shake`, `sfx`, `vfx_burst`, `vfx_lightning`, `vfx_shatter`, `beam_clash`, `wave_start`, `augment_offer`, `game_over`), drained each frame by `main.ts` and dispatched to `WarpingGrid`, `SpellVFX`, `SceneManager`, and `SynthAudio`.
  2. **Read-only `SimSnapshot`** consumed by `EntityRenderer`, `SpellVFX`, and throttled (`~20 Hz`) `HUD` updates.

This guarantees that all spell resolution, status combos, enemy AI, wave progression, and augments are 100% unit-testable in headless Node via Vitest.

---

## 2. Module Responsibilities

```text
src/
├── main.ts                  # Fixed-timestep loop, input bindings, SimEvent router
├── sim/
│   ├── types.ts             # Elements, spells, entities, statuses, events, snapshots
│   ├── SpellResolver.ts     # Queue cancellation, fusion, 10-spell priority table
│   ├── CombatEngine.ts      # Hitboxes, beams, clashes, walls, mines, storms, combos
│   ├── EnemyAI.ts           # Behaviors for all 6 enemy archetypes + Sector Warden
│   ├── WaveDirector.ts      # Wave composition, score multiplier, boss cadence
│   ├── Augments.ts          # 6 Construct Augments + 3-card draft generator
│   └── GameSim.ts           # Top-level headless simulation facade
├── render/
│   ├── SceneManager.ts      # OrthographicCamera (+ 8° tilt), UnrealBloomPass, raycaster
│   ├── WarpingGrid.ts       # 48×48 spring-mass lattice with radial impulses & wells
│   ├── EntityRenderer.ts    # Player arrow-ship, diegetic arcs, pips, 6 enemy meshes
│   └── SpellVFX.ts          # Wireframe VFX & pooled particles for all 10 spells
├── audio/
│   └── SynthAudio.ts        # Web Audio API procedural synthesizer
└── ui/
    └── HUD.ts               # SVG hotbar, top bar, Augment modal, high scores
```

---

## 3. Key Technical Details

### 3.1 Orthographic Camera & Tilt-Safe Aiming (`SceneManager.ts`)
- The arena spans `[-560, +560] × [-380, +380]` on the `z = 0` plane.
- `OrthographicCamera` auto-fits the arena with margin on any viewport aspect ratio.
- Toggling the **8° depth tilt** rotates the camera slightly in Y/Z while keeping `lookAt(0, 0, 0)`.
- Cursor aiming always uses `THREE.Raycaster.setFromCamera(ndc, camera)` intersected with the mathematical `z = 0` plane (`THREE.Plane(new THREE.Vector3(0, 0, 1), 0)`), ensuring pixel-exact world aiming in both `0°` and `8°` modes.

### 3.2 Spring-Mass `WarpingGrid.ts`
- `48 × 48` grid of vertices (`2,304` nodes) preallocated into `Float32Array` position and color buffers for `THREE.LineSegments`.
- Each tick:
  - Restoring spring force pulls `(x, y)` toward rest `(rx, ry)`.
  - Neighbor coupling propagates ripples smoothly across adjacent grid vertices.
  - Exponential damping settles oscillations cleanly.
- `applyRadialImpulse(wx, wy, strength, radius)` pushes vertices outward; `applyGravityWell(wx, wy, strength, radius)` pulls vertices inward. Displaced vertices brighten dynamically via vertex color interpolation.

### 3.3 Post-Processing
- `EffectComposer` → `RenderPass` → `UnrealBloomPass` → `OutputPass` from `three/examples/jsm/postprocessing/...`.
- Renderer pixel ratio capped at `2` for crisp lines without excessive GPU fill-rate cost.
