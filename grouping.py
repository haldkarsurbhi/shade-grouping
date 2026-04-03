from color_engine import delta_e_2000

# =================================================
# PHASE 10: SHADE GROUPING LOGIC (Industry Friendly)
# =================================================

def assign_shade_group(delta_e):
    """
    Assigns shade group and decision based on ΔE2000 vs master.

    Rule: only ΔE >= 5.0 is rejected (REJECT / REJECT). Below 5.0, rolls are
    never rejected; they map to A–D by ΔE bands (all ACCEPT) so the four-card
    UI still reflects match quality.
    """
    delta_e = float(delta_e)
    if delta_e < 0:
        delta_e = 0.0

    if delta_e >= 5.0:
        return "REJECT", "REJECT"

    if delta_e < 1.25:
        return "A", "ACCEPT"
    if delta_e < 2.5:
        return "B", "ACCEPT"
    if delta_e < 3.75:
        return "C", "ACCEPT"
    return "D", "ACCEPT"


def group_rolls_against_master(rolls, master_lab):
    """
    Groups fabric rolls by comparing each roll with master shade

    rolls: list of dicts
        [
          {
            "roll_no": "...",
            "lab": np.array([L, a, b])
          }
        ]

    master_lab: Lab value of approved reference fabric
    """

    results = []

    for roll in rolls:
        de = delta_e_2000(roll["lab"], master_lab)
        shade, decision = assign_shade_group(de)

        roll_result = {
            "roll_no": roll["roll_no"],
            "L*": round(roll["lab"][0], 2),
            "a*": round(roll["lab"][1], 2),
            "b*": round(roll["lab"][2], 2),
            "delta_e": round(de, 2),
            "shade_group": shade,
            "decision": decision
        }

        results.append(roll_result)

    return results


def regroup_shades_by_l_star(rolls: list[dict]) -> list[dict]:
    """
    Reassign shade A–D from current batch L* only (lightness quartiles).
    Higher L* = lighter; lightest quarter → A, then B, C, darkest → D.
    Decisions: A/B ACCEPT, C HOLD, D REJECT (aligned with four-card UI).
    Input rows may include roll_no and L_star, L*, or lab[0]. Output preserves
    input order; only rows with a resolved L* get new shade_group/decision.
    """
    if not rolls:
        return []

    def get_l(row: dict):
        if row.get("L_star") is not None:
            try:
                return float(row["L_star"])
            except (TypeError, ValueError):
                return None
        if row.get("L*") is not None:
            try:
                return float(row["L*"])
            except (TypeError, ValueError):
                return None
        lab = row.get("lab")
        if lab is not None and len(lab) >= 1:
            try:
                return float(lab[0])
            except (TypeError, ValueError):
                return None
        return None

    keyed = []
    for r in rolls:
        L = get_l(r)
        if L is not None:
            keyed.append({**r, "_L": L})

    n = len(keyed)
    if n == 0:
        return [dict(r) for r in rolls]

    # Lightest first (high L*)
    keyed.sort(key=lambda x: x["_L"], reverse=True)
    assignments: dict[str, tuple[str, str]] = {}
    for i, row in enumerate(keyed):
        q = min(3, int(4 * i / n))
        shade = ("A", "B", "C", "D")[q]
        if shade in ("A", "B"):
            decision = "ACCEPT"
        elif shade == "C":
            decision = "HOLD"
        else:
            decision = "REJECT"
        rn = row.get("roll_no")
        if rn is not None:
            assignments[str(rn)] = (shade, decision)

    out = []
    for r in rolls:
        rn = r.get("roll_no")
        key = str(rn) if rn is not None else None
        base = {k: v for k, v in r.items() if not str(k).startswith("_")}
        if key and key in assignments:
            sh, dec = assignments[key]
            base["shade_group"] = sh
            base["decision"] = dec
        out.append(base)
    return out
