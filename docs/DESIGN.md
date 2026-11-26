# Vector Arcana — Game Design Specification

## 1. High Concept & Pillars

**Vector Arcana** is a single-player, top-down 2.5D arcade horde roguelite combining real-time combinatorial spell-crafting with a high-contrast neon wireframe aesthetic, warping spring-mass grid, and intense arcade swarms.

- **Zero External Art Pipeline:** All entities, projectiles, beams, shields, particles, and UI glyphs are procedurally rendered via 3D wireframe meshes, vertex colors, and SVG vector paths.
- **Deterministic State-Machine Combat:** Players queue up to **3 elements** in real time; cancellations, fusions, and cast modifiers resolve deterministically into **10 distinct spell delivery types**.
- **Prime-and-Detonate Horde Loop:** Enemies spawn in escalating geometric waves. Players prime targets with *Flux* / *Cryo* and detonate with *Volt* / *Kinetic* / *Void* while managing crowd control and defensive wards.
- **Strict Separation of Simulation & Rendering:** All simulation runs on a flat 2D X/Y plane inside `src/sim/` at a fixed `60 Hz` timestep, decoupled from `src/render/`, `src/audio/`, and `src/ui/`.

---

## 2. Controls & Input Mapping

### Classic Controls (Default)
No `1–8` number keys are used in combat; all 8 elements sit under the left hand on `Q W E R` / `A S D F`:

| Key / Input | Action |
| --- | --- |
| `Q` | Queue **Flux** (`#00A8FF`) |
| `W` | Queue **Nano** (`#39FF14`) |
| `E` | Queue **Barrier** (`#00E676`) |
| `R` | Queue **Cryo** (`#00FFFF`) |
| `A` | Queue **Volt** (`#FFEE00`) |
| `S` | Queue **Void** (`#BD00FF`) |
| `D` | Queue **Kinetic** (`#FF9E00`) |
| `F` | Queue **Thermal** (`#FF2A2A`) |
| Click or Hold `LMB` or `Arrow Keys` | Move (click-to-move waypoint or directional) |
| Mouse Cursor | Aim direction |
| `RMB` | **Forward Cast** |
| `Spacebar`, `MMB` (or `Shift + RMB`) | **360° Nova Cast** |
| `Shift + LMB` (or `Shift` tap) | **Phase Dash / Blade Slash** |
| `Esc` | Pause / Resume |

### Optional Preset Toggle (`Arrows + LMB Cast`)
For trackpad or keyboard-move players, an optional HUD toggle switches mouse buttons while preserving `Q W E R` / `A S D F`:
- `Arrow Keys`: Move
- `LMB`: Forward Cast
- `RMB`, `Spacebar` or `MMB`: 360° Nova Cast
- `Shift`: Phase Dash / Blade Slash

---

## 3. Elements, Cancellations & Sub-Element Fusions

### 3.1 The 8 Base Elements

| ID | Name | Color | Vector Glyph |
| --- | --- | --- | --- |
| `FLUX` | Flux (Water) | `#1A6BFF` | Concentric ripple rings |
| `NANO` | Nano (Life) | `#39FF14` | Thick geometric plus-cross (`+`) |
| `BARRIER` | Barrier (Shield) | `#E6F0FF` | Octagonal barrier frame |
| `CRYO` | Cryo (Cold) | `#00F5FF` | Six-pointed crystal hexagon |
| `VOLT` | Volt (Lightning) | `#FFF733` | Jagged chevron lightning bolt |
| `VOID` | Void (Arcane/Death) | `#B429FF` | Swirling spiral singularity |
| `KINETIC` | Kinetic (Earth) | `#E8741A` | 3D wireframe cube |
| `THERMAL` | Thermal (Fire) | `#FF1E2D` | Sharp upward delta triangle (`▲`) |

### 3.2 Queue Cancellation Rules (1-for-1 Removal)
When a base element is pressed, check the current queue (max 3 slots):
1. **Opposite Elements Cancel (1-for-1):**
   - `THERMAL` ↔ `CRYO`
   - `FLUX` ↔ `VOLT`
   - `KINETIC` ↔ `VOLT`
   - `VOID` ↔ `NANO`
2. **Self-Limit:** Maximum **1** `BARRIER` allowed in the queue.
3. **Strict 3-Slot Cap:** Once 3 non-cancelling, non-fusing elements are queued, additional elements are ignored (`IGNORE` default; `FIFO` configurable).

### 3.3 Sub-Element Fusion (Automatic in Queue)
When compatible base elements coexist, they fuse in-place into a 1-slot compound sub-element. Fused sub-elements **do not** cancel against base elements (e.g., `PLASMA + VOLT` is valid):
- `FLUX + CRYO → CRYSTAL` (`#80FFFF`, Ice Shards)
- `FLUX + THERMAL → PLASMA` (`#FF5E99`, Superheated Steam; applies `PRIMED` without cancelling `VOLT`)

---

## 4. Deterministic 10-Spell Priority Table

On Forward Cast (`RMB` in Classic), the resolver inspects the queue from **Priority 1 to 9** (and **10** for Phase Slash):

| Priority | Delivery Type | Required Queue Condition | Behavior |
| --- | --- | --- | --- |
| **1** | **Shield (Barrier)** | `[BARRIER]` alone | Curved 3D wireframe octagonal barrier; blocks projectiles and reflects enemy beams. |
| **2** | **Wall** | `BARRIER` + (`KINETIC` or `CRYSTAL`) | 5 destructible geometric pylons perpendicular to aim, inheriting secondary elements. |
| **3** | **Mines** | `BARRIER` + (`VOID` or `NANO`) | 5–9 floating octagonal proximity pods in forward arc; detonate on contact. |
| **4** | **Storm** | `BARRIER` + (`THERMAL` or `CRYO` or `VOLT` or `FLUX` or `PLASMA`) | Persistent circular orbital hazard (`radius = 185+`, `4.5s+`) at cursor. Never contains `KINETIC` (Wall). |
| **5** | **Rock Throw** | `KINETIC` + Any (no `BARRIER`) | Spinning 3D amber wireframe cube; pierces weak swarmers, detonates on heavies/walls; scales with `KINETIC` stacks. |
| **6** | **Crystal Shards** | `CRYSTAL` + Any (no `BARRIER`/`KINETIC`) | Cone burst of 7–13 piercing cyan crystal shards (chargeable). |
| **7** | **Beam** | (`VOID` or `NANO`) + Any (no `BARRIER`/`KINETIC`/`CRYSTAL`) | Continuous braided laser beam; clashes with enemy beams. |
| **8** | **Lightning Bolt** | `VOLT` + Any (without higher priority) | Instant jagged electric arcs jumping up to 4 targets (8 if `PRIMED`). |
| **9** | **Spray** | `THERMAL`, `CRYO`, `FLUX`, or `PLASMA` | Wide close-range wave-pulse jet for swarm control and priming. |
| **10** | **Phase Slash** | `Shift + LMB` / `Shift` Dash | 180-unit dash with i-frames + wide geometric cleave imbued with queued elements (+ elemental trail if `BARRIER` queued). |

### Secondary Cast Modes
- **Nova Cast (`Space` / `MMB` / `Shift + RMB`):** Converts spells into a 360° circular ring/burst centered on the player.
- Casting is always immediate: no time dilation, and every cast uses the normal fixed 60 Hz timestep.

---

## 5. Primer & Status Combo Matrix

- **`PRIMED`** *(applied by `FLUX` / `PLASMA` & conductive puddles, 5s)*:
  - Hit with `VOLT`: **2.0× damage** and **2× chain-jump range** (up to 8 targets).
  - Hit with `CRYO`: instantly **`FROZEN`** (2.5s).
- **`CHILLED` / `FROZEN`** *(applied by `CRYO`)*:
  - `CHILLED` slows enemy speed by 50%.
  - `FROZEN` immobilizes target.
  - **SHATTER:** Hitting `FROZEN` enemy with `KINETIC` or `VOID` deals bonus burst damage and fires **6 piercing ice shards** radially.
- **`IGNITED`** *(applied by `THERMAL`)*: Burn DoT + strips **50% armor**; removes `FROZEN` / `CHILLED`.
- **`CORRUPTED`** *(applied by offensive `NANO` / `TOXIN`)*: Drains enemy energy shields and blocks regeneration; `TOXIN` pools melt armor with stacking DoT.

---

## 6. Connected Sectors, Cover Pillars & Tactical Enemies

- **Large Connected Sectors (`2200 × 1500`):** Smooth follow camera with mouse look-ahead, rotating geometric cover pillars (blocking beams and projectiles), and an East Sector Gate that unlocks once all rifts and enemies are cleared.
- **Telegraphed Spawn Rifts:** Squads materialize from 1–2 glowing `2.0s` warp rifts ahead of the player rather than 360° ambushes.
- **6 Tactical Enemy Archetypes:**
  1. **Vector Skirmisher (Pink Pinwheel):** Small tactical packs of 3–5 at deliberate speed (`88 u/s`).
  2. **Barrier Bastion (Silver-White Hexagon):** Slow directional phalanx (`46 u/s`) with frontal shield + close-range telegraphed shockwave ring.
  3. **Cryo Stalker (Cyan Diamond):** `0.7s` aim telegraph before firing a 3-needle frost fan, then blinks to flank.
  4. **Beam Weaver (Violet Octagon):** `1.4s` charge telegraph line before firing a continuous clashable laser beam.
  5. **Cinder Wisp (Amber Ember Core):** Orbits at range, telegraphs a `0.9s` flare ring, dashes, then leaves its burn hazard where it lands — never under the player.
  6. **Sector Warden (Boss — Every 5 Sectors):** Massive core with 3 rotating shield plates, sweeping clashable beams, forward slam hazards, and escort spawns.

- **Fairness Rule for Ground Hazards:** Enemy hazards are always placed at the enemy's own position or a telegraphed offset in front of it. No enemy may spawn a hazard directly on the player's position, so every ground attack can be read and walked out of.

---

## 7. Construct Augments (Roguelite Upgrades)

Between waves, 3 randomized cards are offered from:
1. **Superconductor (`VOLT`):** Volt arcs jump to +3 additional targets and arc off deployed Mines.
2. **Permafrost Detonation (`CRYO + KINETIC`):** Shattering a Frozen enemy deals 75% of its max HP as AoE shard damage.
3. **Prism Refraction (`BARRIER`):** Firing any Beam through your own Barrier Shield splits it into 3 diverging beams.
4. **Tectonic Mines (`WALL`):** When an Barrier Wall pylon expires or is destroyed, it converts into a proximity Mine.
5. **Overclocked Queue (`CORE`):** Casting a 3-element spell with 3 unique elements grants +25% move speed and +20% cast rate for 3s.
6. **Singularity Pull (`VOID`):** Void detonations and beams pull nearby enemies inward toward the impact point.
