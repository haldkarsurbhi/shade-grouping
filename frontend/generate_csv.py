import csv
import datetime
import random

BUYERS = ["H&M", "PRL (Polo Ralph Lauren)", "Dressmann", "Lacoste"]
SUPPLIERS = ["Arvind Mills", "Vardhman Textiles", "Loyal Textile Mills"]


def classify_delta(delta_e):
    if delta_e <= 1.0:
        return "Group A", "Accept"
    if delta_e <= 2.5:
        return "Group B", "Accept"
    if delta_e <= 4.0:
        return "Group C", "Accept"
    if delta_e <= 5.5:
        return "Group D", "Hold"
    return "Reject", "Reject"


def build_rows():
    random.seed(26)
    lots = [
        ("HM-NV", BUYERS[0], SUPPLIERS[0], 22.0, 1.2, -6.2, 12),
        ("PRL-WH", BUYERS[1], SUPPLIERS[1], 91.8, 0.2, 1.9, 12),
        ("DR-BK", BUYERS[2], SUPPLIERS[2], 13.8, 1.1, 0.2, 12),
        ("LA-GR", BUYERS[3], SUPPLIERS[0], 36.8, -6.9, 7.7, 12),
        ("HM-GY", BUYERS[0], SUPPLIERS[2], 57.8, 0.9, 0.7, 12),
        ("PRL-BG", BUYERS[1], SUPPLIERS[0], 69.7, 5.6, 15.1, 12),
        ("DR-CH", BUYERS[2], SUPPLIERS[1], 27.4, 1.3, -0.2, 12),
    ]

    start_date = datetime.date(2026, 3, 1)
    rows = []
    for lot_idx, (prefix, buyer, supplier, base_l, base_a, base_b, count) in enumerate(lots):
        lot_date = start_date + datetime.timedelta(days=lot_idx)
        for roll in range(1, count + 1):
            if prefix in ("HM-NV", "DR-BK", "DR-CH"):
                delta = round(random.uniform(0.4, 6.2), 2)  # darker lots vary more
            else:
                delta = round(random.uniform(0.2, 4.6), 2)
            shade, verdict = classify_delta(delta)
            rows.append([
                lot_date.isoformat(),
                f"{prefix}-{roll:03d}",
                buyer,
                supplier,
                random.randint(104, 134),
                round(base_l + random.uniform(-1.5, 1.5), 1),
                round(base_a + random.uniform(-0.8, 0.8), 1),
                round(base_b + random.uniform(-0.8, 0.8), 1),
                delta,
                shade,
                verdict,
                "",
            ])
    return rows


def main():
    writer = csv.writer(open("inspection_data_generated.csv", "w", newline="", encoding="utf-8"))
    writer.writerow(["Date", "Roll ID", "Buyer", "Supplier", "Quantity (m)", "L*", "a*", "b*", "DeltaE", "Shade Group", "Verdict", "Image"])
    writer.writerows(build_rows())
    print("Generated inspection_data_generated.csv")


if __name__ == "__main__":
    main()
