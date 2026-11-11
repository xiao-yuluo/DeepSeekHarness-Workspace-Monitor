# dsh-workspace-monitor · 工作区会话监控大屏

版本 1.4.0 ｜ 平台 DeepSeek Harness 0.2.1-rc.5 ｜ 形态 Cordis bundle（Host 半区 + Web Client 半区）

一句话：侧栏点一下，主区变成一块监控大屏 —— 按工作区分组列出所有会话的实时状态、累计用量与最近活动；会话多了就整工作区分页轮播；点任意卡片看这个会话的操作时间线。

本文是权威说明。英文版见 [README.en.md](README.en.md)。开发过程与逐项取证记录在作者的私有开发日志里，不随本仓库发布。

---

## 1. 先说清楚：现在能跑什么，还不能跑什么

| 部分 | 状态 | 依据 |
|---|---|---|
| Client 半区（全部界面与数据读取） | **已实机装载** | 侧栏座位 `{id:"dsh-workspace-monitor", order:20, active:true}`、主区 keyed 座位 `{key:"dsh-workspace-monitor", active:true}` 都能从 `cordis_inspect_query` 读到 |
| 卡片 / 轮播 / 详情时间线的逻辑 | **离线冒烟通过** | `node tmp/smoke.js` → ALL CHECKS PASSED（断言清单见 §9 与 log.md 阶段 13） |
| Host 半区的投影 `dshWorkspaceMonitor` | **本机当前没有生效** | `DSH 数据目录下的 storages\session_projcache\sessions\` 共 92 份 checkpoint，27 个框架 key 全在，`dshWorkspaceMonitor` 命中 0；连 `val` 为 null 的 key 都有行，说明"注册了就必须有行" |
| 大屏是否还有数据 | **有，且不依赖上面那条** | v1.1.0 起卡片与抽屉改读框架自己的投影 key（§4） |
| 视觉与"客户端到底收到哪些 key" | **待你在浏览器确认** | 页脚「投影键诊断」按钮列出本页可见的投影 key |

---

## 2. 包内文件

| 文件 | 作用 |
|---|---|
| `client.js` | Client 半区：全部 UI、座位注册、状态判定、轮播、只读事件窗口。`window.__ModuleLoader__.load({id, factory})` 形态，只 `require('react')`，无 JSX |
| `index.js` | Host 半区：把会话日志折叠成投影 `dshWorkspaceMonitor`（可选补充，见 §10 第 1 条） |
| `cordis.patch.yml` | bundle patch：`insert` 一个入口，并给出六个配置项的默认值 |
| `package.json` | `dsh.bundle.patch` 指向 patch；`dsh.client` 声明 Client 半区注入的包；`@deepseek-ai/*` 全部是 optional peerDependencies |
| `icon.svg` | 侧栏图标（组件里另有一份等价的内联 SVG） |
| `locale/zh.json`、`locale/en.json` | 预留文案位；当前界面文字走 `client.js` 内置字典（按 `navigator.language` 选中/英），尚未接 `ctx.locale` |
| `tests/smoke.js` | 离线冒烟测试（不属于运行时，插件本身不加载它） |
| `README.md` / `README.en.md` | 本说明 |

---

## 3. 界面结构（四个区域）

1. **顶栏**：标题 + 归档显示状态 + 「刷新列表」「返回默认视图」+ 六个统计瓦片（工作区数、会话数、运行中、等待中、已完成、异常中断）+ 一行数据来源健康度提示。
2. **展示区**：每个工作区一个模块（标题 / 路径 / 会话数 / 各状态计数），内部卡片栅格。卡片含标题、状态胶囊、最近更新、模型、轮次/步、累计 token、上下文压力、置顶/归档标记、进度条。
3. **底部控制条**：轮播开时出现「‹ 圆点 › 第 X / Y 页 已暂停轮播」；右侧图例 + 「投影键诊断」开关。
4. **详情抽屉**：状态胶囊 + 标题 + 「打开该会话」+ ✕；两组事实瓦片（工作区/模型/更新时间/会话 ID/工作区建立时间/状态，token/轮次·步/上下文压力/工具计数/窗口内错误）；上下文压力百分比条；进度条；倒序时间线。`Esc` 或点遮罩关闭。

配色是 `client.js` 里的 `THEME` 常量（GitHub-dark 近似），全部内联样式；只有 4 帧 `@keyframes`（脉冲、滑动、上浮、滑入）通过组件内的 `<style>` 注入，组件卸载即移除。

---

## 4. 数据来源（只显示拿得到的数字）

| 屏幕上的东西 | 来源 | 实测形状（本机 checkpoint） | 取不到时 |
|---|---|---|---|
| 工作区分组、会话清单、归档、置顶 | 座位 standardProps 的 `useWorkspaces()` | `{items:[{workspaceId,path,title,sessionIds,createdAt,updatedAt}], archivedSessionIds, pinnedSessionIds}` | 显示"宿主未提供数据源" |
| 运行中 / 等待中 | `useSessionStatus()`（由 `api-session/*`、`agent/status` 驱动） | Map：`{running, pendingInteraction, completionUnread}` | 退化到投影兜底 |
| 模型 | 投影 `modelSelection` | `{lastUsed:{provider:"strata",model:"qwen3.8-flash-…"}, pending:null}`（兼容旧版 `{next:{model}}`） | 显示 `—` |
| 累计 token | 投影 `tokenUsage` | `{totals:{uncachedInputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}, last:{turn,step,buckets}}` | 该格不出现 |
| 轮次 / 步数 | 投影 `sessionStats` | `{turns, steps, lastTurn, openStep, pendingCalls}` | 该格不出现 |
| 上下文压力（**唯一的真实百分比**） | 投影 `contextPressure` | `{surfaceTokens, contextWindow, pressureTokens}` | 该格不出现 |
| 最近 prompt 时间 | 投影 `sessionListMetadata` | `{blank:false, lastPromptAt}`；退路 `SessionSummary.updatedAt` | 显示 `—` |
| 操作时间线 | `ctx.get('sessions').retain(id, {source:'controllerOperation', signal})` → `binding.eventSource.getSnapshot().entries` → `session.loadOlder()` | 事件信封 `{type, seq, time, data}`，正文一律从 `data` 取 | 明确写"宿主未提供 sessions 服务" |
| 工具调用 / 失败（卡片上） | 仅当 Host 投影 `dshWorkspaceMonitor` 有值时才显示 | — | 该格不出现 |
| 工具调用 / 失败（抽屉「本窗口」） | 由已读到的时间线窗口统计 | `tool/call` 计数；`tool/result` 的 `message.isError` 或 `error` 判失败 | 计数为 0 时该格不出现 |

取不到就显示 `—` 或整格不出现。插件里没有任何自造统计，也不会用 0 冒充未知。

---

## 5. 状态灯判定（顺序即优先级）

| 优先 | 条件 | 灯 |
|---|---|---|
| 1 | `runtime.running === true` | 🟢 运行中 |
| 2 | `runtime.pendingInteraction` 存在 | 🟡 等待中 |
| 3 | 投影 `lastTurnEndReason ∈ {error, aborted, interrupted, blocked, max-tokens}` | 🔴 异常中断 |
| 4 | `turns > 0` 或用户消息数 > 0（或 `completionUnread`） | ⚪ 已完成 |
| 5 | 以上都不成立 | 🟡 等待中 |

两点必须知道：框架没有一个独立的"空闲"信号，第 5 条是兜底；第 3 条依赖 `turn/end` 的 `reason.kind`，目前只有 Host 投影生效时才可能亮（框架自己的投影里没有这个字段）。

### 排序（1.3.0 起，1.4.0 起可关）
- 整条排序由 `prioritizeRunningSessions` 控制，默认开。关掉之后卡片和工作区模块都回到框架给的原始顺序（`workspace.sessionIds` / 会话列表顺序），`maxSessionsPerWorkspace` 也截原顺序的前 N 张。

- 组内卡片：**🟢 运行中 → 🔴 异常中断 → 🟡 等待中 → ⚪ 已完成**。同一档内按最近更新靠前（`updatedAt`，取不到时用 `sessionListMetadata.lastPromptAt`），再同按会话 id 定序，保证每次刷新顺序稳定、不会跳。
- 工作区模块本身按同一档位排：组里有会话在跑就排到前面。轮播一次只显示一个模块，所以这条决定第一页看到的是哪个工作区。
- `maxSessionsPerWorkspace` 截的是排完序之后列表的前 N 张，被截掉的只会是更不紧急的那些。上限以内看不到已完成的会话是这个规则的正常结果，组标题上的计数胶囊仍然统计全组，模块末尾的「还有 N 张未显示」说明被截掉多少。
- 置顶（★）不参与排序，只是卡片上的一个标记。

---

## 6. 进度条的真实语义（不假装百分比）

- 🟢 运行中：**不定进度条**（循环动画）+ 卡片上的真实计数。框架不提供完成度，这里不编造。
- 🟡 等待中：静止短条（黄色）。
- ⚪ 已完成：满条（灰色）。
- 🔴 异常中断：满条（红色）。

短条/满条是**状态编码**，不是完成度。整个大屏里唯一的真实百分比是抽屉里的上下文压力（`pressureTokens / contextWindow`，绿 <60%、黄 60–84%、红 ≥85%）。

---

## 7. 配置项

写在 `cordis.patch.yml` 的 `insert[0].config` 里：

| 键 | 默认 | 允许范围 | 作用 |
|---|---|---|---|
| `carouselIntervalMs` | 8000 | 1500–120000 | 轮播换页间隔 |
| `carouselThreshold` | 9 | 1–200 | 会话总数超过它就轮播 |
| `carouselWorkspaceThreshold` | 3 | 1–50 | 工作区数超过它就轮播 |
| `maxSessionsPerWorkspace` | 6 | 1–50 | 单个工作区最多显示几张卡 |
| `statusRefreshIntervalMs` | 2000 | 500–60000 | 相对时间标签的重算节拍 |
| `showArchivedSessions` | false | 布尔 | 是否列出归档会话 |
| `prioritizeRunningSessions` | true | 布尔 | 是否按紧急度排序；关掉即回到框架原始顺序 |

- Host 与 Client 各自有一份同字段表的 `normalizeConfig`：非法值退回默认，界面上不会出现半套配置。
- 1.2.0 起 Host 侧 `Config` 是 Host 自带的 Schemastery 定义的 schema（`import('@deepseek-ai/schemastery')`，由 Loader 解析；解析不到会自动回落到零依赖的 `~standard` 校验器，插件不会因此挂掉）。实测 `Config.listConfigs entry=include:dsh-workspace-monitor` 的 `status` 已从 `unsupported` 变成 **`schema`**：六个字段带类型、默认值和中英说明，`acceptsMissing: true`。所以插件页「已安装」这一行有配置入口，在里面改值会写进 profile 的 `cordis.patch.yml`，Loader 重启该插件让新值生效（不需要重启应用）。
- 超范围的数字不会让插件启动失败：`clampConfig` 把它拉回边界（`carouselIntervalMs: 999999` 实际按 120000 用）；`normalizeConfig` 保留给 patch 校验和冒烟测试。
- 轮播时一次只渲染一个工作区模块；鼠标进入展示区即暂停，离开恢复；点圆点或 ‹ › 手动换页。

---

## 8. 安装 / 更新 / 卸载

**权威位置**：本仓库根目录。以后改代码就在这个仓库里改并提交到这里。

安装（两选一）：

1. Plugin Manager → 安装 bundle → `link:<你把本仓库 checkout 到本机的绝对路径>`
2. 命令行等价做法：`pnpm -C <你的 DSH profile 目录，例如 ~/.dsh/profiles/desktop> add "<本仓库 checkout 目录>"`

安装结果是把包 **symlink** 进 profile 的 `node_modules`，并在 profile 的 `package.json` 里登记 `link:` 与 `dsh.profile.bundles` 条目。

生效规则（重要）：

- 改 **`client.js`** → 浏览器 **Ctrl+F5** 强刷即可（本机没有跑 `pnpm run dev:web`，所以不会热更新）。
- 改 **`index.js` / `package.json` / `cordis.patch.yml`** → 必须**重启 DSH 应用**（Host 半区只在启动时加载），重启后 GUI 端口会变。
- 卸载：Plugin Manager → `remove_bundle`。

不要手改 profile 的 `package.json` 或 profile 的 `cordis.patch.yml`。

---

## 9. 验证方法

1. **离线冒烟**（不需要应用）：在本包目录执行 `node tests/smoke.js`。它用假 React + 框架形状的假数据（8 会话 / 2 工作区 / 1 归档 / 1 空白 / 1 未归属）跑通整条链路，并断言：模块自注册、两个座位都注册、卡片渲染数等于 `maxSessionsPerWorkspace`、轮播圆点出现、卡片点击能开抽屉、时间线出现且失败工具标红、"加载更早"在 `hasMore` 时出现、抽屉卸载后 retain 释放且订阅与 document 监听归零。当前结果：exit 0，ALL CHECKS PASSED。
2. **实机**：侧栏点图标 → 大屏；点卡片 → 抽屉（`Esc`/✕/点遮罩关闭）；点页脚「投影键诊断」→ 看本页实际收到哪些投影 key。
3. **座位取证**：`cordis_inspect_query` 的 Client `Slots listSubTree`，`root` 分别取 `main` 与 `sidebar.panellist`，两者都应有 `dsh-workspace-monitor` 占位。

---

## 10. 已知边界（逐条，不含糊）

1. **Host 投影 `dshWorkspaceMonitor` 未注册**。证据：92 份 checkpoint 的 `record.rows` 都是同一组 27 个框架 key，我们的 key 零命中。导出形状已对照官方源码与本机可用的第三方包核实（`dshmarket\lib\index.js:205` 同样是 `export function apply(ctx, config)` + `ctx.inject([...], cb)`），所以问题不在写法，候选是 `sessionProjections` 对这个 bundle fiber 的可见性或时序。坐实办法：给 `index.js` 加一次性 `activation.log`（apply / inject 回调 / registered / 首个 onChanged 四行），重启一次读回；或改用静态 `export const inject = ['sessionProjections']`（`dsh-session-clean` 的写法）。
2. **Plugin Manager 里没有配置编辑界面**（§7），默认值来自 bundle patch。
3. 会话列表数据里**没有会话 `createdAt`**，所以抽屉里那一格写的是"工作区建立时间"（`workspace.createdAt`），不是会话创建时间。
4. 时间线受事件窗口大小限制，靠"加载更早"分页推进；渲染上限 200 条，其余计入"另有 N 条未归类事件未显示"。
5. 未知事件类型不猜测语义，只计数。目前映射 14 类事件。
6. 界面文案走包内字典（中/英按浏览器语言），`ctx.locale` 尚未接入，`locale/*.json` 是预留。
7. 两条可访问性规则当前缺失：卡片键盘焦点轮廓、按钮禁用态变暗。
8. 视觉验收（深色模块观感、轮播手感、抽屉宽度表现）只能由使用者在浏览器里判定，我这边只能给逻辑证据。

---

## 11. 版本与回滚

- **1.4.0（2026-11-11）**：排序做成可配置项 `prioritizeRunningSessions`（默认 true，在插件页的配置表单里可直接关），关掉即回到框架原始顺序；冒烟测试同时断言开关两种状态。
- **1.3.0（2026-11-11）**：卡片与工作区模块改为按紧急度排序（运行中 → 异常中断 → 等待 → 已完成，同级按最近更新），轮播第一页固定是有会话在跑的工作区；`maxSessionsPerWorkspace` 的截断因此只截掉更不紧急的会话。冒烟测试新增排序断言。
- **1.2.0（2026-11-06）**：Host 侧 `Config` 换成 Schemastery schema，插件页「已安装」出现配置入口（`status: schema`）；新增 `clampConfig`，超范围值拉回边界而不是让插件起不来。
- **1.1.0（2026-11-06）**：功能接线复原（状态判定 / 分组与过滤 / 轮播 / 配置 / 只读事件窗口时间线），数据源改接框架投影，新增上下文压力百分比条与「投影键诊断」。
- **1.0.0（2026-11-05）**：首版，深色模块化布局。

版本历史见上面几条与本仓库的 `git log --oneline`；每个版本发布前都跑一遍 `node tests/smoke.js`。

---

## 12. 数据与隐私

大屏只读：会话元数据、状态 Map、框架投影值、以及被点击会话自己的事件窗口。不写入任何会话数据，不新增定时器轮询日志，不向本机之外发送任何内容。卸载插件即卸载全部座位与注册，不留残留。
