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

from openpyxl.utils import get_column_letter
for sheet, cells in {"使用说明":["B6","B14"],"参数中心":["A2","A67"]}.items():
    ws=wb[sheet]
    for addr in cells: print("CELL", sheet, addr, repr(ws[addr].value))
refs=[]
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value,str) and cell.value.startswith("=") and "回测评估" in cell.value:
                refs.append((ws.title,cell.coordinate,cell.value))
print("FORMULA_REFS_TO_BACKTEST", refs)
print("DEFINED_NAMES", list(wb.defined_names))
print("VALIDATION_COUNTS", {ws.title: len(ws.data_validations.dataValidation) for ws in wb.worksheets})
