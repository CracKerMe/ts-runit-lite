# 业务场景全景图（多节点组合能力挖掘）

本文档从 **15 种节点类型 + 消息机制 + 调度/事件/存储能力** 出发，系统性枚举
ts-workflow-engine-lite 在真实业务中可覆盖的场景，并给出每个场景对应的**节点组合模式**。

> 定位说明：本文档是**能力想象力目录**，不是"已实现功能清单"。
> 每个场景都标注了所需的外部集成（HTTP 端点、SQL 连接池、队列 Provider、通知渠道），
> 这些是使用方需要自行接入的。引擎负责**编排**，不负责提供这些外部系统本身。
>
> 权威字段定义见 [NODE_REFERENCE.md](./NODE_REFERENCE.md)，架构约束见 [CLAUDE.md](../CLAUDE.md)。

## 目录

- [一、能力原语盘点](#一能力原语盘点)
- [二、可复用的组合模式（Pattern Language）](#二可复用的组合模式pattern-language)
- [三、按行业域枚举业务场景](#三按行业域枚举业务场景)
  - [1. 电商与零售](#1-电商与零售)
  - [2. 金融、支付与风控](#2-金融支付与风控)
  - [3. 企业内部流程（OA / HR / 财务）](#3-企业内部流程oa--hr--财务)
  - [4. DevOps / SRE / 平台工程](#4-devops--sre--平台工程)
  - [5. 数据工程与 ETL](#5-数据工程与-etl)
  - [6. AI / LLM 应用编排](#6-ai--llm-应用编排)
  - [7. 内容、媒体与创作](#7-内容媒体与创作)
  - [8. 客户生命周期与增长（CRM / Marketing）](#8-客户生命周期与增长crm--marketing)
  - [9. 物流、供应链与制造](#9-物流供应链与制造)
  - [10. 医疗、教育与公共服务](#10-医疗教育与公共服务)
  - [11. SaaS 平台自身运营](#11-saas-平台自身运营)
  - [12. IoT 与边缘协同](#12-iot-与边缘协同)
- [四、跨域通用场景](#四跨域通用场景)
- [五、能力边界与选型建议](#五能力边界与选型建议)
- [六、场景索引速查表](#六场景索引速查表)

---

## 一、能力原语盘点

在设计组合场景前，先明确手上有哪些"积木"。

### 1.1 节点原语（15 种）

| 类别         | 节点                                   | 组合价值                                                   |
| ------------ | -------------------------------------- | ---------------------------------------------------------- |
| **计算**     | `action`、`transform`                  | 业务逻辑与数据整形；`transform` 保持工作流纯 JSON 可序列化 |
| **集成**     | `http`、`sql`、`queue`、`notification` | 对外连接的四条腿：API / 数据库 / 消息中间件 / 人的触达     |
| **控制流**   | `condition`、`router`、`loop`、`join`  | 二分支 / 多分支 / 迭代 / 汇聚                              |
| **时间**     | `wait`、`event`                        | 相对延时、绝对时点、外部事件唤醒                           |
| **人机协同** | `approval`                             | 把"人"作为一个可编排的异步节点                             |
| **组合**     | `subworkflow`                          | 流程复用与分层，构建流程库                                 |
| **可靠性**   | `rollback`                             | Saga 补偿事务                                              |

### 1.2 节点之外的编排能力

这些能力经常是场景能否成立的**决定性因素**，比节点类型本身更关键：

| 能力                | API / 配置                                               | 解锁的场景特征                           |
| ------------------- | -------------------------------------------------------- | ---------------------------------------- |
| **Signal**          | `engine.signal(instanceId, name, payload)`               | 运行中流程的外部干预、审批回调、数据补投 |
| **Query**           | `engine.query(instanceId, name)`（只读）                 | 向用户实时展示流程进度、中间状态         |
| **Update**          | `engine.update(instanceId, name, payload)`（同步追踪写） | 运行中改参数：改预算、改收货地址、改配额 |
| **生命周期控制**    | `pause` / `resume` / `cancel` / `terminate` `Instance`   | 熔断、人工叫停、灰度暂停                 |
| **Cron 调度**       | `EnhancedCronScheduler`（Jitter / Backfill / 时间窗口）  | 定时批处理、错峰削峰、历史数据补跑       |
| **事件总线 + 去重** | `EventBus` / `EventDeduplicator` / `triggerEvents`       | 事件驱动架构、幂等消费                   |
| **Hook 生命周期**   | `HookManager`                                            | 审计、埋点、外部系统同步                 |
| **DLQ**             | `DeadLetterQueue` + `/dlq` REST 端点（含批量重试）       | 失败兜底、运营手工干预                   |
| **Webhook**         | `/webhooks` 端点（注册、投递、重试、清理）               | 向外部系统主动推送流程状态               |
| **Analytics / SLA** | `/analytics/overview`、`/anomalies`、`/sla`              | 流程效能度量、超时预警、异常检测         |
| **任务队列路由**    | 节点 `taskQueue` + `TaskQueueManager`                    | 把重活分发给专用 worker，隔离资源        |
| **Worker 线程池**   | `WORKER_POOL_ENABLED` + Sticky 亲和性                    | CPU/IO 密集型节点卸载，主线程不阻塞      |
| **Secret 解析**     | `${secret:NAME}`（http/sql/queue 节点）                  | 凭据不落工作流定义，安全合规             |
| **调试能力**        | `WorkflowDebugger` + `BreakpointManager`                 | 复杂流程的断点调试                       |
| **测试能力**        | `TestGenerator`、`MutationTester`、`DryRunExecutor`      | 流程上线前的自动验证、变更影响分析       |
| **模板系统**        | `/templates` + `instantiate`                             | 让业务人员基于模板自助创建流程           |
| **版本管理**        | `workflow-versions` 存储目录                             | 流程灰度、回滚、A/B                      |

### 1.3 三条关键约束（贯穿全文）

所有场景设计都必须绕开这三点：

1. **`wait` 能跨重启，但不能跨"进程长期不在"**（v2.3.0 起）。
   `wait` 默认是 **durable** 的：首次进入即把绝对 deadline 固化到实例状态并持久化，
   重启恢复后只等剩余时长（第 6 天重启的"7 天等待"只再等 1 天，不会重新计时）；
   停机期间已过期的等待在恢复时立即触发。
   → 因此**到期即可、不要求准时**的长延时（自动确认收货、试用到期、N 天后回访）
   现在可以直接用 `wait`。
   → 但引擎**不会在进程外替你计时**：触发时刻上限是"进程恢复的那一刻"。
   凡是要求**准时触发**，或流程必须在**进程长期下线/不保证重启**时仍按时推进的场景，
   仍用 **外部 Cron / 调度器到期回调 `event` 节点**（下文 **P-11 外部定时唤醒**）。
2. **单进程**——无分布式锁、无跨进程协调、一个 `STORAGE_DIR` 只能一个引擎进程用。
   → 适合**单体应用内嵌编排**，不适合多副本水平扩展的集群调度。
3. **含闭包的 `action` 不可序列化**——重启后需由应用代码重新注册定义，再
   `resumeRunningInstancesFromStorage()`。
   → 追求"纯数据驱动、重启自愈"的流程，优先用 `transform` + `http` + `sql` 构造，
   避免顶层 `action` 函数（下文称 **纯 JSON 流程**）。

---

## 二、可复用的组合模式（Pattern Language）

下面 16 个模式是后续所有业务场景的"公式"。业务场景 = 模式 × 领域。

### P-1 Saga 补偿事务（跨系统一致性）

```
action(扣库存) → action(扣款) → action(发货)
      ↓ failureNext      ↓ failureNext
  rollback(还库存) ← rollback(退款)
```

**要点**：每个正向节点配 `failureNext` 指向对应 `rollback` 节点，`rollbackTo` 串联补偿链。
**解决**：没有分布式事务时，跨多个微服务/第三方 API 的最终一致性。

### P-2 扇出-汇聚（并行加速）

```
action(fanout) → next: [fetchA, fetchB, fetchC]
                        ↓      ↓      ↓
                     join(waitFor: [fetchA, fetchB, fetchC], mode: "all")
                                ↓
                          transform(合并结果)
```

**要点**：`waitFor` 的节点必须来自**同一次 `next` 扇出**；节点 ID 用驼峰（表达式不支持连字符）。
**变体**：`mode: "any"` 做**竞速**——多供应商询价取最快返回的那个。
**解决**：把串行 3×500ms 压成并行 500ms；聚合多数据源。

### P-3 人在回路审批（Human-in-the-Loop）

```
condition(金额>阈值?) --true--> approval(prompt, timeoutMs) --approved--> 执行
                                     ↓ rejected / timedOut
                              notification(通知发起人)
```

**要点**：`approval` 输出含 `timedOut` 字段，超时和拒绝要分开处理。
**升级**：多级审批 = 串联多个 `approval`；会签 = 扇出多个 `approval` + `join(mode:"all")`；
或签 = 扇出 + `join(mode:"any")`。
**解决**：所有需要人工卡点的流程。

### P-4 分层子流程（流程库）

```
主流程 → subworkflow(风控子流程, waitForCompletion: true)
       → subworkflow(开票子流程)
       → subworkflow(通知子流程)
```

**要点**：把"风控""对账""发票""KYC"等横切流程做成可复用子工作流，主流程只做编排。
**解决**：流程资产沉淀，避免每条业务线重复实现同一段逻辑。

### P-5 事件驱动状态机（长流程）

```
start → action(创建订单) → event(onEvent: "payment.paid") → action(发货)
                                    → event(onEvent: "logistics.delivered") → action(确认收货)
```

**要点**：每个 `event` 节点是一个**可持久化的暂停点**，配合本地文件存储可跨重启恢复。
**解决**：生命周期跨越数天/数周的业务对象（订单、工单、保单、合同）。

### P-6 批量迭代处理

```
sql(查出待处理列表) → loop(collection, parallel: true, maxConcurrency: 5, body: 单条处理)
                    → transform(汇总成功/失败数) → notification(日报)
```

**要点**：`maxConcurrency` 保护下游；`MAX_LOOP_ITERATIONS`（默认 10000）是硬上限，
超大批量要分页驱动多次实例。
**解决**：定时批处理、数据清洗、批量通知。

### P-7 多级路由分诊（Triage）

```
router(routes: [
  { condition: "${score > 90}", target: "vipFlow",     priority: 1 },
  { condition: "${score > 60}", target: "normalFlow",  priority: 2 },
  { condition: "${risk == 'high'}", target: "manualReview", priority: 0 }
], defaultTarget: "rejectFlow")
```

**要点**：`priority` 数字越小越优先，用它表达"风控优先于等级"这类业务优先级。
**解决**：分级服务、工单分派、风险分诊。

### P-8 重试-降级-死信三级容错

```
http(retryPolicy: exponential ×3)
  ↓ failureNext
condition(是否可降级?) --true--> http(备用服务/缓存)
                       --false--> notification(告警) → [进 DLQ]
```

**要点**：`http.retryPolicy` 处理瞬时抖动，`failureNext` 处理确定性失败，DLQ 兜底人工。
**解决**：对不可靠第三方 API 的防御性集成。

### P-9 竞速与超时兜底

```
fanout → [callPrimary, waitFallback]
           ↓              ↓ (wait durationMs: 3000)
         join(mode: "any") → router(谁先完成?)
```

**解决**：给外部依赖设"软超时"，超时走降级路径而非整体失败。

### P-10 幂等事件消费

```
triggerEvents: ["order.created"]  → EventDeduplicator 去重
  → sql(SELECT 检查是否已处理) → condition(已处理?) --true--> 直接结束
```

**解决**：消息中间件 at-least-once 投递下的重复消费。

### P-11 外部定时唤醒（准时触发 / 进程不常驻）⭐

```
action(记录到期时间到 DB) → event(onEvent: "timer.fired.${instanceId}")
                                   ↑
          外部 Cron 扫描 DB 到期记录 → 调 POST /events 触发
```

**要点**（v2.3.0 起已放宽）：`wait` 现在是 durable 的，"3 天后提醒""7 天后自动确认收货"
"30 天试用到期"这类**到期即可、不要求准时**的延时，可以直接用 `wait` 实现，重启不再丢失。

P-11 仍是必要的，但适用面收窄为两类：

1. **要求准时触发**——`wait` 的触发时刻上限是进程恢复的那一刻，停机越久偏差越大；
   需要"到点就发"的（营销活动开抢、定时发布、SLA 时限）必须用 P-11。
2. **进程不保证长期在线**——Serverless、按需启停、或等待期长到不能假设进程会重启。

**解决**：准时性要求高、或不能依赖进程存活的定时业务。

### P-12 定时批处理 + Backfill

```
EnhancedCronScheduler(spec, jitter, 时间窗口) → engine.start(批处理流程)
                                    backfill(补跑历史区间)
```

**要点**：Jitter 避免整点惊群；Backfill 用于故障后补跑漏掉的调度周期。
**解决**：日结、月结、报表、对账。

### P-13 运行中干预（Signal / Update / Query）

```
运行中实例 ──Query──> 前端展示"当前进度：3/10"
           ──Update──> 用户中途修改收货地址/预算上限
           ──Signal──> 外部系统补投数据、触发审批结果
```

**要点**：`update` 是**同步追踪写**（会等返回），`signal` 是异步投递，`query` 只读不改状态。
**解决**：长流程的用户可交互性——这是与"一次性脚本"的本质区别。

### P-14 熔断与灰度控制

```
analytics(/anomalies 检测失败率) → 运维/自动脚本 → pauseInstance / cancelInstance
                                                  → 新版本工作流 workflow-versions 灰度
```

**解决**：流程级别的止血能力，批量事故不扩大。

### P-15 审计与合规追溯

```
HookManager(workflow.started / node.completed / workflow.signaled ...)
  → 审计日志 + Webhook 推送到合规系统
  + 终态实例归档 archive/YYYY-MM-DD/
```

**要点**：`ARCHIVE_ENABLED=true` + `ARCHIVE_RETENTION_DAYS` 满足"留存 N 年"的合规要求。
**解决**：金融/医疗等强监管场景的全链路可追溯。

### P-16 纯 JSON 流程（重启自愈）⭐

```
仅使用 http / sql / queue / transform / condition / router / loop / join / wait / event / notification
避免顶层 action 闭包 → 定义完全可序列化 → 重启后自动 resume，无需应用代码重新注册
```

**解决**：让流程成为**数据**而非代码，支撑低代码平台、业务自助配置、热更新。

---

## 三、按行业域枚举业务场景

每个场景给出：**流程骨架**（节点组合）+ **关键点**（为什么这样设计）。

### 1. 电商与零售

#### 1.1 标准订单履约全链路 ⭐核心场景

```
start
 → transform(标准化下单参数)
 → sql(校验库存)
 → condition(库存足够?)
   ├ false → notification(缺货通知) → end
   └ true  → http(调支付网关预授权)
              → event(onEvent: "payment.paid")        [P-5 可持久化暂停]
              → fanout → [sqlDeductStock, httpCreateShipment, queuePublishOrderEvent]
              → join(mode: "all")                      [P-2]
              → transform(组装履约结果)
              → event(onEvent: "logistics.delivered")
              → subworkflow(售后保障期流程)
```

**关键点**：支付与物流是**外部事件**而非轮询，用 `event` 节点挂起；三个下游动作并行扇出后
`join` 汇聚。任一失败走 `failureNext` → `rollback` 链（P-1）。

#### 1.2 超时未支付自动取消

```
action(下单) → wait(durationMs: 1800000)  // 30 分钟，durable 默认开启
            → condition(已支付?)
               ├ false → rollback(释放库存) → notification
               └ true  → 继续履约
```

**关键点**：30 分钟量级、不要求秒级准时，`wait` 的 durable 语义已经够用——重启后按原定
deadline 续等，不会重新计时。只有当**支付超时判定要求秒级精确**，或该服务是
按需启停（不能假设进程会在 30 分钟内自己重启回来）时，才升级到 P-11。

#### 1.3 秒杀/大促削峰

```
queue(consume: "seckill-requests") → sql(原子扣减) → condition(成功?)
  → router(分流到不同履约通道)
loop(maxConcurrency: N) 控制下游并发
```

**关键点**：`taskQueue` 把扣减动作路由到专用 worker 池，隔离资源不拖垮主流程。

#### 1.4 退货退款（多级审批 + 补偿）

```
action(提交退货) → router(按金额/原因分诊)
  ├ 小额 → action(自动批准)
  ├ 中额 → approval(客服主管, timeoutMs: 24h)
  └ 大额 → approval(客服主管) → approval(财务)   [串联多级]
 → http(调退款网关) → rollback(失败则回滚退货单状态)
 → notification(多渠道告知用户)
```

#### 1.5 其他电商场景（骨架同上，差异在节点参数）

| 场景             | 核心组合                                                            |
| ---------------- | ------------------------------------------------------------------- |
| 购物车弃单挽回   | P-11 定时唤醒 → condition(是否已下单) → notification(优惠券)        |
| 价格监控与调价   | P-12 Cron → loop(遍历 SKU) → http(抓竞品价) → condition → sql(更新) |
| 商品上架审核     | approval(内容审核) + approval(类目审核) 会签 → P-3                  |
| 预售/定金尾款    | event(定金支付) → P-11(尾款期到) → event(尾款支付) → 履约           |
| 多仓库智能发货   | fanout 查各仓库存 → join(all) → transform(选最优仓) → http(下发)    |
| 跨境订单清关     | subworkflow(报关) + event(海关放行) + P-8(重试单一通道)             |
| 会员等级升降     | P-12 Cron → sql(算消费额) → router(分级) → notification             |
| 拼团成团判定     | event(每人支付) 累积 → condition(人数达标?) → 成团 / 超时退款       |
| 优惠券发放与核销 | loop(批量发券) + 幂等 P-10 防重复发放                               |
| 直播带货订单     | queue(consume 弹幕下单) → 高并发 P-6 批处理                         |

---

### 2. 金融、支付与风控

#### 2.1 KYC / 开户尽调 ⭐

```
start → transform(标准化身份信息)
 → fanout → [httpOCR身份证, httpFaceCompare, httpCreditBureau, sqlBlacklist]
 → join(mode: "all")                                       [P-2 并行加速]
 → transform(综合风险评分)
 → router([score<30 → autoApprove, score<70 → manualReview, else → reject])  [P-7]
 → manualReview: approval(合规专员, timeoutMs: 48h)
 → sql(落库) → HookManager(审计留痕)                        [P-15]
```

**关键点**：四路征信查询并行化是**体验决定性的**（串行 4×2s vs 并行 2s）；
全流程 Hook 审计 + 归档满足监管留存。

#### 2.2 支付交易与对账

```
http(发起支付) → P-8(重试+降级备用通道) → event(onEvent: "payment.callback")
  → condition(金额一致?) ├ false → notification(资损告警 critical) → approval(人工核查)
                        └ true  → sql(记账)
每日: P-12 Cron → sql(拉当日流水) → http(拉渠道账单) → loop(逐笔比对)
     → transform(差异汇总) → condition(有差异?) → notification(财务)
```

#### 2.3 反欺诈实时拦截

```
queue(consume: "transactions") → fanout → [规则引擎http, 设备指纹http, 历史行为sql]
 → join(mode: "any" 竞速, 任一命中高危即可)                 [P-9]
 → router(高危 → 冻结+人工, 中危 → 二次验证 event, 低危 → 放行)
```

**关键点**：`mode: "any"` 让最快返回的高危信号立即阻断，不等全部检查完成。

#### 2.4 其他金融场景

| 场景           | 核心组合                                                             |
| -------------- | -------------------------------------------------------------------- |
| 贷款审批全流程 | P-4 子流程库(征信/额度/放款) + P-3 多级审批 + P-15 审计              |
| 还款计划与催收 | P-11 定时唤醒每期 → condition(已还?) → 分级催收 notification 升级    |
| 保险理赔       | 材料上传 event → 并行(定损/核保) join → approval(理赔员) → 打款+补偿 |
| 信用卡分期     | approval + subworkflow(账单生成) + P-12 月结 Cron                    |
| 资金归集/代付  | P-1 Saga 严格补偿 + P-15 全审计 + approval 双人复核                  |
| 反洗钱可疑监测 | P-12 Cron 扫描 + loop 逐笔 + router 分级上报                         |
| 券商开户       | 同 2.1 KYC + event(风测问卷完成) + 视频见证 approval                 |
| 账户风控熔断   | analytics(/anomalies) → P-14 批量 pause/cancel 止血                  |

---

### 3. 企业内部流程（OA / HR / 财务）

> 这是 `approval` + `subworkflow` + `notification` 组合的**主场**，也是最容易做成
> **纯 JSON 流程（P-16）**、交给业务人员自助配置的领域。

#### 3.1 通用多级审批引擎 ⭐

```
start → transform(取申请单)
 → router(按金额/类型决定审批链)                            [P-7]
 → approval(直属主管, timeoutMs) → condition(approved?)
    ├ false → notification(驳回) → end
    └ true  → approval(部门总监) → approval(CFO)            [串联 = 逐级]
 → fanout → [notifyApplicant, sqlArchive, httpSyncERP]
 → join(all) → end
```

**变体**：

- **会签**（全部同意才通过）：扇出多个 `approval` + `join(mode: "all")`
- **或签**（任一同意即通过）：扇出 + `join(mode: "any")`
- **加签/转办**：`Signal` 注入新审批人（P-13）
- **超时自动升级**：`approval.timedOut` → `router` 转上级

#### 3.2 员工入职（Onboarding）

```
start → fanout → [httpCreateAD账号, httpOpenEmail, httpHRIS建档, httpIT领设备, sqlWorkstation]
 → join(all) → notification(欢迎邮件+入职指引)
 → P-11(入职第7天) → event → notification(试用期跟进问卷)
 → P-11(第30/60/90天) → approval(主管转正评估)
```

**关键点**：入职是典型的**多系统并行开通**，join 汇聚后统一通知，任一失败进 DLQ 由 HR 人工跟进。

#### 3.3 员工离职（Offboarding，合规关键）

```
approval(主管批准) → fanout → [禁用账号, 回收设备, 结算工资, 交接确认]
 → join(all)  ← 任一未完成则流程不结束，这正是合规要求
 → approval(HR 最终确认) → sql(归档) → P-15 审计
```

**关键点**：`join(mode: "all")` 在这里是**合规控制点**——缺任何一项都不允许流程结束。

#### 3.4 其他企业流程

| 场景           | 核心组合                                                       |
| -------------- | -------------------------------------------------------------- |
| 请假/加班/出差 | P-3 + 日历 http 集成 + P-11 到期提醒                           |
| 报销与发票核验 | loop(逐张发票) → http(税局验真) → join → approval → 打款       |
| 采购到付款 P2P | subworkflow(询价/比价/合同/收货/对账) 五段式 P-4               |
| 合同审批与续签 | P-3 多方会签 + P-11(到期前 30 天提醒续签)                      |
| 预算申请与管控 | approval + Update(P-13 运行中调整预算额度)                     |
| 绩效考核周期   | P-12 Cron 启动 → loop(全员) → subworkflow(个人考核) → 汇总     |
| 培训与认证到期 | P-11 定时唤醒 → condition(是否已续证) → 分级 notification      |
| 资产盘点       | P-12 Cron → loop(资产清单) → approval(差异确认)                |
| IT 工单流转    | router(P-7 分诊) → approval → event(用户确认解决) → 满意度调查 |
| 印章/证照借用  | approval 双人复核 + P-11(归还到期提醒) + P-15 审计             |

---

### 4. DevOps / SRE / 平台工程

#### 4.1 CI/CD 发布流水线（含人工卡点）⭐

```
event(onEvent: "git.push") → http(触发构建)
 → fanout → [单元测试, 集成测试, 安全扫描, 镜像构建]
 → join(mode: "all")                                        [P-2 并行质量门]
 → condition(全部通过?)
    ├ false → notification(#dev 失败详情) → end
    └ true  → http(部署 staging) → http(冒烟测试)
              → approval(发布负责人, prompt: "确认发布生产?")  [P-3 人工卡点]
              → http(灰度 10%) → wait(durationMs: 300000) → http(查指标)
              → condition(错误率正常?)
                 ├ false → rollback(自动回滚) → notification(critical)  [P-1]
                 └ true  → http(全量发布) → notification(发布成功)
```

**关键点**：灰度观察期用 `wait`（分钟级、进程内可接受）；回滚用 `rollback` 节点而非手工。

#### 4.2 告警自愈（Auto-Remediation）

```
http(Webhook 接收告警) → router(按告警类型分诊)               [P-7]
  ├ 磁盘满 → action(清理日志) → condition(恢复?) → 否则 approval(SRE 介入)
  ├ 进程挂 → http(重启服务) → wait(30s) → http(健康检查) → 重试 P-8
  └ 未知   → notification(oncall, critical)
全程 P-15 Hook 记录，形成自愈率统计
```

#### 4.3 故障演练（Chaos Engineering）

```
P-12 Cron(工作时间窗口) → approval(演练负责人确认)
 → http(注入故障) → wait(观察期) → fanout(采集多维指标) → join
 → transform(生成演练报告) → http(恢复故障) → notification(报告)
 → failureNext: 立即 rollback(恢复) —— 演练失败必须能一键复原
```

#### 4.4 其他 DevOps 场景

| 场景             | 核心组合                                                         |
| ---------------- | ---------------------------------------------------------------- |
| 基础设施供给     | approval(成本审批) → http(Terraform) → join(多资源) → 注册 CMDB  |
| 证书/密钥轮换    | P-11(到期前 30 天) → http(签发) → loop(分发各节点) → 验证 → 回收 |
| 数据库变更 DDL   | approval(DBA) → 备份 → 执行 → 验证 → rollback(失败回滚) P-1      |
| 容量巡检与扩缩容 | P-12 Cron → analytics → condition(阈值) → http(扩容) → 通知      |
| 依赖漏洞治理     | P-12 Cron → http(扫描) → loop(逐个漏洞) → router(按严重度建单)   |
| 值班排班与升级   | P-11 定时 → notification 未响应 → 升级下一级 oncall              |
| 备份与恢复演练   | P-12 Cron 备份 + 定期 approval + 恢复验证子流程 P-4              |
| 多环境配置同步   | fanout(各环境) → join → 差异 transform → approval → 应用         |
| 成本优化巡检     | P-12 Cron → sql(费用) → router(按浪费类型) → approval → 执行清理 |

---

### 5. 数据工程与 ETL

#### 5.1 每日数据管道 ⭐

```
P-12 Cron(带 Jitter 错峰) → sql(检查上游就绪)
 → condition(数据就绪?)
    ├ false → wait(durationMs: 600000) → 重试(maxRetries)  [等待上游]
    └ true  → fanout → [抽取源A, 抽取源B, 抽取源C]           [P-2]
              → join(all) → transform(统一 Schema)
              → loop(分片并行清洗, maxConcurrency: 4)        [P-6]
              → sql(写入数仓) → http(触发下游 BI 刷新)
              → transform(数据质量报告) → condition(质量达标?)
                 ├ false → notification(数据团队, critical) + 阻断下游
                 └ true  → queue(publish: "data.ready")
```

**关键点**：Jitter 避免所有管道整点抢资源；**数据质量门禁**是 `condition` 的经典用法；
失败可用 Cron `backfill` 补跑历史分区。

#### 5.2 CDC 增量同步

```
queue(consume: "cdc-events") → P-10 幂等去重 → router(按表分流)
 → loop(批量攒批) → sql(批量 upsert) → 冲突走 DLQ 人工
```

#### 5.3 其他数据场景

| 场景             | 核心组合                                                       |
| ---------------- | -------------------------------------------------------------- |
| 数据质量监控     | P-12 Cron → loop(规则集) → join → 异常 notification + SLA 上报 |
| 报表生成与分发   | P-12 Cron → sql → transform → http(渲染) → loop(多渠道分发)    |
| 数据归档与清理   | P-12 Cron → sql(筛冷数据) → 归档 → 校验 → 删除(approval 保护)  |
| 主数据治理 MDM   | 多源 fanout → join → transform(合并存活规则) → approval(冲突)  |
| 埋点数据回补     | Cron backfill(补跑历史区间) + loop 分片                        |
| 机器学习特征生产 | 依赖 DAG 用 join 表达 + 版本化输出                             |
| 数据血缘同步     | Hook(P-15) → 每次节点完成推送血缘到元数据平台                  |

---

### 6. AI / LLM 应用编排

> 这是本引擎**最具想象空间**的新兴场景：LLM 调用天然是 `http` 节点，
> Agent 的"思考-行动"循环天然是 `loop` + `router`，而 `approval` 提供了 AI 安全的人工闸门。

#### 6.1 RAG 问答流水线 ⭐

```
start → transform(清洗用户问题)
 → fanout → [httpEmbedding+向量检索, sqlFullText检索, httpWeb搜索]
 → join(mode: "all")                                        [P-2 混合召回]
 → transform(重排与去重, 拼 Prompt)
 → http(LLM 生成, retryPolicy: exponential)                 [P-8]
 → condition(置信度 < 阈值?)
    ├ true  → approval(人工审核后再回复)                     [P-3 AI 安全闸门]
    └ false → 直接返回
 → sql(记录问答用于评测)
```

#### 6.2 Multi-Agent 协作编排 ⭐

```
router(意图识别, 分诊到专家 Agent)                           [P-7]
  ├ 代码类   → subworkflow(coding-agent-flow)
  ├ 数据类   → subworkflow(data-agent-flow)
  └ 通用类   → subworkflow(general-agent-flow)
每个子流程内部: loop(ReAct 循环, 最多 N 轮)
                 → http(LLM 决策) → router(选工具)
                 → [http工具A / sql工具B / 危险工具→approval]
                 → condition(是否完成?) 决定继续或退出
最后 join(多 Agent 结果) → transform(汇总) → 输出
```

**关键点**：

- `loop` 的 `MAX_LOOP_ITERATIONS` 天然是 **Agent 失控的保险丝**；
- **危险工具（删数据、发邮件、付款）前置 `approval`**，这是 AI Agent 落地的核心安全设计；
- `subworkflow` 让每个 Agent 成为可独立测试、可复用的资产。

#### 6.3 批量内容生成与审核

```
sql(取待生成列表) → loop(parallel, maxConcurrency: 3)        [P-6 保护 LLM 限流]
  → body: http(LLM 生成) → http(内容安全审核 API)
         → router(通过 → 入库 / 疑似 → approval / 违规 → 丢弃)
 → transform(成功率统计) → notification(日报)
```

**关键点**：`maxConcurrency` 是**LLM API 限流的关键防线**；失败条目进 DLQ 批量重试。

#### 6.4 其他 AI 场景

| 场景                | 核心组合                                                             |
| ------------------- | -------------------------------------------------------------------- |
| Prompt A/B 评测     | fanout(多个 Prompt 变体) → join → transform(对比打分) → 报告         |
| 模型训练任务编排    | 长任务 heartbeat 心跳 + taskQueue 专用 worker + P-11 结果轮询        |
| 文档智能处理 IDP    | http(OCR) → loop(逐页) → http(抽取) → join → approval(低置信人工校)  |
| AI 客服升级人工     | loop(对话轮次) → condition(情绪/失败次数) → event(转人工) → approval |
| 数据标注众包        | loop(任务分发) → approval(多人标注) → join(all) → transform(一致性)  |
| 模型上线灰度        | 同 4.1 发布流水线 + analytics 指标对比 + 自动 rollback               |
| Embedding 增量更新  | CDC queue → loop 批量 → http(向量化) → sql(写入)                     |
| AI 生成内容合规留痕 | P-15 Hook 全链路 + 归档（应对 AI 监管要求）                          |

---

### 7. 内容、媒体与创作

| 场景          | 核心组合                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| 视频转码分发  | 上传 event → fanout(多码率转码, taskQueue 专用 worker) → join → CDN 推送 |
| 内容审核多级  | http(机审) → router(置信度) → approval(人审) → approval(复审) → 发布     |
| 稿件采编发    | approval(编辑) → approval(主编) → P-11(定时发布) → 多渠道 loop 分发      |
| 媒资批量水印  | loop(parallel) + Worker 线程池卸载 CPU 密集处理                          |
| 直播流程编排  | event(开播) → 定时巡检 P-12 → event(下播) → 转录/切片/归档子流程         |
| 多语言本地化  | loop(语种) → http(翻译) → approval(母语校对) → join → 发布               |
| 版权侵权监测  | P-12 Cron → loop(全网扫描) → condition(相似度) → 取证 → approval(维权)   |
| 评论/UGC 治理 | queue(consume) → 机审 → router → approval → 处置 + 申诉子流程            |

---

### 8. 客户生命周期与增长（CRM / Marketing）

#### 8.1 用户成长旅程（Lifecycle Journey）⭐

```
event(user.registered) → notification(欢迎)
 → P-11(D1) → event → condition(是否激活?)
      ├ 否 → notification(激活引导)
      └ 是 → 继续
 → P-11(D3/D7/D30) → router(按行为分群) → 差异化 notification
全程可 Update(P-13) 调整用户所在的旅程分支
```

**关键点**：**每个时间点都必须是 P-11 外部唤醒**，绝不能用 `wait`——用户旅程跨越数周。

#### 8.2 其他增长场景

| 场景               | 核心组合                                                         |
| ------------------ | ---------------------------------------------------------------- |
| 线索评分与分派 MQL | 多源 fanout 富化 → join → transform(评分) → router(分派销售)     |
| 销售机会推进       | 阶段 event 驱动 P-5 + 停滞 P-11 提醒 + approval(折扣审批)        |
| 流失预警挽回       | P-12 Cron → sql(行为指标) → router(流失风险等级) → 分级触达      |
| NPS 调研闭环       | P-11 触发 → notification(问卷) → event(回收) → router(差评→工单) |
| 精准营销活动       | loop(人群批量) + maxConcurrency 保护 + 多渠道 notification       |
| 续费与催缴         | P-11(到期前 30/7/1 天) 三级提醒 → condition(已续?) → 降级/停服   |
| 推荐奖励发放       | event(好友注册) → 幂等 P-10 → sql(发奖) → 风控 condition 防刷    |
| 客户 360 视图同步  | Hook P-15 → 各系统事件 → transform 归一 → sql(CDP 写入)          |

---

### 9. 物流、供应链与制造

| 场景             | 核心组合                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| 运单全生命周期   | P-5 事件驱动(揽收/中转/派送/签收) + 异常分支 + 超时 P-11 预警           |
| 智能分单调度     | fanout(多承运商询价) → join(any 竞速/all 比价) → transform(选优) → 下单 |
| 库存补货         | P-12 Cron → sql(安全库存) → condition → approval(采购) → subworkflow    |
| 供应商准入       | 同 KYC 模式(2.1) + 多部门会签 approval                                  |
| 生产工单排程     | router(产线分配) → loop(工序) → 每工序 event(完工上报) → join           |
| 质检与不良品处理 | condition(合格?) → router(返工/报废/让步接收 approval) → P-1 补偿       |
| 设备维保计划     | P-11 定时 → 工单 → approval → 执行 → 验收 event                         |
| 冷链温控异常     | IoT queue(consume) → condition(超阈值) → notification(critical) → 处置  |
| 退货逆向物流     | approval → 取件 event → 质检 router → 退款 subworkflow                  |

---

### 10. 医疗、教育与公共服务

| 场景           | 核心组合                                                              |
| -------------- | --------------------------------------------------------------------- |
| 预约挂号与提醒 | 预约 → P-11(就诊前 1 天/1 小时) → notification → event(到院签到)      |
| 转诊与会诊     | approval(多科室会签 join all) + P-15 全程审计留痕                     |
| 处方审核       | http(合理用药引擎) → condition → approval(药师) → 发药                |
| 随访计划       | P-11 多时点唤醒 → notification(问卷) → event(回收) → router(异常转诊) |
| 临床试验流程   | 严格 P-15 审计 + approval 多级 + 归档合规留存                         |
| 学生选课与排课 | loop(志愿轮次) + condition(容量) + router(调剂)                       |
| 作业批改与反馈 | loop(逐份) → http(AI 初评) → approval(教师复核) → notification(家长)  |
| 考试成绩发布   | P-12 定时 → sql(统计) → approval(教务确认) → 多渠道发布               |
| 政务事项办理   | router(事项分诊) → 多部门 join 并联审批 → P-11 办结时限预警           |
| 证照到期换发   | P-11(到期前 90/30/7 天) 三级提醒 → 在线办理子流程                     |

---

### 11. SaaS 平台自身运营

> 把引擎用在**自己的产品**上——这是最容易被忽略、但 ROI 最高的一类场景。

| 场景               | 核心组合                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| 租户开通与初始化   | fanout(建库/建账号/初始化配置/发欢迎邮件) → join(all) → 失败进 DLQ       |
| 订阅计费周期       | P-12 月结 Cron → loop(租户) → transform(算量) → http(扣款) → P-8 重试    |
| 用量超限处置       | P-12 Cron → sql(用量) → router(提醒/限流/停服) → notification            |
| 试用转付费         | P-11(试用到期前) → notification → condition(已付费?) → 降级/回收资源     |
| 租户数据导出       | approval(合规确认) → 长任务 heartbeat → 分片 loop → 通知下载             |
| 租户注销与数据删除 | approval(双人) → P-11(冷静期 30 天) → event(确认) → 级联删除 → 审计      |
| 功能灰度发布       | workflow-versions 版本化 + router(按租户分流) + analytics 对比           |
| SLA 违约赔付       | analytics(/sla) → condition(违约?) → transform(算赔付) → approval → 打款 |

---

### 12. IoT 与边缘协同

| 场景              | 核心组合                                                              |
| ----------------- | --------------------------------------------------------------------- |
| 设备注册与激活    | event(设备上线) → http(鉴权) → sql(建档) → notification               |
| 遥测异常处置      | queue(consume 遥测) → condition(阈值) → router(分级) → 自愈/告警      |
| OTA 固件升级      | approval(发布) → loop(分批灰度, maxConcurrency) → join → 失败回滚 P-1 |
| 设备指令下发      | http(下发) → event(设备 ACK) → 超时 P-8 重试 → DLQ                    |
| 边缘-云协同批处理 | 边缘 queue 上报 → 云端 loop 聚合 → transform → 回传配置               |
| 能耗优化调度      | P-12 Cron(分时电价) → sql(负载) → transform(策略) → loop(下发设备)    |

---

## 四、跨域通用场景

不分行业、几乎每个系统都需要的横切流程：

| 场景               | 核心组合                                                              |
| ------------------ | --------------------------------------------------------------------- |
| **通用审批中台**   | P-16 纯 JSON + P-7 路由 + P-3 审批，业务方只配 JSON 不写代码          |
| **通知编排中心**   | router(按用户偏好/时区/渠道可达性) → 多渠道降级(Slack→邮件→短信)      |
| **对账中心**       | P-12 Cron + fanout(多方数据) + join + loop 逐笔 + 差异 approval       |
| **数据同步中台**   | CDC queue + P-10 幂等 + P-8 容错 + DLQ 兜底                           |
| **定时任务平台**   | Cron + Jitter + Backfill + 失败告警 + 执行历史 analytics              |
| **Webhook 网关**   | 接收 → P-10 去重 → router(按事件类型分发) → 下游 subworkflow          |
| **重试与死信中心** | 统一 DLQ + REST 批量重试 + 运营看板                                   |
| **合规审计流水线** | P-15 Hook 全量采集 + 归档 + 保留周期策略                              |
| **配置变更管控**   | approval(双人复核) → 灰度 → 观察 wait → 自动 rollback                 |
| **压测与容量规划** | loop(阶梯加压) + analytics 采集 + condition(拐点检测)                 |
| **流程健康度巡检** | P-12 Cron → analytics(/anomalies) → 长时间卡住实例 → 告警/自动 cancel |
| **多租户批量运维** | loop(租户列表) + subworkflow(单租户操作) + join 汇总报告              |

---

## 五、能力边界与选型建议

诚实说明**不适合**用本引擎的场景，避免误用：

### 5.1 明确不支持

| 需求                                  | 为什么不行                                                        | 替代方案                             |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| 多副本水平扩展、集群调度              | 单进程，无分布式锁，`STORAGE_DIR` 独占                            | Temporal / Cadence                   |
| 准时触发的长延时 / 进程可能长期不在线 | `wait` 已能跨重启续等，但不会在进程外计时，触发时刻取决于何时恢复 | **P-11 外部定时唤醒**（准时性场景）  |
| 高吞吐（万级 TPS）流程                | 本地文件存储 + 单进程                                             | 数据库后端 + 集群方案                |
| 强事务 ACID 跨库                      | 无分布式事务                                                      | **P-1 Saga 补偿**                    |
| 跨机房容灾自动切换                    | 无复制能力                                                        | 外部存储复制 + 冷备                  |

### 5.2 场景适配度自检清单

设计流程前逐条确认：

- [ ] 流程中最长的等待是多久？天级以上的 `wait` 确认没有关掉 `durable`
- [ ] 这个等待**要求准时触发**吗？要 → 用 P-11；"到期即可"→ 直接用 `wait`
- [ ] 是否需要多实例并行跑同一 `STORAGE_DIR`？→ 不支持，改单进程或换方案
- [ ] `action` 是否用了闭包？→ 影响重启恢复，能用 `transform` 就用 `transform`（P-16）
- [ ] `join.waitFor` 的节点是否都在同一次 `next` 扇出中？→ 否则 `mode:"all"` 会失败
- [ ] 节点 ID 是否含连字符？→ 表达式引用会解析成减法，改驼峰
- [ ] 外部 API 是否可能抖动？→ 配 `retryPolicy` + `failureNext` + DLQ（P-8）
- [ ] 是否有资损/不可逆动作？→ 前置 `approval`，后置 `rollback`（P-1 + P-3）
- [ ] 消息消费是否幂等？→ 用 `EventDeduplicator` + 业务去重（P-10）
- [ ] 凭据是否写进了工作流定义？→ 改用 `${secret:NAME}`
- [ ] 需要合规留存多久？→ 配 `ARCHIVE_ENABLED` + `ARCHIVE_RETENTION_DAYS`（P-15）

### 5.3 落地推荐路径

1. **先做纯 JSON 流程（P-16）**——从审批、通知这类不含复杂计算的流程起步，
   验证"流程即数据"的可维护性。
2. **再引入集成节点**——接入 `http`/`sql`，用 `${secret:}` 管理凭据。
3. **补齐容错**——为每个外部依赖配 P-8 三级容错，打开 DLQ 与告警。
4. **最后上可观测**——`/analytics` + SLA 配置 + Webhook 推送，形成运营闭环。

---

## 六、场景索引速查表

按"我想解决什么问题"反向查找模式：

| 我的问题                         | 用哪个模式            | 典型场景参考           |
| -------------------------------- | --------------------- | ---------------------- |
| 跨系统操作要么全成功要么回滚     | P-1 Saga              | 1.1 订单、2.4 资金归集 |
| 太慢了，想并行加速               | P-2 扇出汇聚          | 2.1 KYC、3.2 入职      |
| 需要人工审批卡点                 | P-3 人在回路          | 3.1 审批、4.1 发布     |
| 流程太长想拆分复用               | P-4 子流程            | 3.4 P2P、6.2 Agent     |
| 业务对象生命周期跨越数天         | P-5 事件驱动          | 1.1 订单、9 运单       |
| 要批量处理一堆数据               | P-6 批量迭代          | 5.1 ETL、6.3 内容生成  |
| 要按条件分诊到不同处理           | P-7 多级路由          | 2.3 风控、4.2 告警     |
| 外部 API 不稳定                  | P-8 三级容错          | 2.2 支付、12 指令下发  |
| 要给依赖设软超时                 | P-9 竞速兜底          | 2.3 反欺诈             |
| 消息会重复投递                   | P-10 幂等消费         | 5.2 CDC、8 推荐奖励    |
| **要等几天后再继续（到期即可）** | **durable `wait`** ⭐ | 1.2 超时取消、8.1 旅程 |
| **要等几天后再继续（必须准时）** | **P-11 外部唤醒** ⭐  | 定时发布、SLA 时限     |
| 要定时跑、要补跑历史             | P-12 Cron+Backfill    | 5.1 数据管道、11 计费  |
| 运行中要改参数/看进度            | P-13 Signal/Update    | 8.1 旅程、11 用量      |
| 出事故要能止血                   | P-14 熔断灰度         | 4.1 发布、11 灰度      |
| 监管要求全程可追溯               | P-15 审计归档         | 2 金融、10 医疗        |
| 想让业务自助配流程               | **P-16 纯 JSON** ⭐   | 3 企业流程、四 中台    |

---

## 最后更新

- **日期**: 2026-09-15
- **对应引擎版本**: 2.2.0 + durable wait（`src/model/Workflow.ts` `WaitNodeConfig.durable`，尚未发布/未写入 CHANGELOG，见下方说明）
- **配套文档**: [NODE_REFERENCE.md](./NODE_REFERENCE.md)（字段级参考）、[CLAUDE.md](../CLAUDE.md)（架构与约束）

> ⚠️ 本文档中标注"v2.3.0 起"的 durable wait 能力，代码与测试已在本仓库工作区完成
> （`src/engine/nodeDispatch/{controlNodes,helpers}.ts`、`src/model/{Workflow,Instance,WorkflowSchema}.ts`，
> 1355 个测试全部通过），但**尚未提交、也未分配正式版本号**——`package.json` 当前仍是 `2.1.0`，
> `CLAUDE.md` 变更日志也未记录此特性。文中"v2.3.0"是占位说法，实际发布版本号以维护者决定为准。
