from color_engine import delta_e_2000

# =================================================
# PHASE 10: SHADE GROUPING LOGIC (Industry Friendly)
# =================================================

def assign_shade_group(delta_e):
    """
    Assigns shade group and decision based on ΔE2000.

    Standardized rule:
      A/B/C => ACCEPT
      D     => HOLD
      E     => REJECT

    Thresholds:
      A: ΔE < 1.25
      B: 1.25 <= ΔE < 2.5
      C: 2.5 <= ΔE < 3.75
      D: 3.75 <= ΔE < 5.0
      E: ΔE >= 5.0
    """
    delta_e = float(delta_e)
    if delta_e < 0:
        delta_e = 0.0

    if delta_e >= 5.0:
        return "E", "REJECT"

    if delta_e < 1.25:
        return "A", "ACCEPT"
    if delta_e < 2.5:
        return "B", "ACCEPT"
    if delta_e < 3.75:
        return "C", "ACCEPT"
    return "D", "HOLD"


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


