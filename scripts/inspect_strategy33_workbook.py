from openpyxl import load_workbook
from pathlib import Path
p=Path("策略3.3.xlsx")
wb=load_workbook(p, data_only=False)
print("SHEETS", wb.sheetnames)
for ws in wb.worksheets:
    print("\nSHEET", ws.title, "DIM", ws.max_row, ws.max_column)
    hits=[]
    for row in ws.iter_rows():
        vals=[]
        for cell in row:
            v=cell.value
            if isinstance(v,str) and ("回测" in v or "评估" in v):
                vals.append(f"{cell.coordinate}={v[:160]!r}")
        if vals: hits.extend(vals)
    for h in hits: print("HIT", h)

print('INSPECTION_COMPLETE')
