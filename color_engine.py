import cv2
import numpy as np
from math import sqrt, sin, cos, atan2, exp, radians

# =================================================
# PHASE 7: IMAGE PRE-PROCESSING
# =================================================

def preprocess_roi(image_path, roi=None):
    """
    Loads image, applies basic cleaning and returns ROI.
    ROI avoids folds, edges, selvedge.
    """
    img = cv2.imread(image_path)
    if img is None:
        return None

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # If ROI not provided, take center crop (safe default)
    h, w, _ = img.shape
    if roi is None:
        cx, cy = w // 4, h // 4
        roi = (cx, cy, w // 2, h // 2)

    x, y, rw, rh = roi
    roi_img = img[y:y+rh, x:x+rw]

    # Median filter to remove texture noise
    roi_img = cv2.medianBlur(roi_img, 5)

    return roi_img


# =================================================
# PHASE 8: RGB → L*a*b* (Mean + Std Deviation)
# =================================================

def extract_lab_stats(roi_img):
    """
    Converts ROI to L*a*b* and returns mean & std deviation.
    """
    if roi_img is None:
        return None, None

    lab = cv2.cvtColor(roi_img, cv2.COLOR_RGB2LAB)
    pixels = lab.reshape(-1, 3).astype(np.float32)

    mean_lab = pixels.mean(axis=0)
    std_lab = pixels.std(axis=0)

    # OpenCV 8-bit LAB: L in [0,255], a/b in [0,255] with +128 offset.
    # CIEDE2000 expects CIE L* in [0,100] and a*, b* in ~[-128, 127].
    L_corrected = mean_lab[0] * 100.0 / 255.0
    a_corrected = mean_lab[1] - 128.0
    b_corrected = mean_lab[2] - 128.0
    mean_lab_cie = np.array([L_corrected, a_corrected, b_corrected], dtype=np.float64)

    return mean_lab_cie, std_lab


# =================================================
# PHASE 9: ΔE 2000 (Industry Standard)
# =================================================

def delta_e_2000(lab1, lab2):
    """
    Computes CIEDE2000 colour difference between two Lab values.
    """
    L1, a1, b1 = lab1.astype(float)
    L2, a2, b2 = lab2.astype(float)

    avg_L = (L1 + L2) / 2
    C1 = sqrt(a1**2 + b1**2)
    C2 = sqrt(a2**2 + b2**2)
    avg_C = (C1 + C2) / 2

    G = 0.5 * (1 - sqrt((avg_C**7) / (avg_C**7 + 25**7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2

    C1p = sqrt(a1p**2 + b1**2)
    C2p = sqrt(a2p**2 + b2**2)

    h1p = atan2(b1, a1p) % (2 * np.pi)
    h2p = atan2(b2, a2p) % (2 * np.pi)

    dLp = L2 - L1
    dCp = C2p - C1p

    dhp = h2p - h1p
    if abs(dhp) > np.pi:
        dhp -= 2 * np.pi * np.sign(dhp)

    dHp = 2 * sqrt(C1p * C2p) * sin(dhp / 2)

    avg_Lp = (L1 + L2) / 2
    avg_Cp = (C1p + C2p) / 2

    if abs(h1p - h2p) > np.pi:
        avg_hp = (h1p + h2p + 2 * np.pi) / 2
    else:
        avg_hp = (h1p + h2p) / 2

    T = (
        1
        - 0.17 * cos(avg_hp - radians(30))
        + 0.24 * cos(2 * avg_hp)
        + 0.32 * cos(3 * avg_hp + radians(6))
        - 0.20 * cos(4 * avg_hp - radians(63))
    )

    d_ro = 30 * exp(-((avg_hp - radians(275)) / radians(25)) ** 2)
    R_C = sqrt((avg_Cp**7) / (avg_Cp**7 + 25**7))
    S_L = 1 + (0.015 * (avg_Lp - 50) ** 2) / sqrt(20 + (avg_Lp - 50) ** 2)
    S_C = 1 + 0.045 * avg_Cp
    S_H = 1 + 0.015 * avg_Cp * T
    R_T = -sin(2 * d_ro) * R_C

    dE = sqrt(
        (dLp / S_L) ** 2 +
        (dCp / S_C) ** 2 +
        (dHp / S_H) ** 2 +
        R_T * (dCp / S_C) * (dHp / S_H)
    )

    return dE
