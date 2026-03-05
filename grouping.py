from color_engine import delta_e_2000

# =================================================
# PHASE 10: SHADE GROUPING LOGIC (Industry Friendly)
# =================================================

def assign_shade_group(delta_e):
    """
    Assigns shade group and decision based on ΔE2000.
    Takes a single float delta_e; returns (shade, decision).
    """
    delta_e = float(delta_e)

    if delta_e <= 2.0:
        return "A", "ACCEPT"

    elif delta_e <= 4.0:
        return "B", "ACCEPT"

    elif delta_e <= 6.0:
        return "C", "ACCEPT"

    elif delta_e <= 8.0:
        return "D", "ACCEPT"

    elif delta_e <= 8.5:
        return "E", "HOLD"

    else:
        return "REJECT", "REJECT"


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
