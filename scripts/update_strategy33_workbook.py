from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.utils import get_column_letter
from pathlib import Path
import os

path = Path("策略3.3.xlsx")
wb = load_workbook(path, data_only=False)
assert "回测评估" in wb.sheetnames, f"缺少预期工作表，实际为：{wb.sheetnames}"

# Ensure no formulas depend on the worksheet that is being removed.
formula_refs = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            value = cell.value
            if isinstance(value, str) and value.startswith("=") and "回测评估" in value:
                formula_refs.append(f"{ws.title}!{cell.coordinate}: {value}")
if formula_refs:
    raise RuntimeError("发现对回测评估的公式引用，停止删除：" + "; ".join(formula_refs))

# Remove obsolete backtest evaluation tab.
del wb["回测评估"]

# Remove stale workbook instructions that still point users to the deleted tab.
usage = wb["使用说明"]
usage["B6"] = (
    "①【自动交易执行】新增自动买入、自动卖出、USDT资金规划、Simple Earn赎回意图与到账核对说明，明确当前测试网/生产开关。\n"
    "②【使用说明】保留每周最小操作清单与从演示到真实环境的分步指南。\n"
    "③【资产池】保留峰值更新辅助判断、审核日期与下次复审字段，强化白名单维护纪律。\n"
    "④【参数中心】保留备用金触发参数、参数备注与策略变更记录。\n"
    "⑤【每周检查清单】将每周动作整理为可勾选流程。\n"
    "⑥【总览】展示本周行动优先级提示。\n"
    "⑦【策略边界】策略参数是规则设定，不代表收益保证；自动执行能力及开关状态以“自动交易执行”工作表为准。"
)
usage["B14"] = (
    "①确认“参数中心”B25已切换为真实数据模式。\n"
    "②清空或替换“市场状态”中的演示数值。\n"
    "③清空“周度信号”示例数据。\n"
    "④“资产池”：保留币种、类别与白名单结构，清空最新价、峰值、基本面清单中的示例，并设置真实初始资金。\n"
    "⑤“交易日志”：清空示例行，保留表头与校验公式。\n"
    "⑥先完成 Binance Spot Testnet 买入/卖出全链路演练，核对订单状态、逐笔成交、手续费、持仓与资金台账。\n"
    "⑦生产 BUY/SELL 与 Simple Earn 真实赎回默认关闭；未完成独立安全验收并取得明确授权前，不得开启生产交易。"
)
usage["B6"].alignment = Alignment(wrap_text=True, vertical="top")
usage["B14"].alignment = Alignment(wrap_text=True, vertical="top")
usage.row_dimensions[6].height = 150
usage.row_dimensions[14].height = 150

params = wb["参数中心"]
params["A2"] = "所有数值均为策略参数设定，不代表收益保证或实盘验证结果。"
params["A2"].alignment = Alignment(wrap_text=True, vertical="center")
change_log = str(params["A67"].value or "")
change_log = change_log.replace(
    "未经回测，不得将本表视为实盘验证通过。",
    "本表及自动执行流程尚未完成独立实盘安全验收，不得视为实盘验证通过。"
)
params["A67"] = change_log
params["A67"].alignment = Alignment(wrap_text=True, vertical="top")

# Add a single authoritative automation specification sheet.
if "自动交易执行" in wb.sheetnames:
    del wb["自动交易执行"]
ws = wb.create_sheet("自动交易执行", wb.sheetnames.index("交易日志"))

NAVY = "17365D"
BLUE = "1F4E78"
TEAL = "0F6B78"
PALE_BLUE = "D9EAF7"
PALE_TEAL = "DDEBF7"
PALE_YELLOW = "FFF2CC"
PALE_RED = "FCE4D6"
PALE_GREEN = "E2F0D9"
WHITE = "FFFFFF"
DARK = "1F2937"
GREY = "E7E6E6"
thin_grey = Side(style="thin", color="D5DDE5")

ws.sheet_view.showGridLines = False
ws.sheet_properties.tabColor = TEAL
ws.merge_cells("A1:F1")
ws["A1"] = "策略3.3｜自动交易执行与资金赎回逻辑"
ws["A1"].font = Font(name="微软雅黑", size=16, bold=True, color=WHITE)
ws["A1"].fill = PatternFill("solid", fgColor=NAVY)
ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[1].height = 34

ws.merge_cells("A2:F2")
ws["A2"] = (
    "本表按当前 gpt 分支代码整理。它描述已存在的队列、预检、订单提交、成交对账和 Simple Earn 资金规划逻辑；"
    "不代表生产交易已启用。当前生产 BUY/SELL 与真实 Simple Earn 赎回均关闭。"
)
ws["A2"].font = Font(name="微软雅黑", size=10, bold=True, color="7F6000")
ws["A2"].fill = PatternFill("solid", fgColor=PALE_YELLOW)
ws["A2"].alignment = Alignment(wrap_text=True, vertical="center")
ws.row_dimensions[2].height = 42

widths = {"A":16, "B":23, "C":38, "D":52, "E":27, "F":39}
for col, width in widths.items():
    ws.column_dimensions[col].width = width

row = 4
def section(title):
    global row
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
    c = ws.cell(row, 1, title)
    c.font = Font(name="微软雅黑", size=11, bold=True, color=WHITE)
    c.fill = PatternFill("solid", fgColor=BLUE)
    c.alignment = Alignment(vertical="center")
    ws.row_dimensions[row].height = 24
    row += 1
    headers = ["模块", "流程节点", "触发条件 / 输入", "系统处理逻辑", "状态 / 安全边界", "对应代码"]
    for col, value in enumerate(headers, 1):
        cell = ws.cell(row, col, value)
        cell.font = Font(name="微软雅黑", size=9, bold=True, color=WHITE)
        cell.fill = PatternFill("solid", fgColor=TEAL)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(bottom=thin_grey)
    ws.row_dimensions[row].height = 25
    row += 1

def add(module, node, trigger, logic, status, code, status_fill=None):
    global row
    values = [module, node, trigger, logic, status, code]
    for col, value in enumerate(values, 1):
        cell = ws.cell(row, col, value)
        cell.font = Font(name="微软雅黑", size=9, bold=(col == 1), color=DARK)
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        cell.border = Border(bottom=thin_grey)
        if col == 1:
            cell.fill = PatternFill("solid", fgColor=PALE_BLUE)
        elif col == 5 and status_fill:
            cell.fill = PatternFill("solid", fgColor=status_fill)
        elif row % 2 == 0:
            cell.fill = PatternFill("solid", fgColor="F7FAFC")
    ws.row_dimensions[row].height = 58 if max(len(str(v)) for v in values) > 170 else 48
    row += 1

section("一、总执行架构与触发条件")
add("信号入口", "买入信号入队",
    "Dashboard 获取 Binance 数据；source=binance、数据非 STALE、账户状态已知；买入类型为 head/add/reserve，且无阻断原因。",
    "以最后一根已收盘周线作为来源周，生成 symbol + 买入类型 + 标签 + 来源周的稳定事件键；重复刷新只返回已有队列，不重复创建订单。",
    "只生成待买意图，不代表已下单；无有效价格、金额或来源周则跳过。",
    "components/Dashboard.tsx；lib/execution/signal-queue.ts；queue.ts",
    PALE_GREEN)
add("信号入口", "卖出信号入队",
    "Dashboard 数据为新鲜 Binance 数据且账户已知；策略产生有效 SELL 数量。",
    "将 takeProfit、indicatorProfit、trailStop、baseReduce 映射为卖出事件；按来源周与档位生成稳定事件键并持久化预留。",
    "fundamental_exit 未纳入自动卖出映射，需人工复核；重复事件不会再次入队。",
    "components/Dashboard.tsx；lib/execution/sell-signal-queue.ts；sell-store.browser.ts",
    PALE_GREEN)
add("后台调度", "周期对账与执行",
    "看板页面挂载、浏览器标签页可见；每30秒执行一次，并在挂载后立即执行一次。",
    "优先只读对账已提交买单/卖单；在数据新鲜、账户已知且对应测试网开关开启时，才尝试提交队列订单；随后投递已确认成交通知。",
    "页面关闭或标签页隐藏时不持续执行；这不是云端常驻交易机器人。多标签页使用本地存储锁/租约协调。",
    "components/ExecutionBackground.tsx",
    PALE_YELLOW)
add("本地持久化", "队列与台账",
    "买卖事件、资金预留、成交明细和通知事件进入浏览器本地存储。",
    "IndexedDB 保存待买队列、待卖事件、资金预留、成交台账、Simple Earn 赎回意图和成交通知 Outbox。",
    "本地资金预留不是交易所冻结；不跨设备同步，清理浏览器数据会影响本地恢复能力。",
    "lib/execution/store.browser.ts；sell-store.browser.ts",
    PALE_YELLOW)

section("二、自动买入 BUY 流程")
add("BUY", "1. 生成买入意图",
    "策略信号为 head（头仓）、add（补仓）或 reserve（备用金），blocked 为空，计划 USDT 金额与价格有效。",
    "记录策略版本、计划金额、参考价格、来源周与信号时的底仓比例；同一周同一档位通过稳定事件键幂等去重。",
    "仅新鲜 Binance 数据、账户已知时创建；当前信号不是订单，需经过后续预检。",
    "lib/execution/signal-queue.ts；queue.ts")
add("BUY", "2. 资金与交易规则预检",
    "待买订单为 pending/partially_filled；获取最新 Spot USDT free、交易对规则和本地活动资金预留。",
    "按剩余计划金额、单币剩余成本上限、未被其他订单预留的 USDT 计算可执行金额；检查交易对 TRADING、报价资产 USDT、最小名义金额和数量/精度规则。",
    "余额不足则等待；低于最小名义金额或交易规则不满足则不提交；预检本身为只读 DRY_RUN。",
    "lib/execution/binance-order.browser.ts；binance-preflight.ts")
add("BUY", "3. 本地资金预留",
    "预检通过且需要提交订单。",
    "再次按最新 Spot USDT free 计算可用额度，扣除其他活动订单的本地预留；对当前订单原子预留资金，避免多个队列争用同一份余额。",
    "预留不等于 Binance 锁定；发现余额低于已有预留或记录损坏时停止并要求核对。",
    "lib/execution/fund-reservation.ts；store.browser.ts")
add("BUY", "4. 提交市价买单",
    "队列状态允许提交；测试网客户端开关开启；服务端环境为 Spot Testnet，买入开关开启且有测试网 Key/Secret。",
    "先领取唯一 attempt 并生成确定性 clientOrderId，再向服务端 /api/binance/testnet-order 提交 MARKET BUY，使用 quoteOrderQty（USDT 金额）。",
    "服务端还要求 Dashboard Basic Auth、同源 Origin 和合法 JSON；生产环境无下单通道。当前默认关闭，非实盘功能。",
    "buy-order-submit.browser.ts；binance.browser.ts；app/api/binance/testnet-order/route.ts",
    PALE_RED)
add("BUY", "5. 订单与成交对账",
    "订单提交后或请求超时/状态不明。",
    "按 clientOrderId 只读查询订单快照和逐笔成交；核对累计成交数量、成交金额、成交方向、成交 ID 与手续费；仅确认成交写入台账。",
    "部分成交保留剩余金额；终态零成交后才可能安全重试。未知状态、第三资产手续费无法换算、成交冲突时冻结并人工复核，禁止盲目重发。",
    "lib/execution/sync-buy-order.browser.ts；fill-reconcile.ts；store.browser.ts",
    PALE_GREEN)

section("三、自动卖出 SELL 流程")
add("SELL", "1. 卖出事件与去重",
    "策略给出止盈、指标止盈、追踪止损或底仓减仓信号。",
    "按币种、事件类型、来源周/档位创建唯一事件；已执行、处理中或已预留事件不会重复提交；止盈档位按单币事件生命周期去重。",
    "基本面退出未接入自动卖出；只接受明确支持的四种卖出事件。",
    "lib/execution/sell-signal-queue.ts；sell-store.browser.ts")
add("SELL", "2. 周期仓与底仓保护",
    "卖出事件进入预检前。",
    "普通止盈、指标止盈、追踪止损只能使用周期仓；base_reduce 走独立事件类型，单次最多使用剩余受保护底仓的50%。指标止盈距上次不足14天拒绝，累计不超过初始周期仓的50%。",
    "重复事件、无可卖周期仓、底仓减仓条件不满足均阻断；不得用普通卖出事件动用长期底仓。",
    "lib/execution/sell-guard.ts；sell-signal-queue.ts")
add("SELL", "3. Binance 持仓与数量预检",
    "待卖事件为 pending，读取实时价格、交易对过滤器、Spot free/locked 持仓。",
    "把本地确认成交台账重放为底仓/周期仓，再与 Binance 总持仓核对；按 free 数量、保护底仓、stepSize、minNotional 和当前价格计算最终可卖数量。",
    "本地台账与交易所持仓不一致、余额锁定或规则不满足时停止卖出；只允许使用可用 free 数量。",
    "sell-preflight.browser.ts；sell-order.browser.ts；position-accounting.browser.ts")
add("SELL", "4. 提交市价卖单",
    "预检通过、事件未被领取；测试网卖出开关与服务端测试网环境开关同时开启。",
    "先保存 clientOrderId 并锁定事件，再通过服务端代理提交 MARKET SELL（基础币数量）；返回订单后绑定 Binance orderId。",
    "当前生产 SELL 硬关闭；请求超时或结果不明确时事件转 reconcile_required，不重新 POST。",
    "sell-order-submit.browser.ts；lib/binance.ts；app/api/binance/testnet-order/route.ts",
    PALE_RED)
add("SELL", "5. 卖出成交对账",
    "卖单已提交或状态不明。",
    "按 orderId/clientOrderId 读取订单与逐笔成交，核对成交数量、金额、手续费和方向；确认成交后才更新持仓桶、实现盈亏和已执行档位。",
    "部分成交保留事件状态；订单/成交记录不匹配或手续费无法可靠折算时暂停并人工复核。",
    "sync-sell-order.browser.ts；fill-reconcile.ts；position-accounting.ts",
    PALE_GREEN)

section("四、Simple Earn USDT 赎回与买入资金衔接")
add("资金规划", "1. 先用现货 Spot",
    "待买订单需要 USDT，读取 Spot free 和 USDT Flexible Earn 持仓。",
    "优先计算 Spot 可用 USDT；扣除本地活动买单预留后，只把资金缺口列为可能赎回金额。",
    "规划与现货余额快照不等于已赎回或已到账；不能把理财持仓直接当作 Spot free。",
    "lib/execution/earn-redemption.browser.ts；wallet-funds.ts")
add("资金规划", "2. 计算活期可赎回额度",
    "读取 USDT Flexible Earn 产品明细。",
    "可用额度 = 持仓总额 - 赎回中金额 - 冻结金额 - 本地其他赎回意图预留；按 productId 分配；锁定期限产品不纳入。",
    "canRedeem 未明确为 true 时按不可赎回处理；缺少 productId、字段异常或可用额不足则停止生成安全赎回计划。",
    "wallet-funds.ts；earn-redemption.ts")
add("赎回意图", "3. 建立幂等赎回计划",
    "Spot 资金不足且存在可用 Flexible Earn USDT。",
    "按订单ID + productId 生成稳定 intent，记录赎回金额、赎回前 Spot free、状态与创建时间；重复规划返回既有活动意图。",
    "状态包括 planned、submitting、submitted、redeeming、credited、reconcile_required、failed。",
    "earn-redemption.ts；store.browser.ts")
add("真实赎回", "4. 提交赎回请求",
    "只有赎回开关开启、意图为 planned、最新产品余额足够并成功原子领取后才允许提交。",
    "目标账户固定为 SPOT；提交后保存 redemptionId。当前代码 LIVE_EARN_REDEMPTION_ENABLED=false，Binance Spot Testnet 不支持 Simple Earn SAPI。",
    "真实赎回目前硬关闭；当前浏览器赎回适配器仍有空 Key/Secret 占位，启用前必须迁移为服务端签名代理并单独审查，不能直接打开开关。",
    "earn-redemption.browser.ts；binance.browser.ts；binance-environment.ts",
    PALE_RED)
add("到账对账", "5. 核实赎回到账",
    "已存在 redemptionId 或需要恢复状态的赎回意图。",
    "只读查询赎回历史，要求 redemptionId、产品、USDT金额、目的账户SPOT精确匹配；再检查 Spot USDT free 相对赎回前余额足额增加。",
    "历史记录与 Spot free 双重确认后才标记 credited，并扩展对应买单的本地资金预留；处理中继续等待，无法唯一匹配或未到账转人工复核；禁止盲目重发。",
    "earn-redemption.browser.ts；earn-redemption.ts；store.browser.ts",
    PALE_GREEN)

section("五、当前开关、运行边界与上线条件")
add("交易开关", "测试网 BUY/SELL 双重门禁",
    "浏览器侧 NEXT_PUBLIC_BINANCE_SPOT_TESTNET=1，并分别开启 NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED / SELL_ENABLED；服务端 BINANCE_SPOT_ENVIRONMENT=testnet，并分别开启 BINANCE_TESTNET_BUY_ENABLED / SELL_ENABLED。",
    "服务端还必须配置 BINANCE_TESTNET_API_KEY、BINANCE_TESTNET_API_SECRET；订单路由要求 Dashboard Basic Auth 与同源请求。",
    "任何一侧开关关闭、密钥缺失或服务端不是 testnet，均拒绝订单 POST；生产环境始终拒绝此测试网订单路由。",
    "lib/binance.browser.ts；lib/binance.ts；binance-environment.ts；app/api/binance/testnet-order/route.ts",
    PALE_RED)
add("赎回开关", "Simple Earn 真实赎回",
    "当前 LIVE_EARN_REDEMPTION_ENABLED 为编译期 false。",
    "仅完成资金规划、意图保存和赎回历史/到账核对代码；提交函数被硬开关阻断。",
    "Spot Testnet 不支持 Simple Earn；生产赎回尚未迁移到安全的服务端签名代理。不得把“赎回计划”当成“已自动赎回”。",
    "lib/binance.browser.ts；earn-redemption.browser.ts；lib/binance.ts",
    PALE_RED)
add("通知", "确认成交邮件",
    "买入/卖出逐笔成交已通过交易所对账并写入本地成交台账。",
    "以 symbol + fillId 构造 Outbox 事件；使用租约避免多标签页重复投递，失败采用指数退避重试，经同源服务端签名后转发 Worker。",
    "通知不触发交易；策略信号提醒与已确认成交邮件是不同事件。",
    "notification-outbox.ts；notification-dispatch.browser.ts；/api/trade-fill-notifications")
add("存储与恢复", "跨标签页、重启和未知状态",
    "多标签页同时处理、浏览器重启或网络超时。",
    "IndexedDB 事务、唯一事件键、attempt/clientOrderId、租约和状态机用于防重与恢复；订单/赎回状态未知时先查历史。",
    "IndexedDB仅在当前浏览器配置内；不是交易所资金锁，也不是跨设备数据库。状态无法确认时暂停而不是重试。",
    "store.browser.ts；sell-store.browser.ts；order-reconcile.ts；earn-redemption.ts")
add("人工计划", "人工计划 CSV 与自动订单区分",
    "用户需要提前查看未来补仓/止盈价位。",
    "prep-orders 只生成人工计划与 CSV；止盈后可重算回补/止盈参考价。",
    "人工计划不是交易所挂单，不会触发自动下单；自动队列与成交台账才是执行流程依据。",
    "lib/execution/prep-orders.ts；prep-store.browser.ts")

# Final formatting and workbook calculation settings.
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A5:F{row-1}" if row > 5 else None
ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.page_setup.orientation = "landscape"
ws.page_setup.paperSize = ws.PAPERSIZE_A3
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0
ws.sheet_view.zoomScale = 80
ws.print_title_rows = "1:4"
ws.sheet_format.defaultRowHeight = 18
ws.sheet_properties.outlinePr.summaryBelow = True

# Apply a consistent thin outline and wrap behavior to the entire new sheet.
for row_cells in ws.iter_rows(min_row=1, max_row=row-1, min_col=1, max_col=6):
    for cell in row_cells:
        if cell.value is not None and cell.alignment.wrap_text is not True:
            cell.alignment = Alignment(
                horizontal=cell.alignment.horizontal,
                vertical=cell.alignment.vertical or "top",
                wrap_text=True,
            )

# The workbook contains formulas; request a full recalculation when opened.
try:
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.forceFullCalc = True
    wb.calculation.calcMode = "auto"
except Exception:
    pass

# Save and structural assertions.
wb.save(path)
check = load_workbook(path, data_only=False)
assert "回测评估" not in check.sheetnames
assert "自动交易执行" in check.sheetnames
assert check.sheetnames.index("自动交易执行") < check.sheetnames.index("交易日志")
assert "回测评估" not in str(check["使用说明"]["B6"].value)
assert "回测评估" not in str(check["使用说明"]["B14"].value)
assert "自动交易执行" in str(check["使用说明"]["B6"].value)
assert len(check.sheetnames) == 11
formula_count = sum(1 for sh in check.worksheets for row_cells in sh.iter_rows() for c in row_cells if isinstance(c.value, str) and c.value.startswith("="))
validation_count = sum(len(sh.data_validations.dataValidation) for sh in check.worksheets)
print("UPDATED_SHEETS", check.sheetnames)
print("FORMULAS", formula_count)
print("DATA_VALIDATIONS", validation_count)
print("AUTO_EXEC_ROWS", check["自动交易执行"].max_row)
print("AUTO_EXEC_COLS", check["自动交易执行"].max_column)
print("BACKTEST_TEXT_REMAINING", [(sh.title, c.coordinate, str(c.value)[:100]) for sh in check.worksheets for row_cells in sh.iter_rows() for c in row_cells if isinstance(c.value, str) and ("回测评估" in c.value or "回测" in c.value)])
print("FILE_BYTES", path.stat().st_size)
