import datetime

# Existing data (from file read)
existing_csv = """Date,Roll ID,Buyer,Supplier,Quantity (m),DeltaE,Shade Group,Verdict,Image
2026-01-05,R101,Zara,Arvind Mills,120,1.2,A,ACCEPT,
2026-01-05,R102,Zara,Vardhman,95,3.6,B,ACCEPT,
2026-01-06,R103,H&M,Arvind Mills,80,6.4,D,HOLD,
2026-01-06,R104,H&M,Local Supplier,60,11.2,REJECT,REJECT,
2026-01-07,R105,Gap,FabIndia,110,0.8,A,ACCEPT,
2026-01-07,R106,Gap,Vardhman,100,2.1,C,HOLD,
2026-01-08,R107,Zara,Arvind Mills,130,0.5,A,ACCEPT,
2026-01-08,R108,H&M,Local Supplier,90,4.2,B,ACCEPT,"""

today = datetime.date.today().isoformat()
start_roll = 109

new_rows = []

def add_batch(color_name, counts):
    global start_roll
    for group, count in counts.items():
        for _ in range(count):
            roll_id = f"R{start_roll}"
            start_roll += 1
            
            # Smart Autofill Logic
            delta_e = 0.5 # Default A
            if group == 'B': delta_e = 1.6
            if group == 'C': delta_e = 2.5
            if group == 'D': delta_e = 4.2
            
            verdict = "ACCEPT"
            if group == 'C': verdict = "HOLD"
            if group in ['D', 'REJECT']: verdict = "REJECT"
            
            # Format: Date,Roll ID,Buyer,Supplier,Quantity (m),DeltaE,Shade Group,Verdict,Image
            row = f"{today},{roll_id},Next,Mills,60,{delta_e},{group},{verdict},"
            new_rows.append(row)

# 1. Orange Shade
add_batch("Orange", {'A': 14, 'B': 1, 'C': 0, 'D': 1})

# 2. Light Blue Shade
add_batch("Light Blue", {'A': 16, 'B': 0, 'C': 0, 'D': 0})

# 3. Blue Shade
add_batch("Blue", {'A': 1, 'B': 0, 'C': 0, 'D': 4})

# Combine
final_csv = existing_csv + "\n" + "\n".join(new_rows)
print(final_csv)
