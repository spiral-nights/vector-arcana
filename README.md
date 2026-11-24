# Vector Arcana

A single-player, top-down 2.5D arcade horde roguelite combining real-time combinatorial spell-crafting with a high-contrast neon wireframe aesthetic, warping spring-mass grid, and intense arcade swarms.

## Design Pillars

- **Zero External Art Pipeline:** Every entity, projectile, beam, shield, particle, and UI glyph is rendered procedurally using 3D wireframe meshes, shaders, and vector geometry.
- **Deterministic State-Machine Combat:** Queue up to **3 elements** in real time (`Q W E R` / `A S D F`). Element cancellations, sub-element fusions, and cast modifiers resolve deterministically into **10 distinct spell delivery types**.
- **Prime-and-Detonate Horde Loop:** Combine priming elements (*Flux* conductive puddles, *Cryo* freeze) with detonators (*Volt* chain arcs, *Kinetic* shatter boulders) across escalating geometric waves and boss encounters.
- **Strict Simulation/Render Separation:** All physics, hitboxes, element queues, and spell resolution run on a flat 2D X/Y plane inside a headless fixed-timestep (`60 Hz`) simulation engine (`src/sim/`), completely decoupled from the 2.5D Three.js rendering layer (`src/render/`), procedural Web Audio synthesizer (`src/audio/`), and HUD (`src/ui/`).

## Controls (Classic Default)

| Action | Classic (Default) | Arrows + LMB Preset |
| --- | --- | --- |
| **Queue Elements** | `Q W E R` (Flux, Nano, Barrier, Cryo) / `A S D F` (Volt, Void, Kinetic, Thermal) | `Q W E R` / `A S D F` |
| **Move** | Click or Hold `LMB` (toward cursor) or `Arrow Keys` | `Arrow Keys` |
| **Aim** | Mouse Cursor | Mouse Cursor |
| **Forward Cast** | `RMB` | `LMB` |
| **360° Nova Cast** | `Spacebar` (or `Shift + RMB`) | `RMB` or `Spacebar` |
| **Self Cast** | `MMB` or `C` | `MMB` or `C` |
| **Phase Dash / Blade Slash** | `Shift + LMB` (or `Shift`) | `Shift` |

## Architecture

```text
src/
├── main.ts      # Fixed 60 Hz loop, input bindings, event routing
├── sim/         # Pure 2D deterministic simulation (zero Three.js/DOM imports)
├── render/      # Three.js orthographic + 8° tilt, UnrealBloomPass, WarpingGrid, VFX
├── audio/       # Web Audio API procedural synthesizer
└── ui/          # Reactive SVG/DOM HUD, Augment draft modal, local high scores
```

## Development & Package Policy

This project uses `pnpm` with a strict **14-day minimum release age** (`minimumReleaseAge: 20160` in `pnpm-workspace.yaml` and `min-release-age=14` in `.npmrc`) so no dependency newer than 2 weeks is installed.

```bash
pnpm install      # Install dependencies (enforces 14-day release age)
pnpm dev          # Start Vite dev server
pnpm test         # Run Vitest unit test suite
pnpm typecheck    # Run TypeScript strict typecheck
pnpm build        # Typecheck + production Vite build
```

## Documentation

- [Roadmap](docs/ROADMAP.md)
- [Game Design Specification](docs/DESIGN.md)
- [Technical Architecture](docs/ARCHITECTURE.md)
