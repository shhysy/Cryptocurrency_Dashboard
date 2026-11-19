from openpyxl import load_workbook
from openpyxl.styles import Alignment
from pathlib import Path
p=Path("策略3.3.xlsx")
wb=load_workbook(p,data_only=False)
ws=wb["使用说明"]
ws["A15"]="自动交易安全纪律"
ws["B15"]=(
 "生产环境 BUY/SELL 与 Simple Earn 真实赎回默认关闭。\n"
 "测试网订单必须同时满足浏览器开关、服务端 Testnet 环境开关、对应方向开关、服务端测试网密钥及 Dashboard 身份认证。\n"
 "只有交易所确认的逐笔成交才能更新持仓、成本、已执行档位和成交通知；订单状态不明时先按 clientOrderId 对账，禁止盲目重发。\n"
 "Simple Earn 赎回必须核实赎回历史与 Spot USDT 到账；当前真实赎回开关关闭，启用前必须完成服务端签名改造与独立审查。"
)
ws["B15"].alignment=Alignment(wrap_text=True,vertical="top")
ws.row_dimensions[15].height=112
try:
 wb.calculation.fullCalcOnLoad=True
 wb.calculation.forceFullCalc=True
 wb.calculation.calcMode="auto"
except Exception: pass
wb.save(p)
check=load_workbook(p,data_only=False)
assert "回测评估" not in check.sheetnames
assert check["使用说明"]["A15"].value=="自动交易安全纪律"
assert "回测" not in str(check["使用说明"]["B15"].value)
left=[]
for sh in check.worksheets:
 for row in sh.iter_rows():
  for c in row:
   if isinstance(c.value,str) and "回测" in c.value: left.append((sh.title,c.coordinate,c.value[:80]))
print("BACKTEST_TEXT_REMAINING",left)
assert not left
formulas=sum(1 for sh in check.worksheets for row in sh.iter_rows() for c in row if isinstance(c.value,str) and c.value.startswith("="))
validations=sum(len(sh.data_validations.dataValidation) for sh in check.worksheets)
print("SHEETS",check.sheetnames)
print("FORMULAS",formulas)
print("VALIDATIONS",validations)
assert len(check.sheetnames)==11 and formulas==2291 and validations==13

print('BACKTEST_REFERENCES_REMOVED')
