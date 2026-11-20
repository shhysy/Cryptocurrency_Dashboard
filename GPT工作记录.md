# GPT工作记录

> 主开发分支：gpt。项目规则唯一依据《策略3.3》。每次开发前先读取本文件和《Grok工作记录.md》。

## 安全约束
- 生产现货BUY/SELL关闭；Simple Earn自动赎回关闭。
- 不使用真实余额测试，不发送真实订单，不申购/赎回/划转。
- API密钥仅放本地环境文件；仓库只保留无密钥示例。
- 订单提交结果不明时进入对账/人工复核，不盲目重试。
- 只有确认成交事件可改变持仓；IndexedDB只是本地浏览器存储，不是交易所资金锁，也不保证跨设备同步。

## 历史已完成（需以当前代码/CI复核）
- BUY资金预留与订单状态同事务校验、attempt fencing、Earn top-up快照校验。
- fake-indexeddb覆盖并发预留、并发claim、事务abort、升级阻塞等模拟场景。
- 只读执行状态总览面板。
- 历史CI run 44481270903曾有326项通过、唯一SELL guard用例失败；不可作为当前CI状态。

## 策略3.3切换（2026-11-19）
用户确认《长期投资策略V3.2_优化版_V3.3(1).xlsx》为唯一权威规则，项目统一称《策略3.3》。旧V2.0和旧代码参数只作历史参考。工作簿有11个工作表；其中V3.3备注将积极型备用金跌幅改为60%，备用金企稳条件改为至少2项。

## GPT负责范围
1. 逐项核对strategy.config、engine、indicators、market data、BUY preflight、fund reservation、position accounting和UI。
2. 优先核查已收盘周线，分离signalAsOf与executionPrice。
3. 核验固定单币额度与山寨持仓数量上限；现金比例、核心/山寨净值比例、单周净值比例及组合回撤在策略3.3表中仅作展示，不自动压缩固定买入额度。关键行情字段缺失仍阻断；仅完整性标记为否时展示STALE并要求人工复核，不单独硬阻断。
4. 核对积极/保守形态的头仓、冷却、补仓、备用金、底仓和止盈参数。
5. 完成真实浏览器IndexedDB多标签页、重启恢复及配额耗尽测试。
6. 设计历史回测和基准比较，先验证后上线。

## 禁止
不得擅自修改策略3.3参数、评分权重、触发阈值、买卖档位、底仓比例或生产开关。优化建议先记录差异并提交用户确认。

## 每次提交记录
文件/规则来源、测试命令与结果、CI链接和commit SHA、未覆盖风险及回滚方案。

## 用户A–G决策确认（2026-11-19）
用户选择A2/B2/C2/D2/E2/F2/G2，具体值以docs/策略3.3/策略3.3用户确认决策.md为准。A：BTC/PAXG核心、ETH保守；B：保留50/30/80比例，保守倍数1.3/1.6/2；C：五档评分；D：100分映射；E：固定额度，不做账户净值比例压缩；F：保留自动执行架构但LIVE默认关闭；G：展示软失败并标记stale。H未选择。E2意味着账户级比例风控不可宣称已实现；G2不等于stale数据可获真实交易许可。

## 规则更新记录（2026-11-19）
- 已更新根目录《项目规则.md》：所有Git commit标题和正文必须使用中文，禁止纯英文提交说明；Push结果汇报、分支说明、PR标题与正文、审查意见及项目工作记录均使用中文。必要技术名词、文件名、分支名和代码标识符可保留英文。
- 本次仅修改项目规则与工作记录，未修改业务代码；未运行测试（文档变更）。


## 策略3.3工作簿落实A2–G2（2026-11-19）
- 已直接更新仓库根目录 `策略3.3.xlsx`，不是只更新说明文档。
- A2：资产池调整为BTC/PAXG核心积极型；ETH归入保守型；ALT-2/ALT-3继续保守型，保留原有待审核状态。
- B2：积极型止盈倍数2/3/5、保守型1.3/1.6/2；两种形态三档比例均为50%/30%/80%，卖出数量仍受剩余周期仓限制。
- C2：MA200五档（0.7/0.8/0.9/1.0/1.05，对应30/24/18/12/6分）；恐惧贪婪五档（10/15/25/35/40，对应30/25/20/10/5分）。备用金极度恐惧门槛25独立保留，不与评分第一档混用。
- D2：原始分项理论满分90，线性映射为100分；买入门槛61/83，高分头仓89/100。
- E2：改为固定单币额度；不按账户现金比例、净值占比、组合回撤或单周净值比例缩减/阻断固定额度；保留单币成本上限、市场状态系数、冷却期、山寨持仓数量上限及执行层真实USDT余额复核。
- F2：工作簿说明项目自动执行架构继续开发，但LIVE默认关闭，生产BUY/SELL关闭。
- G2：完整性标记为否时展示STALE并要求人工复核；关键行情字段缺失、日志异常、白名单、基本面、极端风险等实际硬条件仍会阻断。H项未选择，未作变更。
- 本次同步更新了工作簿标题、使用说明、参数说明、总览及回测对象描述；保留原11个工作表、公式和数据验证结构。

## 本次提交与验证
- 工作簿提交：`e66b0fe`（按用户确认决策更新策略3.3工作簿）。
- GitHub工作簿文件Blob SHA：`ae176cd79dee2c5a68621aa195c1c709b99605a0`。
- 一次性工作簿更新流程：GitHub Actions运行 `44491044953` 成功；脚本输出“策略3.3工作簿修改及结构校验通过”，随后提交工作簿并清理临时脚本/工作流。
- 本地使用LibreOffice重新计算副本：11个工作表、2291个公式、13项数据验证，未发现公式缓存错误。
- 标准CI运行 `44491299366`：成功，包含npm测试与TypeScript类型检查。
- 临时重复触发的辅助job曾因一次性脚本已由前一轮成功任务清理而失败；已恢复原 `.github/workflows/ci.yml`，该次CI中的常规validate任务成功，最终标准CI运行通过。
- 本次未修改策略引擎业务代码；后续仍需逐项核对代码与Excel，并完成回测及样本外验证，不代表策略已获实盘验证。


## 文档精简与冗余清理（2026-11-19）
- 统一根目录 README 的策略来源与A2–G2规则说明，策略参数唯一来源明确为 `策略3.3.xlsx`。
- 修正 `项目规则.md` 中旧工作簿文件名及不存在的 `STRATEGY.md`、旧矩阵路径引用。
- 将测试分层、验收要求合并进 `docs/策略3.3/策略3.3规则实现矩阵.md`，矩阵明确记录A2–G2覆盖值和当前核对状态。
- 删除重复/过期文件：`策略3.3说明.md`、`docs/策略3.3/README.md`、`docs/策略3.3/策略3.3规则手册.md`、`docs/策略3.3/策略3.3代码核对与测试说明.md`；测试要求已合并进矩阵。
- 删除根目录 `page.html`：这是引用Next.js开发HMR资源的旧构建页面快照，非应用入口；正式入口为 `app/page.tsx`。
- 在 `lib/execution/PHASE_28.md` 标注历史止盈参数已被最新B2决策覆盖，避免误用旧配置。
- 保留GPT/Grok工作记录、用户决策记录、SELL状态机审查、Worker部署说明和各阶段记录；这些分别承担协作审计、决策追溯、部署操作或历史实现证据，不属于可直接删除的重复文件。
- 初步发现 `lib/trading/` 是早期未接入页面的执行内核原型，`lib/execution/` 才是当前执行层；暂时保留旧原型及测试，避免未经依赖核查删除历史代码。
- 本轮为文档与旧页面清理，未修改策略业务代码；GitHub Actions运行 44492212672 在记录时仍处于进行中，需以最终状态为准。


## 执行层文档与历史记录归档（2026-11-19）
- 将原 `lib/execution/PHASE_3.md` 至 `PHASE_21.md` 及 `PHASE_27.md` 至 `PHASE_29.md` 共22份阶段记录完整合并到 `lib/execution/PHASE_HISTORY.md`，保留原正文并标注为历史记录；删除分散的原阶段文件。
- 重写 `lib/execution/README.md`，只保留当前架构、模块职责、安全规则、验收边界和历史档案入口，移除重复阶段说明及相互矛盾的旧状态。
- 删除根目录 `AUTO_TRADING_DESIGN.md`，其当前架构和安全边界已并入执行层README；旧进度记录由PHASE_HISTORY保留。
- 进一步确认通知链路并非完全重复：分数达标邮件、卖出信号提醒、交易所确认成交邮件触发条件不同，暂时保留；旧 `lib/trading/` 原型也保留，避免未经完整依赖核查删除。
- 当前分支最新清理仍需以GitHub Actions最终结果为准；本轮未修改策略引擎或订单业务逻辑。

- 补充修正 `workers/SELL_EMAIL_ALERT_SETUP.md`：明确该Worker只发送策略卖出信号提醒，与已确认成交邮件分开；更新为当前服务端 `/api/dashboard` 数据链路，移除旧的浏览器直连说明。

## 清理未接通的浏览器数据入口（2026-11-19）
- 检查 `app/page.tsx`、`components/Dashboard.tsx` 与 API 路由后确认：页面刷新始终请求同源 `/api/dashboard`；旧 `NEXT_PUBLIC_DIRECT_BINANCE` 分支仅返回 mock 占位数据，没有接入 `getBrowserDashboard`。
- 删除未被调用的 `lib/service.browser.ts`，并从 `app/page.tsx` 移除无效的浏览器直连占位分支及其 mock 导入；保留仍被执行层调用的 `lib/binance.browser.ts`。
- 已检索 `NEXT_PUBLIC_DIRECT_BINANCE`、`getBrowserDashboard`、`service.browser` 的仓库代码引用，未发现其他引用。
- 该项清理涉及页面入口代码，需以最新CI测试与类型检查结果确认。


## 策略3.3工作簿：移除回测评估并新增自动交易执行说明（2026-11-19）
- 从 `策略3.3.xlsx` 删除独立的 `回测评估` 工作表；同步清理 `使用说明` 的变更记录、真实环境操作步骤和旧“回测纪律”段落，统一替换为自动交易安全纪律；参数中心说明更新为策略参数设定不代表收益保证或实盘验证结果。
- 新增 `自动交易执行` 工作表（37行），按当前代码整理总执行架构、买入队列/预检/资金预留/测试网市价单/成交对账、卖出事件/底仓周期仓保护/持仓预检/测试网市价单/成交对账、Simple Earn Spot优先资金规划/活期额度分配/赎回意图/到账核对、通知、后台调度和安全开关。
- 明确BUY/SELL仅具备受双端环境开关约束的Spot Testnet提交路径；生产BUY/SELL硬关闭。Simple Earn已有资金规划、赎回意图和到账核对逻辑，但 `LIVE_EARN_REDEMPTION_ENABLED=false`，Spot Testnet不支持Simple Earn SAPI，当前浏览器赎回适配器仍有空Key/Secret占位；启用前必须迁移为服务端签名代理并独立审查。
- 明确ExecutionBackground只在看板挂载且标签页可见时约每30秒运行；IndexedDB是当前浏览器本地状态，不是交易所资金锁或跨设备数据库；未知订单/赎回状态先对账，不盲目重发；人工预备订单CSV不等于自动订单。
- 删除后工作簿保持11张表；原有2291个公式、13项数据验证规则保留；LibreOffice重算后1276个公式单元格有缓存值、0个公式缓存错误；工作簿内“回测”文字残留为0。
- 工作簿更新提交：`80a273f`（新增自动交易执行表并删除回测表）、`ddda51b`（清理最后的回测提示）、`2e97a6f`（重算并保存公式缓存）。以最后提交的 `策略3.3.xlsx` 为准。
- 本次仅更新工作簿及工作记录，没有修改订单执行代码，也没有启用生产交易或真实理财赎回。


## 策略3.3代码核对与首轮差异修复（2026-11-20）

### 用户确认的策略口径
- 用户明确确认：止盈比例50% / 30% / 80%以**本轮初始周期仓**为统一基数，而不是每次按剩余周期仓重复乘比例。
- 以初始周期仓100个币为例：止盈1目标50个、止盈2目标30个、止盈3目标80个；前两档累计卖出80个后，第三档最多只能卖出剩余20个。
- 该口径已写入 `docs/策略3.3/策略3.3用户确认决策.md` 和 `docs/策略3.3/策略3.3规则实现矩阵.md`。

### 已修复的代码差异
1. `strategy.config.ts`：保守型止盈倍数修正为1.3 / 1.6 / 2；积极型继续使用2 / 3 / 5。
2. `strategy/engine.ts`：新增初始周期仓止盈数量计算函数；普通策略止盈目标以本轮初始周期仓为基数，并受剩余周期仓约束；周线指标不再使用未收盘周线；追踪止损峰值改用买入后的已收盘周线最高价。
3. `strategy/post-take-profit-rebuy.ts`：止盈后顺序档位按初始周期仓比例计算，保留当前剩余周期仓上限。
4. `lib/execution/prep-orders.ts`：人工计划的止盈比例说明同步改为初始周期仓目标口径，避免CSV/人工计划说明与自动策略不一致。
5. `strategy/indicators.ts`、`lib/dashboard.ts`：增加已收盘周线筛选，并让BTC市场状态与策略评分使用同一收盘周线口径；实时价格仍独立用于价格/MA比较、突破及交易触发。
6. `components/Dashboard.tsx`、`components/ExecutionBackground.tsx`：刷新开始和刷新失败时撤销新订单许可；只有Binance非STALE、账户已知且快照年龄不超过120秒时，才允许创建/提交新订单；只读对账不受此限制。
7. `lib/mock.ts`：调整示例买入场景，使其在不使用未收盘周线计算RSI的条件下仍能正确展示买入信号。
8. 补充/更新 `strategy/engine.test.ts`、`strategy/post-take-profit-rebuy.test.ts`、`lib/execution/prep-orders.test.ts`，覆盖止盈比例、资产分类、未收盘周线、追踪止损最高价及回归场景。

### 本轮修改文件
- `strategy.config.ts`
- `strategy/engine.ts`
- `strategy/indicators.ts`
- `strategy/engine.test.ts`
- `strategy/post-take-profit-rebuy.ts`
- `strategy/post-take-profit-rebuy.test.ts`
- `lib/execution/prep-orders.ts`
- `lib/execution/prep-orders.test.ts`
- `lib/dashboard.ts`
- `lib/mock.ts`
- `lib/mock.test.ts`
- `components/Dashboard.tsx`
- `components/ExecutionBackground.tsx`
- `docs/策略3.3/策略3.3用户确认决策.md`
- `docs/策略3.3/策略3.3规则实现矩阵.md`

### 测试与提交记录
- CI Run `44695407917`（提交 `a0d419b800f1df0d91d7501cec20cac850085e76`）：npm测试通过，TypeScript类型检查通过。
- 后续又追加 `components/Dashboard.tsx` 快照年龄许可检查（提交 `1123eceb9a0be5e9a6e0a537cd86fb0e56b43f3a`）及矩阵记录（提交 `21164be741fed9891d88f3dd47dafd3a6013b2fd`）；两项提交对应的最新CI当时仍在运行，须以最终状态为准。
- 期间多次CI失败属于修复过程中的中间提交：旧测试仍按“剩余周期仓比例”断言、测试K线时间未模拟当前未收盘周线、以及变量命名/组件属性未同步；均已在后续提交中修正。不得把中间失败记录误认为最终结果。
- 所有Git提交说明均使用中文。
- 本轮没有开启生产BUY/SELL，没有启用Simple Earn真实赎回，也没有使用真实资金下单。

### 尚未完成的核对项
- 仍需逐项核对策略3.3工作簿的成交量、清仓冷却、基本面失效、白名单和组合限制等H项/未决规则。
- 需审查卖出部分成交终态后同一止盈档剩余目标是否有安全恢复/续卖机制。
- 需核对底仓减仓后周期仓可卖数量是否按确认成交正确重算。
- 需完成测试网买卖全链路实测、历史回测/样本外验证和独立风险验收；当前CI通过不等于实盘验收。


## 向Grok指派SELL专项任务（2026-11-20）
- 已在《Grok工作记录.md》新增由GPT主导的专项任务，提交：a2a24f8f47a7b59dcce62276bf93fa9cd06d6c37。
- 任务一（最高优先级）：追踪底仓减仓 base_reduce 的真实确认成交账本，核查并修复底仓保护量及周期仓可卖数量重算；覆盖未确认成交、幂等、冲正、多笔部分成交与数量精度。
- 任务二（高优先级）：核查止盈订单部分成交后进入终态时，是否错误地把档位视为全部完成；设计仅在最终对账确认、无活动/未知订单时安全续卖剩余目标。
- 保持策略3.3及用户确认的止盈比例口径不变：50%/30%/80%均按本轮初始周期仓计算，且受当前真实剩余周期仓限制。未知订单不得盲目重发。
- Grok仅修改其职责白名单内的SELL文件、专属测试和状态机文档；如需跨边界改共享模型或GPT文件，先提出方案等待GPT协调。
- 要求mock/dry-run测试，不触发真实BUY/SELL或Simple Earn赎回；提交说明使用中文，推送gpt分支，并回报测试、类型检查、CI、commit SHA及剩余风险。GPT负责独立复核与最终验收。
- 当前状态：已指派，等待Grok执行；尚无代码修复结果。


## GPT继续开发：山寨币组合数量上限边界修复（2026-11-20）
- 用户要求GPT继续完成Grok任务以外的工作。本轮先检查策略引擎、看板组合统计、BUY信号队列、资金预留与持仓账本，未修改Grok主责SELL文件。
- 发现并修复 `strategy/engine.ts` 的边界问题：原先用 `findHead` 是否识别出头仓决定是否检查山寨币组合新增名额，但 `findHead` 的金额门槛高于看板的非尘埃持仓统计门槛，导致已有小额山寨持仓可能被误判为新币。现改为仅在 `input.qty <= 0` 时占用新增名额检查；头仓/补仓识别逻辑保持不变，`altMaxCount=3` 不变。
- 修改文件：`strategy/engine.ts`、`strategy/engine.test.ts`；新增回归用例覆盖“已有小额山寨持仓且组合计数为3时，补足同一币头仓不被误阻断”，并保留“无持仓且已持有3个山寨币时阻断新开”。
- 提交：代码 `9857136660c56fd7a3a7f83f2d8b1cc929042da1`；测试 `6406613b443d2265806dfc7563c295b1e334eaba`；矩阵 `731bcd64ed00d399e53ea10b9bf40ec4cffd4038`。
- CI：测试提交对应 Run `44697343391`（https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44697343391）和代码提交对应 Run `44697325336`（https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44697325336）在记录时仍运行中；未将其标记为通过。
- 代码审计备注：`strategy/engine.ts` 当前不使用K线成交量字段 `Candle.v` 参与评分或买入/卖出条件；策略矩阵与本轮可见配置也没有确认成交量阈值，因此不擅自新增量能过滤条件。需对照策略3.3 Excel具体工作表/单元格确认该项是否为策略规则，若不是则仅作为可选增强建议。
- 基本面失效方面，当前引擎在浮亏达到 `review.lossLine` 且BTC熊市时仅输出“请复核基本面（不自动卖出）”提示；未发现可直接从策略参数确定的自动清仓规则。本轮不擅自把人工复核提示改成自动卖出。
- 组合限制方面，当前策略引擎明确不按账户净值、现金比例、组合占比或单周买入额缩减固定额度；保留单币成本上限、BTC市场状态系数、冷却期、山寨数量上限。BUY队列另行检查Binance账户已知、数据非STALE和真实USDT余额/交易所过滤器。
- 未完成：浏览器多标签页/重启/配额耗尽实测、Spot Testnet全链路、历史回测及样本外验证；生产BUY/SELL与Simple Earn真实赎回仍关闭。


## Grok SELL专项独立复核（2026-11-20）
- Grok已提交初版逻辑（`92d029d749c4ca846ac7195835f3efb7de21f66a`）及两轮测试提交（`81c84499517e189fbefdaefb3a8fcdc85c711bf0`、`a3890efb01d64d7314f8b2c12c2bef7b2bd40deb`），但尚未通过验收。
- CI Run `44697493516`、`44697527380`、`44697613344` 均失败；最新Run中347项测试有5项失败，失败包含同周部分成交未生成resume事件，以及原测试断言未按新业务语义更新。
- GPT独立代码审查发现两个明确缺陷：①同周原止盈eventKey在resume计算前被提前幂等continue，阻断同周续卖；②底仓减仓pending锁仅精确匹配含sourceWeek的eventKey，跨周可能重复创建base_reduce事件。
- 已在《Grok工作记录.md》追加独立复核意见及返工任务，要求修复上述根因、补齐未知/未确认成交与最新持仓数量边界测试、运行全量测试/类型检查/CI，并再次交GPT验收。
- 当前SELL专项状态：初版已提交，**验收未通过，返工中**。生产BUY/SELL与Simple Earn真实赎回继续关闭。


## Grok后续排队任务：成交通知Outbox租约安全审计（2026-11-20）
- 已在《Grok工作记录.md》排入任务三，必须等当前SELL任务一、二返工并通过全量测试/CI后再开始，避免分散关键修复资源。
- 任务范围仅限通知Outbox领取、租约、围栏令牌、失败退避、批量回执与服务端幂等；不得修改BUY资金预留和共享成交账本。
- 已记录初步待核查点：`sending + leaseUntil=null` 当前可能被视为立即可领取，损坏的无租约事件可能触发重复投递；需审查超时后服务端已接受但浏览器未收到回执的重试语义。
- 该任务尚未开始，不计入已完成项目功能。


## GPT独立优化：BUY资金预留与提交领取原子化（2026-11-20）

### 审计发现
- `submitQueuedBuyOrder` 原流程先执行 `reserveBuyFunds`（资金预留事务），再单独执行 `claimBuyOrderSubmission`（订单领取事务）。两个事务之间存在竞态窗口：预检后订单可能发生变化，或另一个标签页先领取提交权，导致本次领取失败但此前已写入的资金预留残留。
- 另外，预检与预留之间如果其他订单先占用余额，重新计算出的可预留金额可能低于预检执行金额；旧流程在检测不足后抛错，但较小的预留记录可能已经写入，造成资金被无订单提交地占住。
- IndexedDB单独的readwrite事务可串行化，但原先把预留和claim拆成两个事务，无法保证两者作为一个原子操作完成。

### 本轮修复
- 在 `lib/execution/store.browser.ts` 新增 `reserveAndClaimBuyOrderSubmission`：在同一个IndexedDB readwrite事务中读取当前订单、读取并校验预留记录、重新核算余额预留、检查预检时订单版本/attempt是否变化，并一次性写入资金预留与 `reconcile_required` 提交锁。
- 只有当前可预留金额足以覆盖本次预检执行金额时才领取提交权；不足时事务中止，不留下新预留，也不增加attempt。
- 在 `lib/execution/buy-order-submit.browser.ts` 改为调用原子接口，删除原先分开的预留与claim步骤。订单在网络预检期间发生变化时会被版本检查拦截。
- 在 `lib/execution/store.browser.test.ts` 新增测试：同一订单并发调用只能有一个成功并产生一笔预留；可用余额被其他订单占用后，本订单领取失败且不残留预留/不改变订单状态。

### 提交与验证
- 原子接口：`5f2b88505f1b5efb4c4c23029ad20bb9f04fa4d3`。
- BUY提交调用调整：`5adc69e62bc483900d73e0662daa106d7b16652b`。
- 并发/余额竞态测试：`49404f62fbc1cbba5941b36802435faf7ba249fa`。
- 类型边界修正：`79de4b3af260452525fa8d5ba096ecf129fa3a86`。
- CI Run `44699203176` 暴露了新函数闭包内的TypeScript窄化问题，已在后续提交修正；Run `44699266149` 触发于修正前的测试提交，须检查最终分支HEAD对应的CI再判断本轮结果。
- 当前SELL已有5项测试失败仍未解决；不能把全分支CI视为通过，也不能把本轮BUY原子化修复标记为整体验收通过。

### 安全边界与后续
- 此修复仅改善浏览器本地IndexedDB内的预留/领取原子性；不是Binance交易所资金锁，不解决跨设备或不同浏览器数据库的竞争，也不代表Testnet/生产下单已经验收。
- 后续继续核查Simple Earn赎回服务端签名迁移、BUY订单终态/部分成交对账、成交手续费计价、浏览器多标签页与重启恢复。
- 生产BUY/SELL与Simple Earn真实赎回保持关闭。

## Grok返工优先级再次确认（2026-11-20）
- 最新Grok提交新增SELL自动化节拍，但SELL队列两个既有缺陷仍未修复；最新CI仍因SELL相关5项测试失败而未通过。
- 已再次更新《Grok工作记录.md》，要求暂停自动化节拍扩展和Outbox任务，优先修复同周止盈resume及跨周base_reduce活动锁，并提交全量测试、类型检查和成功CI证据。
- 当前状态：Grok SELL任务未验收；GPT BUY原子预留修复已提交，CI待最终HEAD确认。


## GPT安全审计：币安签名只读代理增加认证与同源保护（2026-11-20）
- 审计发现 `app/api/binance/signed-read/route.ts` 原先只做请求体大小、JSON格式和服务端allowlist检查，没有像测试网订单代理一样校验Dashboard Basic Auth与请求Origin。该路由使用服务端API凭证读取账户、成交与订单数据；若部署入口未由外部访问控制完整保护，公开调用可能暴露账户私有数据。
- 已为签名只读路由增加服务端 `DASHBOARD_PASSWORD` Basic Auth校验、常量时间密码比较、必须同源Origin校验、请求体字节数上限、拒绝未知body字段和统一no-store响应头。
- 新增 `app/api/binance/signed-read/route.test.ts`，覆盖缺少/错误密码、跨站/缺失Origin、非JSON、未知字段、畸形/超大body以及通过认证后只转发允许参数。
- 提交：路由安全修复 `6f12d784b286b8640c17d38ebf820dc563844abf`；安全测试 `26e8b97e549e1840fc1597dc049306b7ad23cbb2`。
- 当前CI Run `44699597592` 与 `44699621968` 在记录时仍运行中；需确认浏览器已有Basic Auth会话下signed-read请求兼容，并以最新分支CI最终结果为准。
- 此项只保护账户只读代理入口，不启用任何交易权限，也不替代Cloudflare Access/部署层访问控制。生产BUY/SELL和Simple Earn真实赎回继续关闭。


### 补充CI结果（2026-11-20）
- BUY原子预留相关测试及新增签名只读路由安全测试均已进入全量测试集；CI Run `44699621968` 显示42个测试文件中40个通过、2个失败，355项测试中350项通过、5项失败，5项失败全部来自Grok主责的 `sell-signal-queue.resume.test.ts` 与 `sell-signal-queue.test.ts`。
- 同一Run的 `npm run typecheck` 已执行且通过；因此当前GPT新增代码的类型检查没有失败证据，新增BUY与signed-read测试也已通过。
- 全分支CI仍为失败，不能将本轮标记为全量验收通过；待Grok修复SELL剩余5项失败后重新运行全量CI。
- 最新工作记录提交后另触发Run `44699677826`，当时排队中，最终状态待查。


## 自动交易实盘切换总目标与GPT工作包（2026-11-20）

### 用户最终验收目标
开发、测试、部署配置完成后，用户只需把服务端环境文件中的Binance测试网Key/Secret换成生产Key/Secret，并按明确的生产模式开关步骤切换，即可按《策略3.3》运行自动BUY/SELL；订单对账、持仓账本、通知和风险保护必须完整工作。不得把“测试网能下单”当作项目完成。

### 当前代码审计确认的阻断项
1. `app/api/binance/testnet-order/route.ts`调用的`submitTestnetSpotMarketOrder`在`lib/binance.ts`内硬性拒绝非Testnet环境；当前没有Production下单API。
2. `lib/binance-environment.ts`的`resolveBinanceSpotSubmissionSwitches`对Production始终返回BUY/SELL关闭；浏览器`lib/binance.browser.ts`也将BUY/SELL提交开关限定为Testnet，LIVE常量硬编码false。
3. `app/api/dashboard/route.ts`没有在路由内显式验证Dashboard认证；部署层可能有Cloudflare Access，但必须确认真实部署保护，不可仅依赖假设。
4. Simple Earn赎回虽然有意图与对账流程，但赎回提交在浏览器适配器中硬关闭；需要迁移到服务端签名代理并做独立安全审计，不能把当前规划/只读对账当成自动赎回完成。
5. `ExecutionBackground`仅在看板挂载且页面可见时每30秒运行；若用户要求页面关闭仍自动运行，必须增加服务端定时调度/持久化队列/租约和安全部署方案。目前架构不能宣称全天候无人值守。
6. IndexedDB本地资金预留不能充当交易所资金锁，也不能跨设备协调；生产前必须评估服务端持久化订单队列/原子claim及账户级并发保护。

### GPT负责工作包（与Grok SELL返工并行）
- P1：设计并实现服务端统一Spot订单执行适配器，明确testnet/production双环境端点、独立凭证读取、服务端BUY/SELL双重开关、Basic Auth/Origin/请求schema/限流与审计日志；production默认关闭，绝不因切换Key自动下单。
- P2：统一浏览器端提交接口，移除前端环境变量/硬编码Testnet限制；浏览器只请求同源服务端订单路由，绝不持有API Secret。
- P3：审查BUY订单部分成交、终态、手续费、订单/成交历史完整性和当前余额核对；未知状态冻结，禁止盲目重试。
- P4：Simple Earn赎回迁移到服务端专用路由，增加产品白名单、额度上限、双重开关、认证、Origin、幂等、对账和人工恢复路径；未完成前继续关闭真实赎回。
- P5：确认Dashboard/API部署认证、Cloudflare Access和Secrets配置；补齐生产环境配置检查、启动自检和清晰的“尚未就绪”状态。
- P6：服务端常驻自动执行评估：若目标包含页面关闭后持续运行，采用Cloudflare Workers Cron/Queues或等效持久化调度，不能仅靠客户端setInterval；设计重入锁、持久化队列、可观测性、告警与暂停开关。
- P7：整理一份用户最终操作手册：仅列需要设置的真实环境变量、Binance Key权限建议、Cloudflare Secrets设置、部署步骤、首次小额验证与紧急停机步骤。真实密钥只由用户在部署平台配置。

### 总验收门槛
- Grok SELL专项通过独立复核；Outbox审计完成。
- BUY/SELL生产与测试网适配器分别测试，确保环境隔离，Testnet凭证永不回退到Production，Production凭证永不被Testnet路径读取。
- mock测试、Spot Testnet全链路、全量测试、类型检查、构建、部署预览全部通过；真实生产订单仅在用户明确授权后做受控首次验证。
- 服务端密钥不进入浏览器bundle、日志、Git或客户端错误信息；无默认开启的生产交易开关。
- 明确页面关闭运行能力；若未实现服务端定时执行，最终文档必须标注“看板页面必须保持打开”。
- 完成前不得告诉用户只换Key即可实盘；生产BUY/SELL与Simple Earn真实赎回保持关闭。

### 任务分配
- Grok：GitHub Issue #2，先SELL状态机返工，再Outbox租约审计；未经GPT独立验收不得推进后续任务。
- GPT：负责生产/测试网服务端执行架构、BUY核对、安全、Earn服务端迁移、部署/定时运行方案和最终验收。

## 自动交易生产切换开发进展（2026-11-20）

### 用户最新确认
用户要求继续使用模拟凭证/mock/Spot Testnet 完成自动交易开发，不等待真实 Key；最终目标是用户配置真实 Binance Key 后，系统即可按《策略3.3》运行自动 BUY/SELL。GPT负责总体架构、BUY和生产执行；Grok负责SELL核心缺陷，先通过后再处理Outbox。

### 新建任务
- Grok：Issue #2（SELL状态机返工，先修复5项CI失败，再做Outbox）。
- GPT：Issue #3（生产可切换的自动交易执行链路）。
- 已在Issue #2留言再次要求优先修复SELL根因，不得跳过测试或提前开展Outbox。

### GPT本轮实际代码修改
1. `lib/binance-environment.ts`
   - 新增 `isSpotOrderSubmissionEnabled`，分别按testnet/production和BUY/SELL四个维度读取服务端授权。
   - 测试网开关不能授权生产；生产开关不能授权测试网；BUY开关不能授权SELL。
2. `lib/binance-environment.test.ts`
   - 新增4组环境/方向隔离测试，覆盖默认关闭、跨环境授权拒绝、BUY/SELL独立授权。
3. `lib/binance.ts`
   - 新增统一服务端 `submitSpotMarketOrder`，按服务端环境选择已隔离的凭证和API endpoint，签名只在服务端进行。
   - 原 `submitTestnetSpotMarketOrder` 保留为测试网专用兼容包装，生产模式下明确拒绝。
   - 生产和测试网分别使用独立服务端开关；响应字段不匹配或无法解析时仍要求先对账，禁止自动重发。
4. `app/api/binance/spot-order/route.ts`
   - 新增统一服务端下单路由，要求Dashboard Basic Auth、同源Origin、JSON、2KiB请求体限制和严格字段白名单。
5. `app/api/binance/spot-order/route.test.ts`
   - 新增路由认证、Origin、Content-Type、请求体、字段白名单和转发测试。
6. `lib/binance.browser.ts`
   - 浏览器BUY/SELL入口改为根据当前前端环境选择对应的NEXT_PUBLIC开关，并调用统一服务端下单路由；浏览器仍不持有API密钥。
7. `.env.example`
   - 增加生产BUY/SELL前端显示开关示例，生产服务端开关默认0。

### 本轮提交
- `dbf08fbba11b6b49597e863681ee8df1828556e7`：增加按环境隔离的服务端买卖授权开关。
- `2c650874269e262b28924bf8834a8abea923aefd`：补充生产与测试网订单开关隔离测试。
- `015c64ff76897065c43fbbf921a816876fce8021`：统一测试网与生产环境服务端市价订单适配器。
- `b559210abf44549976739b62c08c4220e7560506`：新增统一现货下单服务端安全路由。
- `4faec36f03b6ca303f6aebb64131513583353a71`：新增统一Spot下单路由安全测试。
- `704c2358a3999bc4593844d52122a242a4157c58`：浏览器订单提交改用统一服务端接口。
- `3dff6e977b3a8b13642a2d03821d116fd26fb72c`：补充生产环境独立买卖开关示例。

### 尚未验收/明确限制
- 本轮GitHub文件提交未在本地执行Vitest、typecheck、build；必须以最新CI结果为准。
- 统一下单适配器尚未完成订单规则过滤、服务端限流、审计持久化、账户级并发锁和自动成交对账全链路。
- BUY后台编排仍受客户端ExecutionBackground限制；尚未实现服务端持久化定时执行，页面关闭后不能宣称持续自动运行。
- Simple Earn真实赎回仍关闭，浏览器适配器尚未迁移到服务端专用提交路由。
- Grok SELL 5项测试未通过前，不得宣称自动卖出安全或整体自动交易完成。
- 生产BUY/SELL开关默认关闭；本轮没有真实密钥、没有发送真实订单。

### 后续补充提交
- `dce3fff95c2c7def32d3e9e3f29d02de0054cd05`：新增模拟Key的服务端下单适配器环境隔离测试，验证production/testnet endpoint与Key隔离、默认关闭及缺少测试网凭证不回退生产Key。
- `4c8fe3b407ce9ef2afa87908196c3db25e78a48d`：更新统一下单接口与环境配置说明。
- `83c07a8eeea8881dadeb80ef980a8580d2594613`：修正生产交易接口与权限配置说明。
- `9d099a820aaf17c93830142d51f468b8bce7ac17`：固定生产签名请求域名，避免通过自定义 `BINANCE_BASE_URL` 将生产签名请求和API Key发送到非官方域名。
- `835322c894857c9fcc4492b1e2e40dd48b9228d6`：增加生产签名域名固定性测试。

### 当前验证状态
- 已添加环境开关单测、统一下单路由安全测试和模拟凭证适配器测试。
- 本工作环境没有仓库本地检出，无法在此直接运行 `npm test` / `npm run typecheck` / `npm run build`；GitHub当前可查询到的commit status为空，不能把这些测试标记为通过。后续必须通过CI或本地完整检出验证。
- 当前统一下单服务端适配器只是生产交易链路的第一块：仍需补充交易规则服务端核验、订单状态查询与成交对账、服务端持久化队列/定时调度、限流和审计日志。

### 服务端下单二次预检补强
- `lib/binance.ts`：统一下单适配器现在会在发出POST前，从币安读取交易对状态/基础资产/报价资产/市场订单过滤器、实时价格和账户可用余额；只允许TRADING且USDT报价的策略交易对。BUY检查USDT可用余额和quoteOrderQty市场买入能力；SELL检查基础资产可用余额、MARKET_LOT_SIZE步长/范围；两侧都检查适用的MIN_NOTIONAL/NOTIONAL。服务端不信任浏览器预检。
- `lib/binance.order.test.ts`：新增模拟凭证请求序列测试，覆盖交易所endpoint和API Key隔离、生产默认关闭、测试网凭证缺失不回退、余额不足不发送POST、卖出精度不合规不发送POST。
- 新增提交：
  - `f8fe399ede642aefd64779fabc35ad343db4c0b0`：增加服务端交易规则与余额二次预检。
  - `1812eb4e2d222249d3a44fd59abcbde5a8281c98`：扩展模拟下单测试覆盖服务端余额和交易规则预检。
  - `245ea07accd8419f2303bd25ff4b7c2585bd9dd5`：补充余额不足与交易精度拒绝测试。
- 以上仍未本地运行；必须等待CI/检出环境执行。服务端余额检查目前是单次快照，不能代替跨标签页/跨设备的账户级原子预留；生产持久化执行队列和并发锁仍是未完成项。

### 适配器代码复核与修正
- 检查浏览器调用链时发现BUY函数仍引用已重命名的 `postTestnetMarketOrder`，会导致类型检查失败；已修复为 `postSpotMarketOrder`，提交 `ae2503dd11226417f4199ff4811d77fff50b0da6`。
- 修正生产适配器测试：生产公开行情可能走 `data-api.binance.vision`，但签名账户读取与下单必须固定走 `api.binance.com`；测试断言改为验证签名请求域名，提交 `75490b80d1ac3d0ba51ea975238c4a8fcc3ba55e`。
- 当前仍未实际执行测试；这次静态复核已发现并修正一处会影响类型检查的旧函数名引用，说明必须等CI结果后才能继续判断。

### 环境一致性与浏览器密钥面收敛
- `getServerBinanceSpotMode`：服务端只返回当前环境名称，不暴露任何凭证。
- `/api/binance/spot-order`：要求浏览器提交的环境标识与服务端运行环境一致，否则409拒绝下单，避免行情/账户/交易环境错配。
- `/api/binance/signed-read`：增加相同环境一致性检查，避免测试网界面读取生产账户数据或反向错配。
- `lib/binance.browser.ts`：下单和签名只读请求都附带环境标识；移除浏览器端HMAC、时钟签名和Simple Earn直接POST代码，Earn赎回统一 fail-closed，明确等待服务端专用实现。
- 新增测试：下单路由与signed-read路由环境不一致均返回409且不触发币安请求。
- 相关提交：
  - `1c6172fa17938fd21b7e5bbda7716445b7e34466`：增加服务端环境标识。
  - `30017508da223ecf7cbaea8233619b6ffa4beefb`：下单路由环境一致性校验。
  - `5aad09c4db08bb1e5bd07ef4976d66563529257a`：下单请求携带客户端环境标识。
  - `d27d954e6e9de412e3047582c36a40ee861283ff`：下单路由环境错配测试。
  - `01a2a09b925bc4ec97496c5de51a0b598f7f5aa9`：签名只读请求携带客户端环境标识。
  - `c547dc6d3ef15c19238b45091622153700f5dfbd`：signed-read服务端环境一致性校验。
  - `0b937136df5598733d25b98dc6e1da09b1a75bd4`：signed-read环境错配测试。
  - `7765ef4003e358995e8160558687890019abfdb9`、`0444a42ccb84e62131e4406e1084e01f7cd08ec1`：修正Earn说明并彻底移除浏览器端签名/赎回实现。
  - `3a792a4bbac04e3b70d4fc30d4f619cb2f5c9841`：补充生产凭证权限与开关说明。
- 当前CI仍未获得可确认的最新结果；不能将新增测试标记为通过。

### 服务端行情源与下单前置校验安全补强
- `lib/binance.ts` 的生产公开行情源固定为官方 `data-api.binance.vision` 与 `api.binance.com`，不再读取自定义 `BINANCE_BASE_URL`，避免服务端交易预检被非官方价格/交易规则源影响。
- `lib/binance.order.test.ts` 增加模拟环境测试，注入恶意 `BINANCE_BASE_URL` 后确认任何请求都不访问该域名。
- 提交：
  - `a280740667275a8dd6bf79d3294b86d654554f4a`：移除自定义行情域名。
  - `81ab002fb38671bd5838a252fbcd521e6db2bfc3`：增加非官方域名拒绝测试。
- 仍未运行CI；生产端服务端预检目前覆盖交易对/市场过滤器/余额，但策略固定额度、SELL底仓/周期仓约束仍需服务端可信订单意图与持久化成交账本配合，不能只依赖浏览器本地状态。

### Grok SELL修复独立复核（尚未通过）
- Grok已新增 `sell-order-status.ts`，并在 `sync-sell-order.browser.ts` 接线：NEW/PARTIALLY_FILLED 映射为 reconcile_required，终态且成交对账完整后才可能进入本地 partially_filled。
- GPT已在Issue #2提出三项阻断复核：
  1. `sell-order-status.ts` 与 `order-reconcile.ts` 使用固定绝对容差 `1e-8` 判断卖满/超量，对小数量可能误判；需改为按stepSize精度/安全十进制比较并补小数数量测试。
  2. `localEventEligibleForTakeProfitResume` 不应允许 `executed` 但 `filledQty < requestedQty` 的事件续卖；确认仅终态未卖满partial可续卖，并检查 `EXPIRED_IN_MATCH` 等终态。
  3. `runSellAutomationTick` 当前先入队再同步旧partial事件；旧版本IndexedDB中可能遗留仍开放订单的partial状态，升级首个tick可能在复核前创建resume。需先同步旧事件再入队，或提供旧状态冻结迁移，并加升级兼容测试。
- 截至本记录，Grok工作记录仍要求跑专项SELL测试、全量测试、typecheck；GPT尚未获得最新CI全绿证据。SELL仍标记未验收，Outbox继续暂停。


## 自动交易执行继续推进与任务再分配（2026-11-20）

### 最新CI与修复
- 检查最新CI Run `44704043489`：测试步骤失败（44个测试文件通过、1个失败；381项测试中380项通过），TypeScript typecheck成功。
- 唯一失败为 `lib/binance-testnet-order.server.test.ts`：原测试夹具只模拟time和order响应，未模拟新增服务端预检要求的exchangeInfo、ticker及signed account，导致预检按设计拒绝下单。不是放宽生产预检，而是修正测试夹具。
- 已修复测试夹具，按请求路径模拟交易对TRADING状态、USDT报价、MARKET_LOT_SIZE/MIN_NOTIONAL、价格、USDT/BTC余额、服务器时间和订单响应；未知请求直接抛错，避免静默返回伪造订单。
- 提交：`3b1869631e9017ab4f48b602ca36f7ed521c1ecd`（补齐测试网下单预检模拟响应）。
- 最新CI Run `44705056113`：**成功**；Run详情显示Run tests成功、TypeScript typecheck成功。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44705056113
- 该CI只证明当前自动化测试和类型检查通过，不代表SELL独立验收、生产交易验收、build或Cloudflare部署验收完成。

### Grok任务更新（Issue #2）
- Grok已提交SELL修复：数量比较改为stepSize优先/相对容差；续卖只接受partially_filled；SELL节拍先同步旧事件再入队；SELL专项相关文件在最新CI中通过。
- GPT继续要求Grok补齐：sync路径传入交易对stepSize；order-reconcile覆盖EXPIRED_IN_MATCH；本地partial必须有可验证的交易所终态和成交明细对账证据，旧IndexedDB缺少证据时冻结；补首轮升级、重复/缺失fill、超量、手续费精度和多笔partial测试。
- 任务已评论到Issue #2。SELL仍未通过GPT独立验收，Outbox不得提前启动。

### GPT任务更新（Issue #3）
- 已将GPT主责拆分为P0 CI安全基线、P1 BUY成交闭环、P2 Cloudflare服务端持久化执行基础设施、P3 Simple Earn服务端赎回与最终部署。
- P1重点核对固定额度、资金预留、服务端预检、clientOrderId对账、逐笔fill去重、手续费/净持仓更新、部分成交和未知状态冻结。
- P2先交数据模型、迁移、状态机、租约/leaseToken fencing、账户级活动订单锁、审计、退避和死信/人工复核设计；评审通过再接执行，不以浏览器IndexedDB冒充跨设备持久化。
- 所有测试继续使用Mock/Spot Testnet；生产BUY/SELL与真实Earn赎回保持关闭。

## Cloudflare服务端调度基础设施第一阶段（2026-11-20）

- 新增 `docs/策略3.3/服务端自动执行架构设计.md`（提交 `09cf9ec3ba79b6a8d57c7499e52e78d42d15bae3`）：设计OpenNext自定义Worker入口、账户级Durable Object、SQLite持久化订单/attempt/fill/reservation/audit/Outbox、DO Alarm、Cron看门狗、leaseToken/attempt fencing及未知订单恢复。该文档是评审稿，不代表相关服务端调度已实现。
- 新增根目录 `worker.ts`，只把fetch请求转发给OpenNext生成Worker；更新 `wrangler.jsonc` 的 `main` 指向 `worker.ts`。当前尚未加入scheduled handler、DO类导出、DO绑定、migration或Cron触发器。
- 自定义Worker入口验证：Run `44705853349` 与 `44705861821` 均成功；包含npm test、TypeScript typecheck、Next.js production build、Cloudflare OpenNext build。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44705861821
- CI已正式增加Next.js production build和Cloudflare OpenNext build步骤，避免只验证测试与类型而漏掉部署构建问题。
- README已更新当前完成边界和架构设计入口；当前仍依赖浏览器节拍，页面关闭后不保证持续执行。
- 下一阶段：P2-B先实现Durable Object SQLite schema与纯状态机/仓储测试；通过并发、重启、过期租约、fencing、未知POST恢复测试后，再接入实际Binance Testnet适配器。不得先注册生产Cron或启用真实交易。

## P2-B服务端订单状态机核心（2026-11-20）

- 新增 `lib/execution/server-execution-core.ts` 与 `.test.ts`：定义服务端订单意图状态、策略3.3版本约束、USDT报价/十进制金额校验、由strategyEventId派生的确定性幂等intentId、状态迁移、交易所终态与成交对账时间证明、提交前clientOrderId/attempt要求、未知提交结果冻结，以及attempt + leaseToken + leaseUntil fencing。
- 当前仅为纯函数核心与单元测试，尚未接入Durable Object SQLite、订单API或Binance执行器；不代表服务端队列已经落地。
- 最新CI Run `44706677628`：TypeScript typecheck通过；测试395/396通过。唯一失败仍为Grok主责 `sell-signal-queue.test.ts` 中终态partial fixture缺少新要求的终态/成交对账证明字段。Next.js/Cloudflare build因测试失败按CI流程跳过。
- 该提交已证明新增服务端核心测试通过；SELL未全绿前不解除Outbox暂停，不开始生产交易。


## BUY成交历史完整性修复（2026-11-20）

### GPT实际代码修改
- 审计发现 `fetchSpotTradesForOrder`、`fetchSpotTrades`、`fetchBuyTrades` 在达到分页循环上限且最后一页仍满1000条时，会直接返回已取得的数据；调用方可能把被截断的成交历史误当作完整账本。
- 在 `lib/binance.browser.ts` 增加统一分页继续校验：满页必须按最后成交ID继续；最后一页仍满时明确抛错并停止自动记账；成交ID无效、未递增或可能溢出时拒绝继续；先校验分页响应再映射记录。
- 在 `lib/binance.browser.test.ts` 新增三项回归测试，分别覆盖指定订单成交查询20页上限、账户成交查询调用方页数上限、BUY历史成交查询5页上限仍满页时必须失败关闭。
- 本修复不改变策略3.3参数、不改变交易开关、不发出任何订单请求；只读成交历史遇到分页截断将明确报错，不再静默返回不完整数据。

### 提交与验证
- `5972cd61dd8a038b8474ed178a1c3cd06409e075`：防止成交历史分页截断后误判对账完整。
- `1f648fc0541aa9bc9f29627d174612e909b4640a`：增加成交历史分页截断的安全回归测试。
- `de58ad808dc991c83f0ec1c5f5862f4fe858b331`：先校验成交分页再映射并拒绝ID溢出。
- 对应GitHub Actions Run `44708205303` 在记录时仍为进行中；尚无测试、typecheck、Next build或Cloudflare build通过结论。必须以该提交对应Actions最终结果为准。
- 当前仍需进一步审查 `fill-reconcile.ts` 的固定浮点容差、逐笔成交精度与多轮对账原子性；本次分页修复不代表BUY成交闭环验收完成。
- 生产BUY/SELL与Simple Earn真实赎回继续关闭。
