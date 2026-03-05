from grouping import assign_shade_group
from color_engine import delta_e_2000
import numpy as np

# ----------- GLOBAL STORAGE -----------
ROLL_DATA = []

def add_roll(roll_no, image_path, lab):
    ROLL_DATA.append({
        "roll_no": roll_no,
        "image_path": image_path,
        "lab": lab,
        "shade_group": "-",
        "delta_e": None
    })

def get_all_rolls():
    return ROLL_DATA

def perform_grouping(master_lab):
    """
    For each roll in ROLL_DATA, compute ΔE vs master_lab, assign shade/decision, update roll in place.
    """
    global ROLL_DATA
    for roll in ROLL_DATA:
        if "lab" in roll and roll["lab"] is not None:
            lab = np.asarray(roll["lab"], dtype=np.float64)
        elif "L*" in roll and "a*" in roll and "b*" in roll:
            lab = np.array([roll["L*"], roll["a*"], roll["b*"]], dtype=np.float64)
        else:
            continue
        de = delta_e_2000(lab, master_lab)
        shade, decision = assign_shade_group(de)
        roll["delta_e"] = round(de, 2)
        roll["shade_group"] = shade
        roll["decision"] = decision
    return ROLL_DATA

def save_results(rows):
    """Append the provided result rows into ROLL_DATA (in-memory store)."""
    global ROLL_DATA
    if rows:
        ROLL_DATA.extend(rows)
    return ROLL_DATA
