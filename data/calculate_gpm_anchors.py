"""
GPM Anchor Calculator for Project Sucrose
------------------------------------------
Run this script from the root of your project:
  python data/calculate_gpm_anchors.py

Reads:  data/game_results_detailed.csv
Writes: data/gpm_anchors.json  (paste into GPM_ANCHORS in app.js)

NOTE: The CSV has team-level gold only (A Gold / B Gold), not per-player gold.
Per-player gold is estimated by distributing team gold proportionally to each
player's share of team damage dealt — the standard proxy for AOV data.
"""

import csv
import json
from pathlib import Path

INPUT_FILE  = Path(__file__).parent / "game_results_detailed.csv"
OUTPUT_FILE = Path(__file__).parent / "gpm_anchors.json"

# role → side-column abbreviation used in the CSV headers
ROLE_ABBR = {
    "offlane": "DSL",
    "jungler":  "JUG",
    "midlane":  "MID",
    "carry":    "ADL",
    "support":  "SUP",
}

PERCENTILE_TARGETS = [0, 1, 5, 15, 30, 50, 70, 85, 95, 99, 100]


def parse_num(val):
    if not val or str(val).strip() == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except ValueError:
        return None


def parse_duration_min(val):
    """END TIME is stored as MM.SS (e.g. 13.19 = 13 min 19 sec)."""
    raw = parse_num(val)
    if raw is None:
        return None
    minutes = int(raw)
    seconds = round((raw - minutes) * 100)
    total = minutes + seconds / 60
    return total if total >= 5 else None


def percentile_value(sorted_data, pct):
    """Linear-interpolation percentile (matches the JS engine)."""
    n = len(sorted_data)
    if n == 0:
        return None
    if pct <= 0:
        return sorted_data[0]
    if pct >= 100:
        return sorted_data[-1]
    idx   = (pct / 100) * (n - 1)
    lo    = int(idx)
    hi    = min(lo + 1, n - 1)
    frac  = idx - lo
    return sorted_data[lo] + frac * (sorted_data[hi] - sorted_data[lo])


def build_anchors(values, targets):
    sorted_vals = sorted(v for v in values if v is not None)
    if not sorted_vals:
        return []
    return [[p, round(percentile_value(sorted_vals, p))] for p in targets]


def main():
    raw_gpms  = {r: [] for r in ROLE_ABBR}
    diff_gpms = {r: [] for r in ROLE_ABBR}

    print(f"Reading {INPUT_FILE} …")

    with open(INPUT_FILE, newline="", encoding="utf-8") as f:
        reader    = csv.DictReader(f)
        headers   = reader.fieldnames or []
        row_count = 0
        skipped   = 0

        for row in reader:
            row_count += 1

            duration_min = parse_duration_min(row.get("END TIME", ""))
            if duration_min is None:
                skipped += 1
                continue

            for side, opp in [("A", "B"), ("B", "A")]:
                team_gold = parse_num(row.get(f"{side} Gold", ""))
                if team_gold is None or team_gold <= 0:
                    continue

                # Sum team DMG so we can compute each player's share
                abbrs = list(ROLE_ABBR.values())
                team_dmg_total = sum(
                    parse_num(row.get(f"{side} {abbr} DMG", "")) or 0
                    for abbr in abbrs
                )
                if team_dmg_total <= 0:
                    continue

                opp_gold = parse_num(row.get(f"{opp} Gold", ""))
                opp_dmg_total = sum(
                    parse_num(row.get(f"{opp} {abbr} DMG", "")) or 0
                    for abbr in abbrs
                )

                for role, abbr in ROLE_ABBR.items():
                    my_dmg  = parse_num(row.get(f"{side} {abbr} DMG", ""))
                    if my_dmg is None or my_dmg <= 0:
                        continue

                    # Estimated gold = team_gold × (player_dmg / team_dmg_total)
                    my_gold_est = team_gold * (my_dmg / team_dmg_total)
                    my_gpm      = my_gold_est / duration_min
                    raw_gpms[role].append(my_gpm)

                    # Diff GPM only when opponent data is also available
                    if opp_gold and opp_dmg_total > 0:
                        opp_dmg = parse_num(row.get(f"{opp} {abbr} DMG", ""))
                        if opp_dmg and opp_dmg > 0:
                            opp_gold_est = opp_gold * (opp_dmg / opp_dmg_total)
                            opp_gpm      = opp_gold_est / duration_min
                            diff_gpms[role].append(my_gpm - opp_gpm)

    print(f"Processed {row_count} rows, skipped {skipped}\n")

    output = {"raw": {}, "diff": {}}

    print("=== RAW GPM ANCHORS ===")
    for role in ROLE_ABBR:
        vals = raw_gpms[role]
        print(f"\n{role}: {len(vals)} samples")
        if vals:
            anchors = build_anchors(vals, PERCENTILE_TARGETS)
            output["raw"][role] = anchors
            for pct, val in anchors:
                print(f"  p{pct:3d} → {val} g/min")
        else:
            print("  No data")

    print("\n=== GPM DIFFERENTIAL ANCHORS ===")
    for role in ROLE_ABBR:
        vals = diff_gpms[role]
        print(f"\n{role}: {len(vals)} samples")
        if vals:
            anchors = build_anchors(vals, PERCENTILE_TARGETS)
            output["diff"][role] = anchors
            for pct, val in anchors:
                print(f"  p{pct:3d} → {val:+d} g/min")
        else:
            print("  No data")

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n✓ Saved to {OUTPUT_FILE}")

    print("\n\n=== PASTE THIS INTO app.js (replace var GPM_ANCHORS = { ... }) ===\n")
    print("var GPM_ANCHORS = {")
    print("  raw: {")
    for role in ROLE_ABBR:
        if output["raw"].get(role):
            print(f"    {role}: {json.dumps(output['raw'][role])},")
    print("  },")
    print("  diff: {")
    for role in ROLE_ABBR:
        if output["diff"].get(role):
            print(f"    {role}: {json.dumps(output['diff'][role])},")
    print("  }")
    print("};")


if __name__ == "__main__":
    main()
