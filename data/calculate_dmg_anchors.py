"""
DMG & Teamfight Anchor Calculator for Project Sucrose
------------------------------------------------------
Run from the project root:
  python data/calculate_dmg_anchors.py

Reads:  data/game_results_detailed.csv
Writes: data/dmg_anchors.json
Prints: ready-to-paste DMG_ANCHORS const for index-v2.html

Column format in CSV:
  A ADL DMG, A MID DMG, A DSL DMG, A JUG DMG, A SUP DMG  (Team A raw damage)
  B ADL DMG, B MID DMG, B DSL DMG, B JUG DMG, B SUP DMG  (Team B raw damage)
  A ADL KILL, A MID KILL ... etc
  A ADL ASSIST, A MID ASSIST ... etc
  END TIME  (MM.SS format e.g. 12.54 = 12min 54sec)

Calculations:
  DMG%    = player_raw_dmg / sum_of_all_5_team_raw_dmg * 100
  DPM     = player_raw_dmg / duration_minutes
  KP%     = (kills + assists) / team_total_kills * 100
"""

import csv
import json
from pathlib import Path

INPUT_FILE  = Path(__file__).parent / "game_results_detailed.csv"
OUTPUT_FILE = Path(__file__).parent / "dmg_anchors.json"

PERCENTILE_TARGETS = [0, 1, 5, 15, 30, 50, 70, 85, 95, 99, 100]

TARGET_ROLES = {
    "carry":   "ADL",
    "midlane": "MID",
}

ALL_ROLE_KEYS = ["DSL", "JUG", "MID", "ADL", "SUP"]


def parse_num(val):
    if not val or str(val).strip() in ("", "-", "N/A", "n/a"):
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except ValueError:
        return None


def parse_duration_to_minutes(val):
    """END TIME is MM.SS — e.g. 12.54 = 12min 54sec."""
    n = parse_num(val)
    if n is None or n <= 0:
        return None
    minutes = int(n)
    seconds = round((n - minutes) * 100)
    if seconds >= 60:
        return None
    total = minutes + seconds / 60.0
    return total if total >= 4 else None


def percentile_value(sorted_data, pct):
    n = len(sorted_data)
    if n == 0:
        return None
    if pct <= 0:
        return sorted_data[0]
    if pct >= 100:
        return sorted_data[-1]
    idx   = (pct / 100.0) * (n - 1)
    lower = int(idx)
    upper = min(lower + 1, n - 1)
    return sorted_data[lower] + (idx - lower) * (sorted_data[upper] - sorted_data[lower])


def build_anchors(values, targets, decimals=1):
    sorted_v = sorted(v for v in values if v is not None)
    if not sorted_v:
        return []
    return [[pct, round(percentile_value(sorted_v, pct), decimals)] for pct in targets]


def main():
    if not INPUT_FILE.exists():
        print(f"ERROR: {INPUT_FILE} not found. Run from project root.")
        return

    data = {role: {"dmg": [], "dpm": [], "kp": []} for role in TARGET_ROLES}

    print(f"Reading {INPUT_FILE} ...")

    with open(INPUT_FILE, newline="", encoding="utf-8-sig") as f:
        reader     = csv.DictReader(f)
        headers    = [h.strip() for h in (reader.fieldnames or [])]

        print(f"Total columns: {len(headers)}")
        dmg_cols = [h for h in headers if "DMG" in h.upper()]
        print(f"DMG columns found: {dmg_cols}\n")

        # Find duration column
        dur_col = next(
            (c for c in headers if "END" in c.upper() and "TIME" in c.upper()), None
        )
        if not dur_col:
            dur_col = next((c for c in headers if "DURATION" in c.upper()), None)
        if not dur_col:
            print("ERROR: No duration column found.")
            print("All columns:", headers)
            return
        print(f"Duration column: '{dur_col}'\n")

        row_count = 0
        skipped   = 0
        used      = 0

        for raw_row in reader:
            row = {k.strip(): v for k, v in raw_row.items()}
            row_count += 1

            duration_min = parse_duration_to_minutes(row.get(dur_col, ""))
            if not duration_min:
                skipped += 1
                continue

            for side in ("A", "B"):

                # --- Team total raw damage (sum all 5 roles) ---
                team_dmg = 0.0
                team_dmg_valid = True
                for rk in ALL_ROLE_KEYS:
                    v = parse_num(row.get(f"{side} {rk} DMG", ""))
                    if v is None:
                        team_dmg_valid = False
                        break
                    team_dmg += v
                if not team_dmg_valid or team_dmg == 0:
                    continue

                # --- Team total kills (sum all 5 roles) ---
                team_kills = 0.0
                for rk in ALL_ROLE_KEYS:
                    v = parse_num(row.get(f"{side} {rk} KILL", ""))
                    if v is not None:
                        team_kills += v

                for role, rk in TARGET_ROLES.items():
                    raw_dmg = parse_num(row.get(f"{side} {rk} DMG",    ""))
                    kills   = parse_num(row.get(f"{side} {rk} KILL",   ""))
                    assists = parse_num(row.get(f"{side} {rk} ASSIST", ""))

                    if raw_dmg is None:
                        continue

                    used += 1

                    # 1. DMG% — player share of team damage
                    dmg_pct = raw_dmg / team_dmg * 100
                    data[role]["dmg"].append(dmg_pct)

                    # 2. DPM proxy — matches engine formula: (dmg_pct / duration_min) * 10
                    dpm = (raw_dmg / team_dmg * 100 / duration_min) * 10
                    data[role]["dpm"].append(dpm)

                    # 3. KP% — kill participation (capped at 100; values above are data errors)
                    if kills is not None and assists is not None and team_kills > 0:
                        kp = min((kills + assists) / team_kills * 100, 100.0)
                        data[role]["kp"].append(kp)

        print(f"Rows: {row_count}  |  Skipped (no duration): {skipped}  |  Player-game samples: {used}\n")

    # Build and print anchors
    output   = {}
    js_lines = ["const DMG_ANCHORS = {"]

    metric_meta = [
        ("dmg", "DMG dealt %  (player raw dmg / team total dmg × 100)", 1),
        ("dpm", "DPM proxy    ((dmg_pct / duration_min) × 10)",           2),
        ("kp",  "KP%          ((kills + assists) / team kills × 100)",   1),
    ]

    for metric, label, decimals in metric_meta:
        print(f"=== {label} ===")
        js_lines.append(f"  // {label}")
        js_lines.append(f"  {metric}: {{")
        output[metric] = {}

        for role in TARGET_ROLES:
            vals = data[role][metric]
            if not vals:
                print(f"  WARNING: No data for {role} {metric}\n")
                continue

            anchors  = build_anchors(vals, PERCENTILE_TARGETS, decimals)
            output[metric][role] = anchors

            sorted_v = sorted(v for v in vals if v is not None)
            print(f"  {role}: {len(vals)} samples | "
                  f"min {sorted_v[0]:.1f} | "
                  f"p50 {percentile_value(sorted_v,50):.1f} | "
                  f"max {sorted_v[-1]:.1f}")
            for pct, val in anchors:
                print(f"    p{pct:3d} → {val}")
            print()

            js_lines.append(f"    {role}: {json.dumps(anchors)},")

        js_lines.append("  },")

    js_lines.append("};")

    # Save JSON
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"✓ Saved to {OUTPUT_FILE}\n")

    # Print JS paste block
    print("=" * 60)
    print("PASTE THIS INTO index-v2.html — replace DMG_ANCHORS object")
    print("=" * 60)
    print("\n".join(js_lines))
    print("=" * 60)


if __name__ == "__main__":
    main()
