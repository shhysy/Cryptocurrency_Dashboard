from openpyxl import load_workbook
from pathlib import Path
p=Path("策略3.3.xlsx")
wb=load_workbook(p,data_only=False)
assert "回测评估" not in wb.sheetnames
assert "自动交易执行" in wb.sheetnames
assert len(wb.sheetnames)==11
left=[(ws.title,c.coordinate,str(c.value)[:80]) for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value,str) and "回测" in c.value]
assert not left, left
print("PRECHECK_SHEETS",wb.sheetnames)
print("PRECHECK_FORMULAS",sum(1 for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value,str) and c.value.startswith("=")))
