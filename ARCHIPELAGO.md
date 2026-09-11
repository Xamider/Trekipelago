# Trekipelago — Archipelago Multiworld Integration Specification

This document is the complete design specification and randomization logic reference for **Trekipelago**, intended for developers building an Archipelago external game world (`apworld`, randomizer generator, or server module) in any language or environment.

---

## 1. Game Concept & Architecture

**Trekipelago** combines real-world physical movement (GPS geotracking) with the multi-game randomization ecosystem of **Archipelago Multiworld**:
- **Locations / Checks (Sent from app to AP server)**:
  - **Distance Checks (Milestones)**: Completed as the player travels real-world distance on foot or bicycle (e.g. every 500 meters).
  - **Orb Checks (Milestones)**: Completed as the player gathers glowing light orbs in their surrounding area (e.g. every 5 orbs collected).
- **Items (Received by app from AP server)**:
  - **Progression**: Logical keys unlocking core capabilities (background tracking, passive collection, speed limit caps).
  - **Useful / Boosts**: Temporary status buffs (double distance, double orb spawn rate, double collection value, +50% speed limit).
  - **Traps**: Temporary hindrance effects (halved distance progression, halved orb spawn rate, halved collection value, slowed movement, map blindness).

---

## 2. Item Catalog & Identifiers

The numerical identifier base for Trekipelago items is **`7730000`**.

### 2.1 Item Definitions

| Item ID | Internal Key | Display Name | Archipelago Category | Pool Quantity | Description / In-Game Effect |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **`7730001`** | `unlock_background` | Background Tracking Unlocked | **Progression** | 1 (Fixed) | **Logical progression key:** Allows GPS distance tracking and passive collection while the device screen is locked or the app is backgrounded. Without this item, travel is counted only while the app is active in the foreground. |
| **`7730002`** | `passive_collector` | Progressive Passive Collector | **Progression** | 3 (Levels 1–3) | Automatically collects orbs in the background during active movement without requiring manual taps on the map:<br>• Level 1: ~1 orb / min<br>• Level 2: ~3 orbs / min<br>• Level 3: ~5 orbs / min |
| **`7730003`** | `progressive_speed` | Progressive Speed Limit | **Progression** | 5 (Levels 1–5) | Raises the maximum allowed GPS velocity cutoff, above which movement points are rejected:<br>• Level 0 (Base): 3.0 km/h (Slow walk)<br>• Level 1: 6.0 km/h (Normal walk)<br>• Level 2: 12.0 km/h (Brisk jog)<br>• Level 3: 22.0 km/h (Running / casual cycling)<br>• Level 4: 35.0 km/h (Fast cycling)<br>• Level 5: 50.0 km/h (Max cycling / 50 km/h) |
| **`7730004`** | `speed_up` | Speed Boost (+50%) | **Useful** | Variable (Filler) | Temporary buff (5m, 15m, or 30m). Increases current GPS speed limit by +50%. |
| **`7730005`** | `boost_distance_2x` | Double Distance (2x) | **Useful** | Variable (Filler) | Temporary buff (5m, 15m, or 30m). Every meter traveled counts double towards distance progression and milestones. |
| **`7730006`** | `boost_drop_2x` | Double Orb Drop (2x) | **Useful** | Variable (Filler) | Temporary buff (5m, 15m, or 30m). Doubles the chance for light orbs to spawn on every roll interval. |
| **`7730007`** | `boost_collect_2x` | Double Collected Orbs (2x) | **Useful** | Variable (Filler) | Temporary buff (5m, 15m, or 30m). Every collected orb counts as 2 towards milestones and orb goals. |
| **`7730008`** | `trap_slow` | Slow Movement (-50%) | **Trap** | Variable (Filler) | Temporary trap (5m, 15m, or 30m). Cuts GPS speed limit in half (-50%). |
| **`7730009`** | `trap_distance_half` | Half Distance (0.5x) | **Trap** | Variable (Filler) | Temporary trap (5m, 15m, or 30m). Distance progress accumulates at half speed (0.5x). |
| **`7730010`** | `trap_drop_half` | Half Orb Drop (0.5x) | **Trap** | Variable (Filler) | Temporary trap (5m, 15m, or 30m). Light orb spawn chance is reduced by 50%. |
| **`7730011`** | `trap_collect_half` | Half Collected Orbs (0.5x) | **Trap** | Variable (Filler) | Temporary trap (5m, 15m, or 30m). Every collected orb counts as 0.5 towards milestones. |
| **`7730012`** | `trap_blind` | Map Blindness | **Trap** | Variable (Filler) | Temporary trap (1m or 3m). Blurs the map view, concealing surrounding orb positions. |

---

## 3. Location Checks & Generation

Checks are dynamically generated based on the player's expedition configuration.

### 3.1 Distance Checks (Distance Milestones)
- **ID Base**: `7740000`
- **Formula**: `ID = 7740000 + checkIndex` (e.g. Check #1 = `7740001`, Check #2 = `7740002`, etc.)
- **Count**:
  $$\text{DistanceChecks} = \left\lfloor \frac{\text{max\_distance\_meters}}{\text{reward\_interval\_meters}} \right\rfloor$$

### 3.2 Orb Checks (Orb Milestones)
- **ID Base**: `7750000`
- **Formula**: `ID = 7750000 + checkIndex` (e.g. Check #1 = `7750001`, Check #2 = `7750002`, etc.)
- **Count**:
  $$\text{OrbChecks} = \left\lfloor \frac{\text{max\_orbs}}{\text{orbs\_per\_reward}} \right\rfloor$$

### 3.3 Total Locations & Minimum Capacity Constraint
$$\text{TotalChecks} = \text{DistanceChecks} + \text{OrbChecks}$$

> **Requirement:** An expedition must provide **at least 9 total checks** ($\ge 9$) to accommodate the 9 guaranteed progression items. If fewer checks are available, expedition creation is rejected.

---

## 4. Item Pool Balancing & Placement Logic

When generating an expedition pool:

### 4.1 Guaranteed Progression Items (9 Total)
1. **1x** `unlock_background`
2. **3x** `passive_collector` (Tiers 1 to 3)
3. **5x** `progressive_speed` (Tiers 1 to 5)

### 4.2 Spacing & Distribution Heuristics
- **Background Tracking Distribution**:
  - 50% probability to be placed in the first 10% of the expedition progression.
  - 49% probability to be placed between 10% and 50% of the expedition.
  - <1% probability to appear past 50% of the expedition.
- **Progression Items Spacing**:
  - Progression items are distributed across progression sectors (early, mid, late) with a penalty against placing guaranteed items in directly adjacent slots, ensuring a balanced pacing throughout the trek.
- **Filler Ratio**:
  - The remaining slots are filled with buffs vs traps according to `buffRatio` (default 70% buffs / 30% traps).
- **Paired Duration Arithmetic**:
  - Opposite effects (e.g. `2x Distance` vs `0.5x Distance`, `+50% Speed` vs `-50% Speed`) cancel each other out dynamically. If an opposite item is collected while one is active, the durations subtract and the net remaining time is applied.

---

## 5. Real-Time In-Game Engine Mechanics

1. **Orb Spawning System**:
   - Every 10 seconds (`SPAWN_INTERVAL_MS`), a spawn roll occurs within a fixed 100-meter radius around the player.
   - Base spawn chance starts at configured value (`baseChance`, default 20%).
   - Geometric decay upon successful drop:
     $$\text{chance}_{\text{new}} = \text{chance}_{\text{prev}} \times (1 - \text{spawnReduction})$$
     with $\text{spawnReduction} = 0.125$ (12.5% relative drop).
   - Linear recovery with walking distance:
     $$\Delta\text{chance} = \text{baseChance} \times \frac{\text{distanceMovedMeters}}{\text{recoveryDistanceMeters}}$$
     with $\text{recoveryDistanceMeters} = 400\,\text{m}$.
   - Spawn chance is capped at `baseChance`.
   - **Multi-Orb Chaining**: Upon a successful spawn, the engine immediately rolls again with the newly decreased chance until a roll fails or the max orb limit is reached.

2. **Area Spawn Distribution**:
   - Uniform spherical cap sampling guarantees even distribution within the 100m radius without clustering at the center.

---

## 6. Player Configuration Options (YAML)

| Option | Type | Range | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `goal` | Enum | `distance`, `orbs`, `both` | `distance` | **Victory condition:** Reaching max distance, max orbs, or both. |
| `max_distance_km` | Integer | 1 to 100 | 5 | Total expedition distance goal in kilometers. |
| `reward_interval_m` | Integer | 100 to 2000 | 500 | Meters per distance milestone check. |
| `max_orbs` | Integer | 10 to 500 | 50 | Total light orb goal. |
| `orbs_per_reward` | Integer | 1 to 25 | 5 | Orbs required per orb milestone check. |
| `buff_ratio` | Percentage | 0 to 100 | 70 | Ratio of helpful boosts vs traps in filler slots. |

---

## 7. Client-Server Protocol & Offline Resilience

- **Transport**: Standard Archipelago WebSocket connection (JSON).
- **Local Persistence**: All checked locations, received items, and connection preferences are stored transactionally in local SQLite database tables (`archipelago_state`).
- **Offline Tolerance**: Disconnections in low-reception outdoor areas do not halt gameplay. Checks accumulate locally and sync seamlessly once connectivity is re-established.
