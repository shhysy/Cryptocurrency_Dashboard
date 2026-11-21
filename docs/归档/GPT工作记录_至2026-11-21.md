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


### BUY成交数量精度补强（2026-11-20）
- 进一步修复 `lib/execution/fill-reconcile.ts`：移除固定绝对 `1e-8` 容差，改为仅容忍IEEE-754浮点表示误差，并按成交笔数放大计算误差预算；累计数量/金额使用补偿求和，避免多笔成交简单浮点累加误差。
- 同时覆盖BUY和SELL逐笔成交与订单累计数量/金额核对，以及单笔成交 `price × qty` 与 `quoteQty` 的一致性校验。
- `lib/execution/fill-reconcile.test.ts` 新增微小BTC成交测试：正确的 `1e-10` 数量可核对；数量翻倍的差异不会被旧的固定 `1e-8` 容差吞掉。
- 提交：`9e0d809ee4fc3bc152ef3c988ecdb41bd244215a`（移除成交核对固定绝对容差并使用浮点精度比较）；`c382f32f1926c114d4c964f9782d19fb524ac570`（增加微小BTC成交数量精度核对测试）。
- 该修改仍不是完整的交易所十进制/stepSize精度模型；其目标是禁止固定绝对容差掩盖小额成交差异。SELL数量档位与交易所stepSize边界仍需独立核对。
- 上述代码与测试已推送到 `gpt`；对应最新Actions需继续等待，当前不提前宣称通过。


### 本轮最终CI复核（2026-11-20）
- 分页回归测试夹具曾因各页重复使用同一组成交ID而失败；这是测试模拟不符合Binance分页ID递增约束。已修正为每页连续递增ID，未放宽生产校验。
- `e5b3b6771a80cda2ab3bea64fb19dada77879633`：修正分页回归测试模拟连续成交ID。
- 对应Actions Run `44708826126`：**成功**；49个测试文件、411项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。
- 继续移除 `order-reconcile.ts` 的 `1e-15` 绝对容差下限，并增加微小订单真实成交差额测试：
  - `db0dc64d1ea2eca19bc1b34d4f01b8b40c26cd33`：移除订单数量核对的绝对容差下限。
  - `bf6a5b2df99fde55648ca99216c074748d698278`：增加微小订单数量差额的对账回归测试。
- 对应Actions Run `44708903111`：**成功**；49个测试文件、412项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44708903111
- 以上CI证明当前分支的分页完整性和微小数量容差回归通过，但仍不等于BUY生产闭环或SELL独立安全验收完成。
- SELL独立复核仍发现：wait分支只在本地status为partially_filled时清除旧证明；stepSize在订单分类后才读取且失败后回退容差；底仓fillIds有效性与逐笔账本数量绑定仍需强化。已在Issue #2追加复核评论，Outbox继续暂停。
- 生产BUY/SELL与Simple Earn真实赎回继续关闭。


### SELL成交精度覆盖补充与文档校正（2026-11-20）
- `lib/execution/fill-reconcile.test.ts` 增加小于 `1e-8` 的SELL成交数量差异回归测试，确保BUY/SELL共用的逐笔成交核对逻辑均覆盖微小数量。
- 提交：`b3979bcaf41674e414226742d9776fbed0304e81`（增加微小卖出成交数量精度回归测试）；该提交的Actions尚待最终状态确认。
- `lib/execution/README.md` 原先仍描述“生产环境没有可用下单路径”，与当前已实现但默认关闭的统一服务端 `/api/binance/spot-order` 不一致。现已更正为：测试网/生产端点由服务端环境变量选择，四路方向开关隔离；生产适配器已存在但服务端账户级持久化协调、后台调度和最终验收尚未完成。
- 文档提交：`9dbb490b2e2d046aab1175458d296077095fe710`。


## Durable Object SQLite与Cron看门狗基础层（2026-11-20）

### GPT直接完成的代码
- 新增 `lib/execution/execution-account-do.ts`：账户级Durable Object SQLite基础类，建立 `account_metadata`、`order_intents`、`order_attempts`、`reservations`、`fills`、`audit_events`、`scheduler_tasks` 表。
- 当前内部接口仅支持健康查询、看门狗心跳、策略3.3订单意图字段校验和幂等落库；同一strategyEventId派生确定性intentId，重复提交不会覆盖既有记录。
- 请求体使用实际UTF-8字节数限制16KiB；非法JSON、错误策略版本、错误交易对/方向/报价资产/金额、幂等冲突均失败关闭。
- 新增 `lib/execution/execution-account-do.test.ts`：覆盖SQLite schema初始化、非法意图拒绝、重复意图幂等、Cron心跳及重复心跳不会不断推迟已设置Alarm。
- `worker.ts` 导出 `ExecutionAccountDO`，保留OpenNext fetch，并增加每分钟 `scheduled()` 看门狗；`wrangler.jsonc` 配置DO binding、SQLite migration及Cron。
- Cron仅向固定账户DO写入心跳；DO Alarm当前仅记录触发时间。没有提交/撤销/查询Binance订单的代码路径，也没有连接策略事件的公开API。

### 提交记录
- `a0321e9ed9ea284952325e5e789d13dd44fa0e68`：新增账户级SQLite持久化协调器基础模块。
- `0164f57ecdfd2c07c8ae620c7d08dc95b0e10584`：加固持久化意图请求体大小与解析校验。
- `b5ab31ad05b21d882ee7bbc570a8b2ecfa649c00`：接入账户协调器导出与定时看门狗入口。
- `a6edb1a4e478d89f88ba6e29888b06305113fa8c`：配置账户SQLite持久化对象与安全看门狗定时触发。
- `5310d1e04d5f6be9b8e95090f342c11d23e1e8f1`：增加账户级SQLite持久化协调器回归测试。
- `017f3edad4bc6d7294c18674cffb4cd2ba0d442a`：避免Cron心跳反复推迟Durable Object闹钟。
- `1dba6e846a435228a4ffe54f4f981e9d79a866e4`：保留OpenNext生成入口的TypeScript构建兼容。
- `bb525e4f3c1e3196af5c616f0b92a48a23338f16`：修正Durable Object测试状态模拟器的泛型类型。
- `92e1680dc59db5b553628913551033f546bf58a2`：验证重复Cron心跳不会推迟已设置的DO闹钟。
- 架构文档：`7006c2e32ebf34208b4e7089330fac2498c4669b`；README边界说明：`67d28127e5496f5891614424fb5946f58b74c7d1`；规则矩阵：`3ac9e25571090526cac41ebb955e7990e4eb3102`。

### CI验证与暂时失败说明
- Run `44709932176` 对应 `92e1680` 成功：50个测试文件、420项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44709932176
- 文档提交Run `44710054437` 与 `44710060285` 均成功；后者链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44710060285
- 中间提交曾出现CI失败：一是Grok新增底仓证明测试与当时实现不一致；二是DO测试模拟器泛型类型不匹配；三是OpenNext生成入口尚未添加ts-ignore。均已定位，后续提交修复；当前引用的成功Run覆盖50/420测试、typecheck及两种build。
- 运行时Cloudflare部署/迁移尚未执行，未做Wrangler远程部署或真实账户操作。

### 当前明确未完成
- SQLite schema虽有attempt/reservation/fill/scheduler表，但还没有账户级原子claim、资金预留与释放、唯一活动订单锁、attempt/leaseToken持久化写入。
- Cron只做心跳；Alarm不派发订单任务；Next.js没有把可信策略事件写入DO；DO没有调用Binance adapter。
- 仍需实现DO重启恢复、并发抢占、重复intent、余额快照过期、未知POST先查单、旧lease fencing和手工复核队列。
- 当前策略执行节拍仍由看板页面驱动，关闭页面不会持续运行。不得把此基础层描述为无人值守自动交易已完成。

## SELL第三轮复核结论（2026-11-20）
- Grok已提交非终态wait分支清理陈旧终态证明、stepSize获取失败时冻结、底仓fillIds空值/重复/时间戳校验，以及脏 `reconcile_required` 旧记录集成fixture。
- 最新全量CI Run `44709932176` 覆盖这些当前分支代码：50个测试文件、420项测试全部通过。
- GPT仍未验收：`sell-order-status.ts` 仍以 `stepSize * 0.51` 作为数量容差，可能把真实未成交差额判为满单；`localEventEligibleForTakeProfitResume` 仍未严格校验安全整数时间戳与fillIds逐项非空唯一；`confirmedBaseReduceFilledQty` 仍直接累计事件filledQty，尚未按唯一成交台账逐笔数量重算并验证一致。
- 已在Issue #2评论 `7035649583` 指派Grok继续修复，要求只改SELL白名单和专属测试；GPT不改Grok主责文件。
- SELL Outbox仍暂停；生产BUY/SELL与Simple Earn真实赎回保持关闭。


## P2-B原子claim与账户级资金预留（2026-11-20）

### 实际实现
- `lib/execution/execution-account-do.ts` 新增SQLite `account_lock` 表；`reservations` 增加attempt字段，支持同一策略事件的多次attempt保留独立预留历史。
- 新增内部 `POST /internal/claim`。使用Cloudflare SQLite Durable Object `storage.transactionSync()`，在同一个同步事务中：
  1. 检查订单意图存在且仍为queued；
  2. 检查余额快照时间戳为安全整数、非明显未来时间且不超过60秒；
  3. 检查BUY必须预留USDT、SELL必须预留交易对基础资产；
  4. 使用BigInt将十进制字符串转为整数单位比较余额，禁止浮点比较；
  5. 检查单账户唯一活动订单锁为空；
  6. 递增attempt，生成Binance clientOrderId与随机leaseToken；
  7. 原子写入订单reserved状态、reservation、order_attempts、account_lock和审计事件。
- 当前策略采用保守的**全账户单活动订单锁**，先确保不同币种不能并发超额占用资金；后续只有在资产隔离和跨币种资金证明完整后才考虑放宽。
- 新增测试覆盖100.00与100金额精确相等、小额十进制差额、余额不足、过期快照、两币种并发claim竞争、重复意图幂等和Alarm心跳。

### 本轮相关提交
- `132ffc8e84e174837cde37286b78ea2c5c059368`：实现账户级原子订单领取与资金预留锁。
- `58dadce6bd94429027874b3dbfae184562ce65f9`：增加账户级原子领取、并发锁与余额快照测试。
- `7ad3b854c67f410eff40e530def5fb0cc446d4f9`：修正资金预留十进制金额校验正则。
- `83aaa40911650672c755b513aa313fee8b63e35f`：强化资金预留落库与并发领取竞争测试。
- `52e3d883be7f715d5f123370f9b1282bfb3eecd9`：修正Durable Object SQLite事务测试接口位置。
- `0816d13e5c1e8fbb7e819ea011843582aea3e013`：增加微小余额差额的精确十进制预留测试。
- 架构文档更新：`6c8e055140415bfdc4a1ce7a968272845355c961`；规则矩阵更新：`66a7455cd40d3a3b6a8c85c8c91316e260fe2a1d`；README更新：`062eca995fa26a527fd514e8e5fd873708af37a8`。

### CI结果
- Run `44710596213` 成功：50个测试文件、423项测试全部通过；typecheck、Next.js production build、Cloudflare OpenNext build全部通过。
- 最新Run `44710687787` 成功：50个测试文件、424项测试全部通过；typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44710687787
- 文档同步Run `44710656891` 成功。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44710656891

### 未完成与安全边界
- claim接口目前只供Worker内部DO绑定调用，尚未接入Next.js可信策略事件或Binance服务端真实余额读取。
- 当前领取后账户锁会持续占用；尚无订单提交前状态写入、leaseToken fencing写入、未知POST恢复、过期租约接管、终态成交核对、资金释放与锁释放接口。**因此目前不可把该接口接入真实下单，也不可部署后视为已可交易。**
- Cron仍只写心跳，DO Alarm仍只记录触发时间；后台订单任务派发未实现。
- 生产BUY/SELL与Simple Earn真实赎回继续关闭。


## P2-B提交前fencing与未知订单恢复基础（2026-11-20）

### 实际实现
- 新增内部 `POST /internal/mark-submitting`：仅当account_lock的intentId、attempt、leaseToken匹配且租约未过期，且订单仍为reserved时，才在SQLite事务中把intent/attempt持久化为submitting，并返回已保存的clientOrderId。后续服务端执行器必须先成功调用此接口，再进行唯一一次Binance POST。
- 新增内部 `POST /internal/mark-unknown`：POST响应不明确时，在当前租约有效的前提下将intent/attempt写为unknown；账户锁与资金预留继续保留，不允许释放或创建新attempt。
- 新增内部 `POST /internal/takeover`：只允许租约过期且状态为submitting/unknown/reconciling的订单被接管；新token覆盖旧token，attempt和clientOrderId不变，状态进入reconciling，并返回 `reconcileOnly: true`。该路径不创建新attempt、不生成新clientOrderId、不执行POST，只能用于按原clientOrderId查单/对账。
- 所有关键SQL UPDATE均加入intent/attempt/state/leaseToken条件并使用RETURNING确认确实更新一行；旧token写入拒绝。
- 新增测试覆盖错误token不能标记submitting、submitting必须先持久化、unknown保留活动锁、过期租约接管不变更attempt/clientOrderId、旧token接管后写入被fencing。

### 提交与CI
- `4189ba8c271b25b3a690391af6b8a14d8bd66e48`：实现提交前状态持久化与过期租约只读接管。
- `cd41aa2654500d0f3cb3fdccc05b25bfdc06b1e3`：为租约状态变更增加SQL条件更新与fencing确认。
- `7f4f018b02bd28fadd10897f384d372971d3225d`：增加提交前fencing、未知订单冻结与租约接管测试。
- Run `44710982129` 成功：50个测试文件、427项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44710982129
- 架构文档同步：`e78411297fe3a3e6c26f9c05f25535d264733361`；规则矩阵同步：`7eba933c5a7bcba31f21c9072900495b44b9708f`；README同步：`b3d62a830a71fcd7e0764c06e85cf7ff6f8098b2`。

### 仍未完成
- 目前这些内部DO接口没有由Next.js可信策略事件调用，也没有与Binance余额/下单/查单适配器接线。
- 未实现租约续期、终态fill ledger对账、手续费与预留消耗核算、资金释放和account_lock释放。
- Cron只写心跳，Alarm只记录触发；尚未从SQLite scheduler_tasks中领取并执行任务。
- 因此该基础层仍不可用于真实交易；生产BUY/SELL与Simple Earn真实赎回保持关闭。


## 成交账本与订单attempt关联字段准备（2026-11-20）
- 为后续终态成交对账和资金释放准备，`fills` SQLite表增加 `intent_id` 与 `attempt` 字段，并新增按 `intent_id + attempt + order_id` 查询的索引。
- 提交：`fcbc66ddd81c7a3ec286ec57d97e5ee8d9d34970`（扩展成交账本以绑定订单意图与attempt）。
- 该提交只扩展schema，尚未新增fill写入或终态finalize接口；对应Actions Run `44711219283` 在记录时仍在运行，未提前宣称通过。
- 订单提交前fencing/unknown/takeover代码提交 `7f4f018b02bd28fadd10897f384d372971d3225d` 的CI Run `44710982129` 已成功：50个测试文件、427项测试全部通过；typecheck、Next.js build、Cloudflare OpenNext build全部通过。
- 后续实现fill写入时必须按symbol+tradeId唯一，校验intentId/attempt/orderId一致；只有逐笔fill数量与交易所累计数量/金额完全一致且交易所终态明确，才允许释放reservation和account_lock。


## P2-B成交逐笔核对、终态结算与租约续期（2026-11-20）

### 实际实现
- 新增内部 `POST /internal/finalize`，输入必须包含原订单intentId/attempt/leaseToken、交易所订单ID和终态、累计executedQty/cummulativeQuoteQty、交易所终态时间及逐笔fills。
- 在写入前验证：交易所终态仅允许FILLED/CANCELED/EXPIRED/REJECTED；tradeId数字格式且单次事件唯一；每笔fill必须属于同一exchangeOrderId；qty/quoteQty为正十进制、commission非负、commissionAsset合法；成交时间不能晚于终态时间。
- 使用BigInt十进制加总逐笔qty和quoteQty，必须与交易所累计数量/金额精确一致；零成交必须没有fills，FILLED不允许零成交。
- SQLite事务内再次验证账户锁、当前leaseToken、intent/attempt/clientOrderId、reservation资产/金额；逐笔写入fills，tradeId已存在时仅允许所有字段完全一致的幂等重放，任何归属/内容冲突拒绝覆盖。
- BUY将USDT手续费计入USDT实际消耗；SELL将基础资产手续费计入基础资产实际消耗。实际消耗不得超过预留金额。
- 成交账本数量与终态快照一致后，在同一SQLite事务中结算reservation、写入intent/attempt终态、记录exchangeOrderId与成交对账时间，并删除account_lock释放剩余预留。SELL FILLED数量必须等于原始委托数量；部分成交后终态记为partial_terminal，不自动生成下一笔订单。
- 新增内部 `POST /internal/renew-lease`：只允许当前token在租约未过期时续租30秒；过期租约不能复活，必须先走原订单reconcile-only接管。
- 增加测试覆盖BUY满单成交结算、逐笔数量不匹配拒绝释放、重复tradeId拒绝、有效租约续期、过期租约续期拒绝。

### 提交与CI
- `6b2c1799b40d270d8429e2b627fa8f6367da6850`：实现逐笔成交核对与订单终态资金释放。
- `65b6ccb208620cf8ffe65bf22ab61c1867a6ff25`、`6fb8fab104e04d96422325accb45ba433556b1b2`：补充账户锁资产读取与终态时间校验。
- `8fa8083faf05acc2fba6f9afbcc3fbb0137aa04c`、`b0fa468ef0286d2b3fe9a8fb6e4ad6f5c3a18b75`、`7b737f828f7560b4006942935861097b405dca52`：增加终态核对回归测试并修正FakeSql测试桩分支。
- `b2822fb4a8f7eedf83872ca2ebfaa60104b9088c`：加强成交时间、预留金额和SELL满单数量校验。
- `76a2624f3d2dfa2126c0e69df6dfe4341141a754`：实现订单执行租约安全续期。
- `a7c3057023947b73e3a40b708c700dd7d5cc3456`、`ac8e370e43531d87a549d39ccd0a908326195dbb`：增加续租/过期拒绝测试并消除毫秒边界抖动。
- Run `44758757429` 成功：50个测试文件、428项测试通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44758757429
- 架构文档：`fe89d5d3beaf935418df46abf89cc543f29bdb67`；规则矩阵：`7ad42816b8baae784e3ee97c1249ef0f854192ff`；README：`11a2609b6b3a7451d5fa43e1c78cbde2bf3a2963`。

### 当前未完成与安全边界
- `/internal/finalize` 和 `/internal/renew-lease` 仍只接受Worker内部DO绑定调用；没有连接Binance服务端查单、成交历史分页读取或真实余额快照，也没有从可信策略事件生成订单意图。
- Cron仍只写看门狗心跳；DO Alarm尚未扫描scheduler_tasks、领取任务或派发执行。
- 本轮新加SELL部分成交及基础资产手续费测试提交 `b55625986a751e07a1440bd8c584350ad447d6ac` 对应CI Run `44758920412` 已成功：50个测试文件、429项测试通过；typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44758920412
- SELL方面，Grok已把满单判断改为只容忍IEEE-754误差，并将底仓减仓统计改为需要唯一成交台账；但真实fill ledger尚未接入 `buildSellEventReservations/enqueueEligibleSellSignals`，已在Issue #2要求继续接线。Outbox和生产交易保持关闭。
- 因此DO内部结算原语尚不能视为完整自动交易闭环；未部署、未使用真实Key、未向生产账户发送订单。

### EXPIRED_IN_MATCH终态兼容补充（2026-11-20）
- 审查Binance Spot状态集合时发现，`EXPIRED_IN_MATCH` 是有效的交易所终态；若finalize白名单不接受，会导致此类订单无法结算并持续占用账户锁。
- 已将 `EXPIRED_IN_MATCH` 纳入 `/internal/finalize` 终态白名单，并映射为本地 `expired`；新增零成交终态结算测试，验证预留消耗为0且可在成交核对完整后安全释放锁。
- 代码提交：`f5e7c25539c4d2996556515bade73fc2282af5b4`；测试提交：`0c3e62ce05d85503b904cda2bf049c065c967c75`。
- CI Run `44759560917` 成功：50个测试文件、430项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44759560917

## P2-C调度安全原语起步（2026-11-20）

- 新增 `lib/execution/scheduler-task-core.ts`，定义当前仅允许 `reconcile_intent` / `health_check` 两类无下单副作用任务；验证稳定taskId、任务类型、dueAt和最大未来窗口。
- 新增调度任务租约安全原语：attempt递增、新leaseToken、30秒租约、taskId+attempt+token+过期时间fencing校验。
- 新增有上限指数退避：5秒起步、上限15分钟、最多8次；达到上限返回不再自动重试，后续必须转人工复核。
- 新增 `scheduler-task-core.test.ts`，覆盖任务类型白名单、时间边界、租约过期/token冲突、指数退避与最大尝试次数。
- 提交：`cf97eb54412e062ad9335d23f757883681a73de3`（安全原语）；`215bff695d0aea6c05d1e6b59fef1199a947f922`（测试）。
- CI Run `44760765731` 成功：52个测试文件、439项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44760765731

### P2-C未完成边界
- 上述是纯函数安全原语，不是已接通的SQLite任务队列；尚未加入DO enqueue/claim/ack/retry接口、任务租约持久化表、Alarm过期租约回收/最近任务调度、Cron任务消费器。
- 未有真实Cloudflare Durable Object实例部署/重启恢复验证；未连接Binance Testnet执行器，不会发送订单。
- Issue #4 已创建为GPT主责任务，后续必须把这些原语接入DO并补真实SQL语义测试；不得把本次439项CI通过表述为P2-C完成。
### P2-C重试恢复决策纯函数化（补充）
- 将过期租约恢复决策改为显式传入now，移除隐藏的Date.now依赖，保证重试时间可确定性测试。
- 新增过期租约按attempt分流测试：未达上限进入pending并安排退避；达到8次上限或now无效时转manual_review。
- 最新测试提交 `16a838c6ac28efb409feb28c8c9e2f58062146df` 对应CI Run `44761482631` 成功：52个测试文件、440项测试全部通过；typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44761482631

## 建立自动交易系统总需求清单（2026-11-20）
- 新增根目录 `自动交易系统总需求清单.md`，作为GPT/Grok持续开发的统一任务入口；提交：`2a6f2e0e5f98f6160d6bfb0c326cf3302f1fff59`。
- 清单按负责人和依赖拆分Grok SELL返工、SELL通过后的Outbox可靠性、GPT DO SQLite任务队列/Alarm/Cron、Binance服务端只读适配器、策略事件到服务端intent、Spot Testnet闭环、策略3.3核对与回测、最终部署/生产安全验收。
- 为每项任务写入验收条件、必须覆盖的测试、安全边界和交付格式；只有代码、测试、CI和独立复核证据齐备才允许标记完成。
- 明确持续推进机制：每项完成后自动进入依赖已满足的下一项；阻塞时处理阻塞或拆分并行任务，不以等待用户催促为默认状态。
- Grok继续主责SELL/Outbox，GPT主责DO调度、BUY、服务端适配器、策略核对和总集成；不允许越权修改共享模块。
- 本次只新增需求文档并更新工作记录，未修改交易代码，未触发任何Binance交易请求；生产BUY/SELL、Simple Earn真实赎回和Outbox仍关闭。


## P2-C调度SQLite与Alarm租约恢复（2026-11-20）

- 扩展 `scheduler_tasks` SQLite表：加入taskType白名单约束、状态约束、leaseToken、leaseUntil、nextAttemptAt、lastError等持久化字段及复合索引。
- 加入旧表兼容迁移：通过 `PRAGMA table_info(scheduler_tasks)` 检查缺失列后再执行ALTER，避免重复迁移导致部署失败。
- DO Alarm现在会扫描最多100条过期leased任务，使用纯函数 `expiredSchedulerLeaseDecision` 决定退避回pending或达到上限转manual_review；清除旧lease token/leaseUntil并按最早pending/leased时间安排下一次Alarm。无待处理任务时调用可选deleteAlarm。
- Alarm没有将任务伪标记完成，也未在SQLite事务内进行网络IO；真正的enqueue/claim/ack/retry接口和只读执行器仍未完成。
- 新增 `execution-account-do.test.ts` 对调度表持久化字段、兼容迁移入口、Alarm过期租约恢复SQL与下一次唤醒查询的测试断言。当前测试运行由GitHub Actions执行中，不能提前宣称通过。
- 代码/测试变更提交：
  - `6ca2e9f08cc6c3d6f2cef0240426610f48ed4549`（调度表迁移与Alarm租约恢复）
  - `b663957a83254b9646bfd42a1982dbb52fef2a94`（补充deleteAlarm类型）
  - `3a9aae7896881a4ca545a3052bfbab66c9672317`（新增调度迁移/Alarm测试）
- CI Run： https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44766274501（检查中）。
- 剩余风险：FakeSql测试只验证查询/迁移路径，不证明真实Cloudflare SQLite重启和并发语义；尚未有scheduler enqueue/claim/ack/retry和Alarm任务消费。
- 生产BUY/SELL、Simple Earn真实赎回、Outbox投递保持关闭。



## Grok SELL独立复核发现（2026-11-20）

- 检查了Grok最新 sell-signal-queue.ts、sell-order-status.ts、sync-sell-order.browser.ts 和相关测试。
- 正向确认：syncSellOrderFromBinance 的非终态 wait 分支现在会把旧 partially_filled 降级为 reconcile_required，并清除旧终态/成交对账证明；跨周base_reduce锁不再按sourceWeek过滤；底仓成交台账已要求SELL方向、base_reduce类型和唯一fillId。
- 新发现阻断项：普通 take_profit partial resume的 localEventEligibleForTakeProfitResume / takeProfitTierCanResume 仍主要信任事件本地fillIds/filledQty/终态证明；当前看到的ledger逐笔核验只应用于base_reduce。要求Grok将止盈partial resume也绑定唯一SELL成交台账，逐笔核对symbol、fillId、side和数量合计。
- 已将该项加入《自动交易系统总需求清单》GROK-SELL-01A，并在Issue #2留言要求Grok补实现和缺失/重复/冲突/数量不匹配测试。SELL 01-05只视为代码侧阶段性交付，尚未通过GPT独立验收。
- 最新已观察到的CI：GPT DO测试修正提交 1b7ad8d3e4d62223f2e8cefef2b345510fcbfae1 对应Run 44766500560 成功；DO Alarm避免空转提交 96ac2444f957a6f0fb63742e15933e46851f0bdd 对应Run 44766640327 成功。Grok需求清单更新提交对应Run 44766552735 成功。以上CI通过不替代真实Cloudflare运行时测试和SELL业务逻辑独立验收。


## DO调度队列接口与只读健康任务第一阶段（2026-11-21）

- 在 `lib/execution/execution-account-do.ts` 中实现持久化调度队列接口：
  - enqueue：校验任务类型白名单、taskId/dueAt、请求体大小；重复相同任务幂等，不同内容冲突拒绝。
  - claim：最多批量领取10项，transactionSync内读取到期任务、递增attempt、生成新leaseToken并设置30秒租约。
  - ack：以taskId+attempt+leaseToken+leaseUntil进行fencing；成功ack保留token用于幂等重放，过期/旧token拒绝。
  - retry：校验有效租约后执行5秒起步、上限15分钟、最多8次的指数退避；达到上限转manual_review。
- DO Alarm和Cron watchdog可在SQLite本地消费health_check任务，读取订单意图数量并完成任务；没有网络IO，也没有将reconcile_intent伪装完成。
- `reconcile_intent` 已可入队、领取、ack/retry，但Binance只读查单adapter尚未接入；需后续接线后才可由后台执行器消费。
- 新增 `lib/execution/scheduler-task-do.test.ts`：覆盖重复enqueue、taskId冲突、claim lease、旧token拒绝、ack幂等、retry退避及Alarm只执行health_check。
- 中文提交：
  - `fad8d4d25ce78be58f448d1b7658654c204b0d70`
  - `87b32e74b0c73bcefe406fc8ad2a3cea160f53ad`
- CI尚待核实；当前测试为Fake SQL行为测试，不代表真实Cloudflare SQLite重启/并发验收。下一步：检查并修复CI、补真实运行时测试、Cron/Alarm恢复测试，再接入只读对账执行器。
- 生产BUY/SELL、Simple Earn真实赎回、Outbox投递保持关闭。


## Grok止盈台账修复第一轮独立复核（2026-11-21）

- 重新读取Grok当前 `sell-signal-queue.ts`、`sell-take-profit-ledger.test.ts`、`store.browser.ts`。
- 正向确认：止盈resume现在逐笔匹配唯一SELL台账，要求 `sellKind=take_profit`、币种匹配、fillId不重复、qty合计与事件filledQty一致；缺失台账返回null并阻断本档续卖。
- 正向确认：`enqueueEligibleSellSignals` 确实读取 `listTradeLedger()` 并映射side/sellKind/qty；`recordConfirmedSellFill` 持久化sellKind并校验重复成交字段一致性。
- 尚需Grok补充：错误symbol；有效记录与混合冲突记录；真实commission/commissionAsset字段不参与qty合计；实际enqueue/tick集成路径（不只手工传数组测试）；最新CI与中文commit SHA。
- 已在Issue #2评论ID `7056908010` 请求补测和CI证据。当前只认定为核心代码阶段性交付，不认定SELL通过；Outbox与生产交易继续关闭。


### P2-C调度队列测试与Alarm空转边界修正（2026-11-21）
- 修正新调度队列测试中数组索引的非空断言，避免开启严格索引检查时出现测试类型错误：`127d89ae071b774d65e03f4e8841fcb3dff5c427`。
- 将调度队列Alarm最小唤醒间隔设为60秒，防止到期任务因处理异常而每秒空转；Cron每分钟作为兜底唤醒：`b4ec3f7f2a4d682ae8856aee59727cd460d027eb`。
- 这两项尚待最新GitHub Actions验证；当前没有把静态修改视为测试通过。


## 用户确认补全自动交易最终闭环任务（2026-11-21）

- 用户确认将当前全部剩余工作写入《自动交易系统总需求清单.md》，并按依赖持续完成，不只停留在进度汇报。
- 本次将剩余工作拆为可独立验收的任务组：Grok SELL最终验收；DO真实SQLite/Alarm/Cron/只读任务消费；Binance服务端只读查单、逐笔成交、余额与交易规则适配器；可信策略3.3事件到幂等intent；服务端Testnet BUY/SELL执行与unknown恢复；Simple Earn服务端赎回；Outbox；Dashboard跨设备状态；Cloudflare部署及生产安全预检。
- 明确每项完成必须附代码提交、专项/全量测试、typecheck、Actions CI、必要的Cloudflare真实运行时证据和独立复核；Fake SQL不替代真实SQLite验收。
- 推进原则：Grok负责SELL并由GPT独立复核；GPT负责DO调度、Binance只读适配器、策略事件/intent、服务端执行闭环与总集成。依赖满足的任务并行推进，阻塞时拆解处理。
- 安全边界：当前只用Mock/Testnet；生产BUY/SELL、Simple Earn真实赎回、Outbox生产投递保持关闭；未知POST只读查单，不盲目重发；生产启用必须等待完整验收和用户明确授权。
- 本次只更新任务清单与工作记录，没有开启生产开关，也没有发送任何Binance订单或赎回请求。


## Binance服务端只读对账适配器第一阶段（2026-11-21）

### 本轮代码交付
- 新增 `lib/execution/binance-reconcile.server.ts`，默认复用服务端 `fetchSignedBinanceRead`，没有任何POST/下单能力。
- 按 `symbol + origClientOrderId` 查单，严格验证返回symbol/clientOrderId/orderId/side/数量/时间；识别Binance -2013/-2011为明确not_found，其他错误（包括429）继续抛出，不伪装成无订单。
- 订单状态白名单覆盖NEW/PARTIALLY_FILLED/FILLED/CANCELED/REJECTED/EXPIRED/EXPIRED_IN_MATCH；未知状态映射UNKNOWN，禁止当作终态。
- 按 `symbol + orderId` 读取myTrades，最多5页，每页1000条；校验tradeId/orderId/symbol/方向/价格/数量/成交额/commission/commissionAsset/time，重复ID内容冲突拒绝，超出分页上限返回complete=false。
- 增加账户free/locked余额严格解析，拒绝重复资产；增加交易对状态、base/quote资产及过滤器字段解析。
- 扩展 `lib/binance.ts` 的myTrades只读参数白名单，允许orderId过滤。
- 新增 `lib/execution/binance-reconcile.server.test.ts`，覆盖订单状态/字段校验、成交与手续费字段、余额重复/非法字段、交易规则缺失、clientOrderId查单not_found与429错误区分、成交分页和错误订单拒绝。
- 中文提交：
  - `cfbe8f71a4617d4c97287786703686959e2f8b57`：新增Binance服务端只读对账适配器。
  - `dab6ae20dfb1be7ad2eb0ea19c2ed3a92abe2d9b`：新增适配器测试。
  - `c270294f4f3e621703a37c4783cfd8147127d8f0`：允许按订单ID读取只读成交历史。
- 当前状态：代码已写入gpt分支，**CI结果待核验**；不得标记为完成。尚未连接DO reconcile_intent任务，也未将逐笔结果接入fill-reconcile终态结算；第三资产手续费USDT折算仍由既有fill-reconcile逻辑fail-closed处理。
- 安全边界：只读GET；没有调用Binance交易/赎回接口，没有开启生产BUY/SELL。



### CI修复结果与终态计划构建器（2026-11-21）
- 首轮Run `44865239710` 失败原因已定位为测试断言文本不一致及测试mock参数隐式any，不是适配器实现逻辑错误；修正提交 `2c1c6ea510c46633f726755221f300d0c0d939ad`。
- 修正后Run `44865305092` 成功：npm test、TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44865305092
- 新增 `lib/execution/binance-reconcile-plan.server.ts`：将只读订单查询、订单状态、逐笔成交分页和交易对资产规则组合为严格的终态核对计划；使用BigInt十进制精确累计qty/quoteQty，只有终态且完整逐笔数据完全匹配时才生成DO finalize payload。
- 活动订单返回wait；明确not_found不代表可重发；未知状态、订单身份/方向冲突、FILLED数量不匹配、成交累计不一致、分页不完整、第三资产非零手续费均阻断自动finalize。
- 新增 `lib/execution/binance-reconcile-plan.server.test.ts`，覆盖终态成功、活动/未找到/429、未知状态、方向冲突、成交数量不匹配、第三资产手续费、零成交终态。
- 新增提交：`9fb5c1a5377501ae7381facd9e32876f891cb18e`（终态对账计划构建器）、`36b78267051640f4e08034dd1ffe462dc7d04286`（终态计划安全测试）；对应CI仍在运行，未提前宣称通过。
- 当前仍未把计划构建器接入DO scheduler消费者；没有自动ack/finalize执行链路，没有发送订单POST。生产BUY/SELL保持关闭。


## DO后台只读对账任务第一阶段接线（2026-11-21）

### 代码实现
- `ExecutionAccountDO` 在订单进入`submitting`前即以intentId为稳定taskId写入`reconcile_intent`任务；标记`unknown`时幂等补入队，避免提交前后进程崩溃后没有恢复任务。
- 新增内部`GET /internal/reconcile-context`，只返回DO内订单身份、原clientOrderId、attempt和账户租约；终态intent只返回terminal标记。
- 新增`POST /internal/scheduler/renew`，只允许当前未过期的taskId+attempt+leaseToken续租；过期或旧token不能复活。
- Worker Cron每分钟执行watchdog后领取最多5个`reconcile_intent`任务，调用`dispatchReconcileIntentTask`；页面关闭后仍可处理已经持久化的订单恢复任务。
- dispatcher先读取DO上下文；账户租约过期时走reconcile-only takeover，未过期时续租；之后只调用Binance GET查单/成交/交易规则。
- 只有交易所终态、完整成交分页、订单身份/方向/时间匹配、qty与quoteQty精确相加一致、手续费资产可解释时才调用DO finalize；活动单/not_found/429/网络错误/不完整分页均只安排重试，不触发订单POST。
- finalize支持附带scheduler task fencing证明，并在SQLite事务中再次校验scheduler taskId/attempt/leaseToken/leaseUntil以及账户锁leaseToken；调度租约过期的迟到执行者不能结算或释放资金。
- Alarm已纳入pending reconcile_intent任务的下一次唤醒/租约恢复；实际外部网络执行由Worker Cron负责，不在SQLite事务中执行网络IO。

### 新增/更新文件
- `lib/execution/reconcile-intent-dispatcher.server.ts` / `.test.ts`
- `lib/execution/execution-account-do.ts` / `.test.ts`
- `lib/execution/scheduler-task-do.test.ts`
- `worker.ts`
- `lib/execution/README.md`
- `自动交易系统总需求清单.md`

### 中文提交
- `60a75139d804ccbee68a6a6eb966420790667176`：新增只读对账任务分发器。
- `371bd8c750caabb1ea40989615c19206d6867318`：新增只读对账任务分发器测试。
- `cf39f1f4a25c9f08f226009ce846e0fb197857fd`：接入只读对账任务入队与双重租约fencing。
- `db18c55179999d9cb8794ed76318dc1a898a0257`：补充调度租约续期与过期拒绝测试。
- `f7fcbb544ca430728c1919c235e22a1ea2ce9cca`：接入Cron后台只读订单对账任务消费。
- `72e38c62f46283839b804457596a70574f4ef9bb`：补充提交前对账入队与上下文测试。
- `4417c6ea55fd1a941fb887fe93ddcec12b1c4e5d`：验证终态结算必须持有有效调度租约。
- 文档同步：`0a4c51700fbdc5eab076386d998aec3b571baa71`、`28ac2ae29b988bd8b86af3de8bc87a4be8fcb6ed`、`e5f3c2a6883b21e0250ab4d2dc1b31171cba3f6b`。

### CI与验收边界
- 最新Run `44865899742` 成功：60个测试文件、488项测试全部通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44865899742
- dispatcher、scheduler renew、context读取、终态scheduler fencing已通过Fake SQL单元/集成测试；这不等同真实Cloudflare SQLite并发/重启测试。
- 仍未完成：真实Cloudflare Durable Object SQLite重启/并发验证、部署后的Testnet只读恢复演练、策略事件自动生成intent、后台自动新单提交。当前Cron只恢复已持久化的submitting/unknown/reconciling订单。
- 安全边界：该dispatcher没有Binance POST能力；not_found绝不自动重发；达到8次调度重试上限进入manual_review并保留账户锁。生产BUY/SELL、Simple Earn真实赎回、Outbox生产投递继续关闭。


## 服务端策略3.3 Testnet订单意图入口第一阶段（2026-11-21）

### 本轮实现
- 新增 `POST /api/execution/intents`：必须通过Dashboard Basic Auth与同源Origin检查；请求体不接受客户端策略参数。
- 服务端重新调用`getDashboard()`计算信号，只接受source=binance、账户已知、非STALE且数据更新时间不超过45分钟的数据；拒绝Mock、过期和STALE信号。
- 必须同时满足`BINANCE_SPOT_ENVIRONMENT=testnet`与`BINANCE_TESTNET_INTENT_CREATION_ENABLED=true`；生产环境硬拒绝。新增环境变量默认0。
- 从服务端只读账户快照读取free余额；BUY只检查USDT free，SELL只检查交易对baseAsset free，不把locked数量当作可卖余额。
- 对每个候选现货信号校验交易对TRADING、USDT报价、LOT_SIZE、PRICE_FILTER、MIN_NOTIONAL/NOTIONAL、正数step/tick/minNotional；BUY还要求quoteOrderQtyMarketAllowed。
- 不接收浏览器提交的价格、分数、动作或额度；金额来自服务端策略3.3 action。按symbol+action.kind+ISO周生成稳定strategyEventId，通过DO内部`/internal/intents`幂等创建。
- 该入口只创建DO intent，响应明确`orderSubmitted=false`；没有调用Binance订单POST，也不改变生产BUY/SELL开关。
- 新增测试覆盖服务端信号创建、STALE拒绝、余额不足、SELL只按free余额、非法交易规则、生产环境/开关/跨源/未认证拒绝。

### 提交与CI
- `ced383700162bbf804e456238780b6164f96cf78`：新增服务端策略3.3 Testnet意图入口。
- `2ec05977bb7820280ec0726d63b56ced79377d2d`：新增策略意图入口安全测试。
- `c9862995b6a7783281f367e32412acf522a198be`：修正路由运行时与初始化。
- `5b24b3c8c64e51919691a29f2d62d49e79aa1cca`：加强交易规则校验（首轮CI因测试fixture未同步规则过滤器而失败，已修正）。
- `d8489cf95f8b907de7be422f6a9e7a9e6c4b392d`：补齐测试交易规则数据。
- `8e692e444db600dc70ad467d2aa71fc774610809`：增加Testnet intent创建独立默认关闭开关。
- `4cdda97261f71163b9d5e0fd7484e308f8de0bc8`：拒绝零步长与零最小名义金额。
- `5aa17dd249cfe543d916fa4f7d87d6cb4caa2c70`：补充SELL可用余额与交易规则fail-closed测试。
- 根README同步：`4e69babd3a425956c72b7a71be74c336bcc960c5`。
- 最新Run `44866377303` 成功：61个测试文件、496项测试通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44866377303

### 尚未完成
- 当前入口仍需受控POST触发，尚未由Cron自动扫描策略事件；本轮没有把策略事件自动化为定时后台任务。
- 入口仅检查free余额与交易规则，没有调用DO claim/reservation；原子预留和下单前二次preflight仍待接线。
- 尚未增加逐币signalAsOf/策略输入哈希/事件到期证明；更新时间45分钟和STALE检查只是第一层门槛。
- 真实Cloudflare DO SQLite与Testnet演练未完成；intent创建不代表下单。
- 生产BUY/SELL、Simple Earn真实赎回、Outbox生产投递继续关闭。


## Worker Cron受控Testnet策略意图扫描（2026-11-21）

### 本轮实现
- 新增 `lib/execution/strategy-intent-cron.server.ts`：通过Worker自引用Service Binding向同一OpenNext Worker发起受保护的`POST /api/execution/intents`请求，使用服务端Dashboard Basic Auth和同源Origin。
- Worker Cron每分钟在满足以下条件时触发服务端策略扫描：`BINANCE_SPOT_ENVIRONMENT=testnet`、`BINANCE_TESTNET_INTENT_CREATION_ENABLED`、`BINANCE_TESTNET_INTENT_SCAN_ENABLED`均开启，且至少一个Testnet BUY/SELL服务端方向开关开启；缺少Service Binding或Dashboard密码则fail-closed。
- 扫描API仍在Next.js服务端重新计算策略3.3信号；只创建DO intent，不提交Binance订单。STALE/过期数据返回409并标记skipped，不会当成扫描成功。
- `app/api/execution/intents/route.ts`新增逐方向服务端开关检查：BUY关闭时不创建BUY intent，SELL关闭时不创建SELL intent。
- 新增环境变量`BINANCE_TESTNET_INTENT_SCAN_ENABLED=0`，默认关闭；生产模式在Cron触发器和API入口双重硬拒绝。
- Worker先尝试策略intent扫描（单独捕获失败，不阻断现有订单对账），随后领取并处理reconcile_intent任务。
- 新增`strategy-intent-cron.server.test.ts`覆盖Testnet开关、方向开关、自引用请求认证、STALE跳过和API错误；策略意图API测试补充方向关闭拒绝。

### 提交与CI
- `b030b1fc5bb5b48a570bd036c443f2372a197a1f`：新增Testnet策略意图Cron触发器。
- `e9f1f627f61618b13a0445a0fea4c9221a7d4e6f`：新增Testnet策略意图Cron安全测试。
- `1a758717d68f54643a0818386a48253fc8b0271a`：接入Cron受控Testnet策略意图扫描。
- `c1d71f46d6c2a7046a898a39e367b077a2a4758e`：增加Testnet策略意图后台扫描开关。
- `8bd2b280127bc6640a4b824cfa44d46556c30434`：按服务端方向开关限制策略意图创建（首轮CI因测试未同步方向开关环境变量而失败，已修正）。
- `ecfff7f31c62c818f8543e9c87ebf49605048992`：补充Testnet方向开关拒绝测试。
- `1027f0318832fdb0f33d96006450915773eeb280`：统一Testnet策略扫描开关布尔值解析。
- 文档同步：`137e46c579ed52cdcfc738c0aa713b6e9ee8b94e`、`ab66762d4ef3dfdcdca0fb9f89fe2ae8d2c8dbfc`。
- 最新可核验代码CI Run `44866693276` 成功，测试与typecheck通过；Worker/Cron集成Run `44866697296` 成功；Run `44866724247` 文档同步成功。对应链接：
  - https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44866693276
  - https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44866697296
  - https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44866724247

### 尚未完成
- 真实Cloudflare部署中的Service Binding自调用、Cron触发和Durable Object SQLite持久化尚未验证；当前仅CI构建和Mock/Fake SQL测试。
- 自动扫描只创建queued intent，不做claim/reservation、不提交订单；仍需完成信号时效证明、账户级原子预留和服务端Testnet执行器。
- 扫描开关默认关闭，没有启用真实Testnet扫描，也没有发送任何订单。
- 生产BUY/SELL、Simple Earn真实赎回和Outbox生产投递继续关闭。


## Grok SELL 01A第二轮独立复核与Outbox顺序阻断（2026-11-21）

### 已确认的进展
- Grok已把真实`listTradeLedger()`接入`enqueueEligibleSellSignals`，新增错误symbol/side/kind、真实TradeLedgerEntry手续费字段、enqueue/tick集成与IndexedDB重复写入冲突测试。
- 最新tick集成测试`sell-automation-tick.integration.test.ts`覆盖活动NEW订单旧终态证明清理、终态partial+合法台账可resume、终态partial无台账不resume。
- Grok报告本地60 files / 488 tests通过；相关CI Run 44864201785 / 44864156906为先前绿CI。

### GPT第二轮发现的阻断缺陷
- 当前`verifiedTakeProfitEventFilledQty`在检查唯一键前先过滤`side !== SELL`和`sellKind !== take_profit`，所以同一symbol+fillId的有效记录与冲突BUY/base_reduce记录并存时，冲突记录被忽略，仍会返回有效qty。
- `sell-take-profit-ledger.test.ts`的“同键混合冲突”用例明确断言混合冲突返回0.05（允许resume）；这与fail-closed验收要求相反。相同先过滤后判重模式也存在于`confirmedBaseReduceFilledQty`。
- GPT已在Issue #2提交第二轮阻断意见，评论ID `7057379157`：要求先按规范化symbol+fillId收集全部记录，再检查唯一性；任何同键多记录/side/sellKind/qty冲突都拒绝；补enqueue/tick混合冲突测试，确认只阻断对应币。
- 因此GROK-SELL-01A仍未通过独立验收，Issue #2保持打开。

### Outbox依赖顺序
- Grok已提前提交GROK-SELL-06 Outbox实现（`2f2f9638c07086faeae97cfce9830ebe18a08cdc`、`2abb2eee866a69ddc8167641f98b4c6f35ca70e3`），CI Run `44866922861`成功。
- 该开发顺序违反总清单“SELL 01~05独立验收通过后才开始Outbox”的依赖。已在Issue #2要求暂停继续扩展/启用；现有Outbox开关默认关闭，GPT不把该项视为已验收。
- Grok当前`Grok工作记录.md`只保留SELL-06内容，覆盖了此前01A提交、测试与CI证据；已要求恢复历史01A记录并追加06，不要覆盖历史。


## Cloudflare Durable Object本地真实SQLite重启/并发集成测试（2026-11-21）

### 实现
- 新增独立测试Worker：`tests/cloudflare-do/worker.ts`，只绑定`ExecutionAccountDO`，避免引入Next/OpenNext依赖。
- 新增`wrangler.test.jsonc`，注册SQLite Durable Object class migration；兼容日期设为当前CI workerd支持的`2026-11-17`。
- 新增`scripts/test-cloudflare-do.mjs`，通过本地Wrangler/workerd启动测试Worker，使用临时`--persist-to`目录运行：
  1. 创建订单intent；
  2. 账户资金预留claim；
  3. 持久化submitting和原clientOrderId；
  4. enqueue调度任务，验证完全相同重复入队幂等、相同taskId不同内容冲突；
  5. claim调度任务并验证DO Alarm时间已持久化；
  6. 停止并重启Worker，复用同一SQLite持久化目录；
  7. 验证订单状态/clientOrderId/账户leaseToken仍在；
  8. 验证scheduler lease可在重启后继续续期；
  9. 两个并发claim请求竞争同一任务，只允许一个领取成功。
- 增加`npm run test:cloudflare-do`，并接入GitHub Actions CI。
- 期间修正真实DO claim返回HTTP 201（不是200）的测试断言；加入请求超时、整体120秒watchdog和Wrangler进程组清理，避免CI挂起。
- 修正scheduler任务ID约定：DO内部持久化`reconcile:${intentId}`，与scheduler task core白名单一致；dispatcher从任务ID还原原始`v33:` intentId；taskId最大长度扩展至170，覆盖最大160字符intentId。

### 关键提交
- `2f62d42c958a`：新增DO SQLite集成测试Worker入口。
- `5056a1cb13cc`：新增Cloudflare DO SQLite集成测试配置。
- `1d074c045d2b`：匹配CI当前workerd支持的兼容日期。
- `249fc1a0a885`：增加Cloudflare DO SQLite集成测试命令。
- `b1ce5dde0c5a`：CI加入Durable Object真实SQLite集成测试。
- `874303e74a7a`：修正对账任务ID前缀并统一租约校验。
- `b1da93ddf41c`：按reconcile任务ID前缀恢复原订单intentId。
- `8c64beca4eac`：扩展对账任务ID长度以包含原intentId。
- `be4deaf99e22`：在DO健康快照中暴露持久化Alarm时间。
- `1ddf8309144b`：修正DO账户预留接口集成测试状态码。
- `46f491e004bc`、`aa10110ea0d2`、`29c084732e2f`、`25647b6a608d`：进程组清理、请求超时、总时限和健康探测保护。
- 文档同步：`294e167ffdefe6cf5b739f46f6e9bdf8027d6e87`、`932c34469da58cc4a8e94056e66d00024b06560b`。

### CI结果
- Run `44867881463` 成功：64个测试文件、506项测试通过；Cloudflare Durable Object SQLite集成脚本通过；TypeScript typecheck、Next.js production build、Cloudflare OpenNext build全部通过。
- 链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44867881463
- 该测试是真正本地Wrangler/workerd + SQLite DO运行时，不是Fake SQL；但不等于Cloudflare线上部署验收。

### 仍未覆盖
- 旧版scheduler_tasks表迁移的真实旧schema样本；
- transactionSync中途异常回滚；
- 租约自然过期后真实takeover与Alarm实际触发恢复；
- 多账户DO隔离；
- Cloudflare线上实例部署/重启与Testnet只读恢复演练。
- 生产BUY/SELL、Simple Earn真实赎回、Outbox生产投递仍关闭。


## DO真实SQLite终态事务回滚补充（2026-11-21）

- 扩展DO内部健康快照，只返回表记录数量和持久化Alarm时间，不暴露订单敏感字段。
- 本地Wrangler/workerd集成脚本现在会创建BUY intent并预留10 USDT，进入submitting后故意提交逐笔成交与交易所累计完全一致、但USDT实际消耗20 USDT（超过reservation）的终态finalize请求。
- finalize会在SQLite事务内先写入fill，再因实际消耗超过预留而拒绝；测试随后读取真实SQLite计数，确认fillCount=0、reservationCount=1、activeLockCount=1，证明失败时成交写入、预留结算和账户锁释放整体回滚。
- FakeSql健康快照测试桩也按fills/reservations/account_lock/scheduler_tasks分别返回计数，避免不同表计数混淆。
- CI Run `44868105813`成功：64个测试文件、506项测试；本地Cloudflare DO SQLite集成、typecheck、Next.js build、OpenNext build全部通过。链接：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44868105813
- 后续FakeSql计数桩修正Run `44868143736`成功：https://github.com/shhysy/Cryptocurrency_Dashboard/actions/runs/44868143736
- 当前真实SQLite集成已覆盖重启持久化、幂等/冲突入队、Alarm时间持久化、scheduler lease续期、并发claim和终态事务回滚；仍未覆盖旧schema升级样本、自然过期lease takeover/Alarm实际触发、多账户隔离及Cloudflare线上实例。
