/*
 * dsh-workspace-monitor — Client half (inline-style dark edition)
 *
 * 外观保留你手改的版本：THEME 调色板 + 内联样式 + 组件形状。
 * 接回去的是功能层：状态判定、工作区分组与过滤、轮播、配置、详情时间线（只读事件窗口）。
 * 这些接线都是按本机 rc.5 的 Client 契约写过的，不是猜的。
 *
 * 数据纪律（每一条屏幕上的数字都有框架来源）：
 *   会话/工作区/归档/置顶   -> 座位 standardProps 的 selector hook
 *   运行中 / 等待中         -> useSessionStatus（由 api-session/*、agent/status 驱动）
 *   轮次/步/工具/token/模型/最近一轮结局 -> Host 投影 dshWorkspaceMonitor 的 wire view
 *   时间线                  -> 该会话自己的事件窗口（只读，从不自己追加）
 * 框架不提供进度百分比，所以这里不编造：运行中显示不定动画条 + 真实计数。
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-workspace-monitor',
	factory: (require) => {
		const React = require('react');
		const h = React.createElement;
		const { useState, useEffect, useMemo, useRef } = React;

		const ENTRY = 'dsh-workspace-monitor';
		const PROJECTION_KEY = 'dshWorkspaceMonitor';

		// --- 简易主题常量（深色大屏，沿用你定义的调色板） ---
		const THEME = {
			bg: '#0d1117',         // 整体背景
			panel: '#161b22',      // 面板背景
			panel2: '#21262d',     // 次级面板
			border: '#30363d',     // 边框
			borderStrong: '#444c56',
			text: '#c9d1d9',       // 主文字
			textDim: '#8b949e',    // 次要文字
			textFaint: '#6e7681',
			accent: '#58a6ff',     // 强调色/链接
			green: '#3fb950',      // 运行中
			yellow: '#d29922',     // 等待中
			gray: '#8b949e',       // 已完成
			red: '#f85149',        // 报错
			pillBg: '#21262d',
			track: '#0d1117',
		};

		// 内联样式做不到 @keyframes，这里只放动画帧；组件卸载时随组件一起消失
		const ANIM_CSS = `
@keyframes wsmPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.72); } }
@keyframes wsmSlide { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes wsmFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes wsmSlideIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
`;

		// --- 文案 ---
		const DICTIONARIES = {
			zh: {
				'panel': '会话监控', 'title': '工作区会话监控大屏', 'subtitle': '按工作区分组的会话状态总览',
				'close': '返回默认视图', 'reload': '刷新列表', 'loading': '正在载入…', 'no-sessions': '暂无会话',
				'no-data-source': '宿主未提供会话/工作区数据源（selector hook 不可用）',
				'workspaces': '工作区', 'sessions': '会话',
				'running-count': '运行中', 'waiting-count': '等待中', 'completed-count': '已完成', 'error-count': '异常中断',
				'status-running': '运行中', 'status-waiting': '等待中', 'status-completed': '已完成', 'status-error': '异常中断',
				'model': '模型', 'no-model': '未记录模型', 'turns': '轮次', 'steps': '步数',
				'tool-calls': '工具调用', 'tool-fails': '工具失败', 'messages': '消息', 'token-usage': '累计 token',
				'context-window': '上下文窗口', 'last-activity': '最近更新', 'pinned': '置顶', 'archived': '归档',
				'ungrouped': '未归属工作区', 'workspace-unnamed': '未命名工作区', 'more-sessions': '另有 {0} 个会话未显示',
				'legend': '图例：绿=运行中 黄=等待中 灰=已完成 红=异常中断',
				'progress-note': '框架不提供任务进度百分比：运行中是不定进度条加真实计数；上下文压力是框架给出的真实百分比',
				'carousel-paused': '已暂停轮播', 'page-of': '第 {0} / {1} 页',
				'archived-shown': '含归档', 'archived-hidden': '隐藏归档',
				'context-pressure': '上下文压力', 'tool-calls-window': '本窗口工具调用 / 失败',
				'projection-keys': '投影键诊断', 'projection-keys-hint': '当前页面能看到哪些框架投影 key（用于核对数据来源，确认后这段可以删掉）',
				'projection-ready': '框架投影已返回 {0} / {1} 个会话的数据（模型、token、轮次、上下文压力）',
				'projection-missing': '框架投影未返回数据：模型、token、轮次、上下文压力不可用（状态灯与时间线不受影响）',
				'detail-workspace': '所属工作区', 'detail-updated': '最近更新', 'detail-session-id': '会话 ID',
				'detail-created': '工作区建立时间', 'status': '状态', 'open-session': '打开该会话',
				'timeline': '操作时间线', 'timeline-more': '加载更早', 'timeline-loading': '正在读取事件窗口…',
				'timeline-empty': '事件窗口为空', 'timeline-failed': '读取事件失败：', 'timeline-unavailable': '宿主未提供 sessions 服务，无法读取事件窗口',
				'timeline-hidden': '另有 {0} 条未归类事件未显示',
				'ev-user': '用户消息', 'ev-assistant': '助手回复', 'ev-assistant-attempt': '助手尝试', 'ev-other': '其他',
				'ev-tool-call': '工具调用', 'ev-tool-result': '工具结果', 'ev-tool-result-failed': '工具失败',
				'ev-turn-start': '轮开始', 'ev-turn-end': '轮结束', 'ev-compaction': '上下文压缩', 'ev-error': '错误',
			},
			en: {
				'panel': 'Sessions', 'title': 'Workspace session monitor', 'subtitle': 'Session status grouped by workspace',
				'close': 'Back to default view', 'reload': 'Refresh list', 'loading': 'Loading…', 'no-sessions': 'No sessions',
				'no-data-source': 'The host did not provide session/workspace data sources',
				'workspaces': 'workspaces', 'sessions': 'sessions',
				'running-count': 'running', 'waiting-count': 'waiting', 'completed-count': 'completed', 'error-count': 'interrupted',
				'status-running': 'running', 'status-waiting': 'waiting', 'status-completed': 'completed', 'status-error': 'interrupted',
				'model': 'model', 'no-model': 'model not recorded', 'turns': 'turns', 'steps': 'steps',
				'tool-calls': 'tool calls', 'tool-fails': 'tool failures', 'messages': 'messages', 'token-usage': 'tokens',
				'context-window': 'context window', 'last-activity': 'last update', 'pinned': 'pinned', 'archived': 'archived',
				'ungrouped': 'ungrouped', 'workspace-unnamed': 'unnamed workspace', 'more-sessions': '{0} more sessions hidden',
				'legend': 'legend: green running · yellow waiting · grey completed · red interrupted',
				'progress-note': 'the framework exposes no progress percentage; running sessions show an indeterminate bar plus real counts',
				'carousel-paused': 'carousel paused', 'page-of': 'page {0} / {1}',
				'archived-shown': 'archived shown', 'archived-hidden': 'archived hidden',
				'context-pressure': 'context pressure', 'tool-calls-window': 'tool calls in this window',
				'projection-keys': 'projection keys', 'projection-keys-hint': 'which framework projection keys this page can actually see (a data-source check; this block can be removed once confirmed)',
				'projection-ready': 'Host projection returned data for {0} / {1} sessions',
				'projection-missing': 'Host projection returned nothing: model, tokens, turns and tool counts are unavailable (status lights and the timeline still work)',
				'detail-workspace': 'workspace', 'detail-updated': 'last update', 'detail-session-id': 'session id',
				'detail-created': 'workspace created', 'status': 'status', 'open-session': 'open this session',
				'timeline': 'activity timeline', 'timeline-more': 'load older', 'timeline-loading': 'reading the event window…',
				'timeline-empty': 'the event window is empty', 'timeline-failed': 'reading events failed: ', 'timeline-unavailable': 'no sessions service, the event window is unavailable',
				'timeline-hidden': '{0} uncategorised events hidden',
				'ev-user': 'user message', 'ev-assistant': 'assistant reply', 'ev-assistant-attempt': 'assistant attempt', 'ev-other': 'other',
				'ev-tool-call': 'tool call', 'ev-tool-result': 'tool result', 'ev-tool-result-failed': 'tool failure',
				'ev-turn-start': 'turn start', 'ev-turn-end': 'turn end', 'ev-compaction': 'compaction', 'ev-error': 'error',
			},
		};
		const LANG = typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
		const t = (key) => DICTIONARIES[LANG][key] || DICTIONARIES.zh[key] || key;
		const fmt = (key, ...args) => String(t(key)).replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? ''));

		// --- 配置：字段与默认值必须和 Host 半边一致 ---
		const NUMBER_FIELDS = [
			['carouselIntervalMs', 8000, 1500, 120000],
			['carouselThreshold', 9, 1, 200],
			['carouselWorkspaceThreshold', 3, 1, 50],
			['maxSessionsPerWorkspace', 6, 1, 50],
			['statusRefreshIntervalMs', 2000, 500, 60000],
		];
		const BOOLEAN_FIELDS = [['showArchivedSessions', false], ['prioritizeRunningSessions', true]];
		function normalizeConfig(input) {
			const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
			const value = {};
			for (const [name, fallback, min, max] of NUMBER_FIELDS) {
				const raw = source[name];
				value[name] = typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
			}
			for (const [name, fallback] of BOOLEAN_FIELDS) value[name] = typeof source[name] === 'boolean' ? source[name] : fallback;
			return value;
		}

		// --- 防御式读取：只在框架真的发布事实的地方取值 ---
		const asList = (value) => {
			if (Array.isArray(value)) return value;
			if (value instanceof Set) return [...value];
			if (value && typeof value === 'object') return Object.values(value);
			return [];
		};
		const contains = (container, id) => {
			if (container instanceof Set) return container.has(id);
			if (Array.isArray(container)) return container.indexOf(id) !== -1;
			if (container && typeof container === 'object') return Object.prototype.hasOwnProperty.call(container, id);
			return false;
		};
		const str = (value, max) => (typeof value === 'string' ? (value.length > max ? value.slice(0, max) + '…' : value) : '');
		const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
		function textOf(value, max) {
			if (typeof value === 'string') return str(value, max);
			if (Array.isArray(value)) {
				const parts = [];
				for (const block of value) {
					if (typeof block === 'string') parts.push(block);
					else if (block && typeof block === 'object') {
						if (typeof block.text === 'string') parts.push(block.text);
						else if (typeof block.content === 'string') parts.push(block.content);
					}
					if (parts.join(' ').length > max) break;
				}
				return str(parts.join(' ').trim(), max);
			}
			if (value && typeof value === 'object') return textOf(value.content ?? value.text ?? value.message, max);
			return '';
		}
		function formatTime(value) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
			try { return new Date(value).toLocaleString(); } catch { return String(value); }
		}
		function formatAgo(value, now) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
			const minutes = Math.floor(Math.max(0, now - value) / 60000);
			if (minutes < 1) return '<1min';
			if (minutes < 60) return minutes + 'min';
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return hours + 'h';
			return Math.floor(hours / 24) + 'd';
		}

		// --- 框架自己的投影值：大屏的数字来源 ---
		// Host 侧 92 个会话的 checkpoint 里都存在的 key（实测枚举，见 log.md 阶段 13）。
		// 客户端拿到的可能是这些状态的 view，字段拼写不完全一致，所以每一格都多拼法防御式读；
		// 读不到就返回 null，界面显示「—」，绝不用 0 冒充已知值。
		const pick = (source, names) => {
			if (!source || typeof source !== 'object') return undefined;
			for (const name of names) {
				const value = source[name];
				if (value !== undefined && value !== null) return value;
			}
			return undefined;
		};
		function readFacts(list, id) {
			const byId = list && list.byId ? list.byId[id] : undefined;
			const snapshot = list && list.projectionsBySession ? list.projectionsBySession[id] : undefined;
			const values = (snapshot && snapshot.values) || (byId && byId.projectionValues) || {};
			const model = pick(values, ['modelSelection', 'model']);
			const modelSource = model && typeof model === 'object' ? pick(model, ['lastUsed', 'next', 'current', 'selected']) || model : model;
			const modelId = typeof modelSource === 'string' ? str(modelSource, 60) : str(pick(modelSource, ['model', 'modelId', 'name']), 60);
			const providerId = str(pick(modelSource, ['provider', 'providerId']), 40);
			const usage = pick(values, ['tokenUsage', 'tokens']);
			const usageTotals = usage && typeof usage === 'object' ? pick(usage, ['totals', 'total', 'cumulative']) || usage : null;
			const input = num(pick(usageTotals, ['uncachedInputTokens', 'inputTokens', 'input', 'promptTokens', 'prompt']));
			const output = num(pick(usageTotals, ['outputTokens', 'output', 'completionTokens', 'completion']));
			const totalTokens = num(pick(usageTotals, ['totalTokens', 'total']));
			const tokens = input || output || totalTokens ? { input, output, total: totalTokens || input + output } : null;
			const stats = pick(values, ['sessionStats', 'stats']);
			const turns = num(pick(stats, ['turns', 'lastTurn']));
			const steps = num(pick(stats, ['steps']));
			const pressure = pick(values, ['contextPressure', 'pressure']);
			const contextWindow = num(pick(pressure, ['contextWindow']) ?? pick(stats, ['contextWindow']));
			const pressureTokens = num(pick(pressure, ['pressureTokens', 'surfaceTokens', 'usedTokens']));
			const meta = pick(values, ['sessionListMetadata', 'listMetadata']);
			const monitor = values[PROJECTION_KEY] || (byId && byId.projectionValues ? byId.projectionValues[PROJECTION_KEY] : undefined);
			const hasAny = Boolean(modelId || providerId || tokens || turns || steps || pressureTokens || monitor);
			return {
				modelId, providerId, tokens, turns, steps, contextWindow, pressureTokens, monitor, hasAny,
				openStep: Boolean(stats && pick(stats, ['openStep', 'openTurn'])),
				lastPromptAt: num(pick(meta, ['lastPromptAt', 'lastActivityAt'])),
				toolCalls: monitor ? num(monitor.toolCalls) : undefined,
				toolErrors: monitor ? num(monitor.toolErrors) : undefined,
				lastTurnEndReason: monitor && typeof monitor.lastTurnEndReason === 'string' ? monitor.lastTurnEndReason : '',
			};
		}

		const FAILURE_REASONS = new Set(['error', 'aborted', 'interrupted', 'blocked', 'max-tokens']);
		const STATUS_KEYS = { running: 'status-running', waiting: 'status-waiting', completed: 'status-completed', error: 'status-error' };
		function statusOf(runtime, facts) {
			if (runtime && runtime.running === true) return 'running';
			if (runtime && runtime.pendingInteraction) return 'waiting';
			if (facts && FAILURE_REASONS.has(facts.lastTurnEndReason)) return 'error';
			if (facts && (facts.turns > 0 || (facts.monitor && facts.monitor.userMessages > 0))) return 'completed';
			if (runtime && runtime.completionUnread) return 'completed';
			return 'waiting';
		}
		const STATUS_COLOR = { running: THEME.green, waiting: THEME.yellow, completed: THEME.gray, error: THEME.red };

		// -----------------------------------------------------------------
		// 组件：状态胶囊
		// -----------------------------------------------------------------
		function StatusPill({ kind, pulse }) {
			const color = STATUS_COLOR[kind] || THEME.gray;
			return h('span', {
				style: {
					display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 9px',
					borderRadius: '999px', fontSize: '11.5px', border: `1px solid ${color}55`,
					backgroundColor: `${color}14`, color, whiteSpace: 'nowrap',
				},
			},
				h('span', {
					style: {
						width: '7px', height: '7px', borderRadius: '50%', backgroundColor: color,
						animation: pulse && kind === 'running' ? 'wsmPulse 1.5s ease-in-out infinite' : 'none',
					},
				}),
				t(STATUS_KEYS[kind]),
			);
		}

		// -----------------------------------------------------------------
		// 组件：侧边栏图标（座位给的 ownerProps 只有 { size, active }）
		// -----------------------------------------------------------------
		function PanelIcon({ size, active }) {
			const edge = typeof size === 'number' ? size : 18;
			return h('svg', {
				width: edge, height: edge, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
				strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
				opacity: active ? 1 : 0.7,
			},
				h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
				h('path', { d: 'M3 9h18' }),
				h('path', { d: 'M9 21V9' }),
			);
		}

		// -----------------------------------------------------------------
		// 组件：统计瓦片
		// -----------------------------------------------------------------
		function StatTile({ value, label, color }) {
			return h('div', {
				style: {
					minWidth: '96px', padding: '10px 12px', backgroundColor: THEME.panel,
					border: `1px solid ${THEME.border}`, borderRadius: '10px',
				},
			},
				h('div', { style: { fontSize: '20px', fontWeight: 700, lineHeight: 1.1, color: color || THEME.text, fontVariantNumeric: 'tabular-nums' } }, String(value)),
				h('div', { style: { marginTop: '4px', fontSize: '10.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: THEME.textFaint } }, label),
			);
		}

		// -----------------------------------------------------------------
		// 组件：不定进度条（框架没有百分比，这里不假装）
		// -----------------------------------------------------------------
		function ProgressBar({ kind }) {
			const inner = kind === 'running'
				? { width: '100%', height: '100%', borderRadius: 'inherit', backgroundImage: `linear-gradient(90deg, transparent, ${THEME.green}, transparent)`, backgroundSize: '200% 100%', animation: 'wsmSlide 1.7s linear infinite' }
				: kind === 'error'
					? { width: '100%', height: '100%', borderRadius: 'inherit', backgroundColor: THEME.red }
					: kind === 'waiting'
						? { width: '34%', height: '100%', borderRadius: 'inherit', backgroundColor: THEME.yellow }
						: { width: '100%', height: '100%', borderRadius: 'inherit', backgroundColor: THEME.borderStrong };
			return h('div', { style: { height: '4px', borderRadius: '999px', backgroundColor: THEME.track, overflow: 'hidden', marginTop: 'auto' } }, h('div', { style: inner }));
		}

		// -----------------------------------------------------------------
		// 组件：会话卡片
		// -----------------------------------------------------------------
		function SessionCard({ member, onOpen, now }) {
			const facts = member.facts || {};
			const title = str(member.summary.displayTitle, 120) || str(member.summary.title, 120) || member.id;
			const model = facts.modelId || facts.providerId || '';
			const fact = (label, value) => h('div', { style: { display: 'flex', gap: '6px', alignItems: 'baseline', minWidth: 0 } },
				h('span', { style: { color: THEME.textFaint, fontSize: '11px' } }, label),
				h('span', { style: { color: THEME.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value),
			);
			return h('div', {
				role: 'button', tabIndex: 0, title,
				onClick: () => onOpen(member.id),
				onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(member.id); } },
				onMouseEnter: (event) => { event.currentTarget.style.borderColor = THEME.borderStrong; event.currentTarget.style.transform = 'translateY(-2px)'; },
				onMouseLeave: (event) => { event.currentTarget.style.borderColor = THEME.border; event.currentTarget.style.transform = 'none'; },
				style: {
					backgroundColor: THEME.panel2, border: `1px solid ${THEME.border}`, borderRadius: '10px',
					padding: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px',
					color: THEME.text, transition: 'border-color .18s ease, transform .18s ease',
				},
			},
				h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } },
					h('div', { style: { fontWeight: 700, fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
					h(StatusPill, { kind: member.kind, pulse: true }),
				),
				h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '12px' } },
					fact(t('last-activity'), formatAgo(member.summary.updatedAt || facts.lastPromptAt, now)),
					fact(t('model'), model || '—'),
					(facts.turns || facts.steps) ? fact(`${t('turns')} / ${t('steps')}`, `${facts.turns} / ${facts.steps}`) : null,
					facts.tokens ? fact(t('token-usage'), String(facts.tokens.total)) : null,
					(facts.pressureTokens && facts.contextWindow) ? fact(t('context-window'), `${facts.pressureTokens} / ${facts.contextWindow}`) : null,
					facts.toolCalls !== undefined ? fact(`${t('tool-calls')} / ${t('tool-fails')}`, `${facts.toolCalls} / ${facts.toolErrors}`) : null,
					member.pinned ? fact(t('pinned'), '★') : null,
					member.archived ? fact(t('archived'), '●') : null,
				),
				h(ProgressBar, { kind: member.kind }),
			);
		}

		// -----------------------------------------------------------------
		// 组件：工作区模块
		// -----------------------------------------------------------------
		function WorkspaceGroup({ group, maxSessions, onOpen, now }) {
			const members = group.members.slice(0, maxSessions);
			const hidden = group.members.length - members.length;
			const counts = { running: 0, waiting: 0, completed: 0, error: 0 };
			for (const member of group.members) counts[member.kind] += 1;
			const chip = (label, color) => h('span', {
				style: {
					fontSize: '11px', padding: '2px 9px', borderRadius: '999px', border: `1px solid ${THEME.border}`,
					backgroundColor: THEME.panel2, color: color || THEME.textDim, fontVariantNumeric: 'tabular-nums',
				},
			}, label);
			return h('section', { style: { backgroundColor: THEME.panel, border: `1px solid ${THEME.border}`, borderRadius: '12px', padding: '14px 15px', animation: 'wsmFadeUp .3s ease-out' } },
				h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingBottom: '10px', marginBottom: '12px', borderBottom: `1px solid ${THEME.border}` } },
					h('span', { style: { fontSize: '15px', fontWeight: 700 } }, group.title),
					group.path ? h('span', { style: { fontSize: '11px', color: THEME.textFaint, fontFamily: 'ui-monospace, Consolas, monospace', maxWidth: '42ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, group.path) : null,
					h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
						chip(`${group.members.length} ${t('sessions')}`),
						counts.running ? chip(`${t('running-count')} ${counts.running}`, THEME.green) : null,
						counts.waiting ? chip(`${t('waiting-count')} ${counts.waiting}`, THEME.yellow) : null,
						counts.completed ? chip(`${t('completed-count')} ${counts.completed}`, THEME.gray) : null,
						counts.error ? chip(`${t('error-count')} ${counts.error}`, THEME.red) : null,
					),
				),
				h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' } },
					members.map((member) => h(SessionCard, { key: member.id, member, onOpen, now })),
				),
				hidden > 0 ? h('div', { style: { marginTop: '12px', fontSize: '11.5px', color: THEME.textFaint } }, fmt('more-sessions', hidden)) : null,
			);
		}

		// -----------------------------------------------------------------
		// 时间线：只认框架的事件类型，未知类型只计数不塞进界面
		// -----------------------------------------------------------------
		const TIMELINE_TYPES = new Map([
			['user/message', { label: 'ev-user', color: THEME.accent }],
			['assistant/message', { label: 'ev-assistant', color: THEME.green }],
			['assistant/attempt', { label: 'ev-assistant-attempt', color: THEME.green }],
			['developer/message', { label: 'ev-other', color: THEME.borderStrong }],
			['system/message', { label: 'ev-other', color: THEME.borderStrong }],
			['tool/call', { label: 'ev-tool-call', color: THEME.yellow }],
			['tool/result', { label: 'ev-tool-result', color: THEME.yellow }],
			['turn/start', { label: 'ev-turn-start', color: THEME.borderStrong }],
			['turn/end', { label: 'ev-turn-end', color: THEME.borderStrong }],
			['compaction/start', { label: 'ev-compaction', color: THEME.borderStrong }],
			['compaction/summary', { label: 'ev-compaction', color: THEME.borderStrong }],
			['compaction/end', { label: 'ev-compaction', color: THEME.borderStrong }],
			['compaction/prune', { label: 'ev-compaction', color: THEME.borderStrong }],
			['llm/retry', { label: 'ev-error', color: THEME.red }],
		]);

		function describeArguments(value) {
			if (typeof value === 'string') return textOf(value, 400);
			if (value && typeof value === 'object') {
				try { return textOf(JSON.stringify(value), 400); } catch { return ''; }
			}
			return '';
		}

		function describeEvent(entry) {
			const event = entry.event;
			if (!event || typeof event.type !== 'string') return null;
			const data = event.data && typeof event.data === 'object' ? event.data : {};
			const shape = TIMELINE_TYPES.get(event.type);
			const failedTurn = event.type === 'turn/end' && data.reason && FAILURE_REASONS.has(data.reason.kind);
			const failedTool = event.type === 'tool/result' && Boolean((data.message && data.message.isError) || data.error);
			const raw = failedTurn ? 'ev-error' : failedTool ? 'ev-tool-result-failed' : shape ? shape.label : 'ev-other';
			const color = failedTurn || failedTool ? THEME.red : shape ? shape.color : THEME.borderStrong;
			let text = '';
			if (event.type === 'user/message' || event.type === 'developer/message' || event.type === 'system/message') text = textOf(data.content ?? data.text, 600);
			else if (event.type === 'assistant/message') text = textOf(data.message ?? data.content ?? data.text, 600);
			else if (event.type === 'assistant/attempt') text = textOf(data.error ?? data.status, 300);
			else if (event.type === 'tool/call') text = str(data.name, 80) + (data.arguments ? ' · ' + describeArguments(data.arguments) : '');
			else if (event.type === 'tool/result') text = failedTool ? textOf((data.error && data.error.message) ?? data.message, 500) : textOf(data.message, 500);
			else if (event.type === 'turn/end') text = data.reason ? String(data.reason.kind) : '';
			else if (event.type === 'compaction/summary') text = textOf(data.summary ?? data.text, 500);
			else if (event.type === 'llm/retry') text = textOf(data.error ?? data.reason, 300);
			return { seq: num(event.seq), time: num(event.time), label: t(raw), raw, color, text, type: event.type };
		}

		// -----------------------------------------------------------------
		// 组件：详情抽屉（只读事件窗口，卸载即释放 retain）
		// -----------------------------------------------------------------
		function DetailDrawer({ ctx, member, onClose }) {
			const sessions = ctx.get ? ctx.get('sessions') : undefined;
			const [binding, setBinding] = useState(null);
			const [tick, setTick] = useState(0);
			const [error, setError] = useState('');
			const [loading, setLoading] = useState(true);
			const [loadingOlder, setLoadingOlder] = useState(false);

			useEffect(() => {
				if (!member || !sessions) {
					setLoading(false);
					return undefined;
				}
				let released = false;
				let reference;
				let unsubscribe;
				const controller = new AbortController();
				const abort = controller.signal;
				setBinding(null);
				setError('');
				setLoading(true);
				setTick(0);
				(async () => {
					try {
						reference = sessions.retain(member.id, { source: 'controllerOperation', signal: abort });
						await reference.ready;
						if (released) {
							reference.release();
							return;
						}
						setBinding(reference.binding);
						setLoading(false);
						unsubscribe = reference.binding.eventSource.subscribe(() => setTick((value) => value + 1));
					} catch (failure) {
						if (released) return;
						setError(failure && failure.message ? String(failure.message) : String(failure));
						setLoading(false);
					}
				})();
				return () => {
					released = true;
					try { controller.abort(); } catch {}
					try { if (unsubscribe) unsubscribe(); } catch {}
					try { if (reference) reference.release(); } catch {}
					setBinding(null);
				};
			}, [member && member.id, sessions]);

			if (!member) return null;
			const facts = member.facts || {};
			const snapshot = binding && typeof binding.session.getSnapshot === 'function' ? binding.session.getSnapshot() : null;
			const windowValue = binding ? binding.eventSource.getSnapshot() : null;
			const items = [];
			let hiddenCount = 0;
			let windowToolCalls = 0;
			let windowToolFails = 0;
			if (windowValue && Array.isArray(windowValue.entries)) {
				for (const entry of windowValue.entries.slice().reverse()) {
					if (!entry || entry.type !== 'event') continue;
					const described = describeEvent(entry);
					if (!described) continue;
					if (described.type === 'tool/call') windowToolCalls += 1;
					if (described.raw === 'ev-tool-result-failed') windowToolFails += 1;
					if (described.raw === 'ev-other') {
						hiddenCount += 1;
						continue;
					}
					if (items.length < 200) items.push(described);
					else hiddenCount += 1;
				}
			}
			const openSession = () => {
				const uiWorkspace = ctx.get ? ctx.get('uiWorkspace') : undefined;
				if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
					try { uiWorkspace.openSession(member.id); } catch {}
				}
				const layout = ctx.get ? ctx.get('layout') : undefined;
				if (layout && typeof layout.selectPanel === 'function') {
					try { layout.selectPanel(null); } catch {}
				}
			};
			const loadOlder = async () => {
				if (!binding || loadingOlder) return;
				setLoadingOlder(true);
				try {
					await binding.session.loadOlder();
					setTick((value) => value + 1);
				} catch (failure) {
					setError(failure && failure.message ? String(failure.message) : String(failure));
				} finally {
					setLoadingOlder(false);
				}
			};
			void tick;
			const pressurePercent = facts.pressureTokens && facts.contextWindow ? Math.min(100, Math.round((facts.pressureTokens / facts.contextWindow) * 100)) : null;
			const tile = (label, value, color) => h('div', { style: { padding: '10px 12px', backgroundColor: THEME.panel, border: `1px solid ${THEME.border}`, borderRadius: '10px' } },
				h('div', { style: { fontSize: '10.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: THEME.textFaint } }, label),
				h('div', { style: { marginTop: '4px', fontSize: '12.5px', color: color || THEME.text, overflowWrap: 'anywhere' } }, String(value)),
			);
			const button = (label, onClick, disabled) => h('button', {
				type: 'button', onClick, disabled,
				style: {
					padding: '6px 12px', fontSize: '12.5px', color: THEME.text, backgroundColor: THEME.panel2,
					border: `1px solid ${THEME.border}`, borderRadius: '7px', cursor: disabled ? 'default' : 'pointer',
					opacity: disabled ? 0.45 : 1, font: 'inherit',
				},
			}, label);

			return h('div', {
				role: 'dialog', 'aria-modal': true,
				onClick: (event) => { if (event.target === event.currentTarget) onClose(); },
				style: { position: 'absolute', inset: 0, backgroundColor: 'rgba(1,4,9,.62)', display: 'flex', justifyContent: 'flex-end', zIndex: 999 },
			},
				h('div', { style: { width: 'min(760px, 100%)', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '14px', padding: '20px', overflowY: 'auto', backgroundColor: THEME.bg, borderLeft: `1px solid ${THEME.borderStrong}`, animation: 'wsmSlideIn .24s ease-out' } },
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
						h(StatusPill, { kind: member.kind, pulse: true }),
						h('div', { style: { flex: '1 1 200px', fontSize: '17px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, str(member.summary.displayTitle, 120) || member.id),
						button(t('open-session'), openSession, false),
						button('✕', onClose, false),
					),
					h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' } },
						tile(t('detail-workspace'), member.workspaceTitle),
						tile(t('model'), facts.modelId || facts.providerId || '—'),
						tile(t('detail-updated'), formatTime(member.summary.updatedAt || facts.lastPromptAt)),
						tile(t('detail-session-id'), member.id),
						tile(t('detail-created'), member.workspaceCreated || '—'),
						tile(t('status'), t(STATUS_KEYS[member.kind]), STATUS_COLOR[member.kind]),
					),
					h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' } },
						facts.tokens ? tile(t('token-usage'), `${facts.tokens.input} / ${facts.tokens.output} (${facts.tokens.total})`) : null,
						(facts.turns || facts.steps) ? tile(`${t('turns')} / ${t('steps')}`, `${facts.turns} / ${facts.steps}`) : null,
						facts.pressureTokens ? tile(t('context-pressure'), facts.contextWindow ? `${facts.pressureTokens} / ${facts.contextWindow}` : String(facts.pressureTokens)) : null,
						facts.toolCalls !== undefined ? tile(`${t('tool-calls')} / ${t('tool-fails')}`, `${facts.toolCalls} / ${facts.toolErrors}`) : null,
						windowToolCalls ? tile(t('tool-calls-window'), `${windowToolCalls} / ${windowToolFails}`) : null,
						snapshot && snapshot.lastAgentError ? tile(t('ev-error'), str(snapshot.lastAgentError, 300), THEME.red) : null,
					),
					pressurePercent !== null ? h('div', null,
						h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: THEME.textDim } },
							h('span', null, t('context-pressure')),
							h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${pressurePercent}%`),
						),
						h('div', { style: { marginTop: '6px', height: '6px', borderRadius: '999px', backgroundColor: THEME.track, overflow: 'hidden' } },
							h('div', { style: { width: `${pressurePercent}%`, height: '100%', borderRadius: 'inherit', backgroundColor: pressurePercent >= 85 ? THEME.red : pressurePercent >= 60 ? THEME.yellow : THEME.green } }),
						),
					) : null,
					h(ProgressBar, { kind: member.kind }),
					h('div', { style: { fontSize: '11.5px', color: THEME.textFaint } }, t('progress-note')),
					h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '4px' } },
						h('div', { style: { fontSize: '12.5px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: THEME.textDim } }, t('timeline')),
						windowValue && windowValue.hasMore ? button(t('timeline-more'), loadOlder, loadingOlder) : null,
					),
					loading && !error ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.textDim, border: `1px dashed ${THEME.border}`, borderRadius: '10px' } }, t('timeline-loading')) : null,
					error ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.red, border: `1px solid ${THEME.red}`, borderRadius: '10px' } }, t('timeline-failed') + str(error, 200)) : null,
					!sessions ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.textDim, border: `1px dashed ${THEME.border}`, borderRadius: '10px' } }, t('timeline-unavailable')) : null,
					items.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, items.map((item, index) => h('div', {
						key: `${item.seq}-${index}`,
						style: { padding: '11px 13px', backgroundColor: THEME.panel, border: `1px solid ${THEME.border}`, borderLeft: `3px solid ${item.color}`, borderRadius: '10px' },
					},
						h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '11px', color: THEME.textFaint, fontVariantNumeric: 'tabular-nums' } },
							h('span', { style: { fontSize: '12px', fontWeight: 700, color: item.color } }, item.label),
							h('span', null, `#${item.seq}`),
							h('span', null, formatTime(item.time)),
							h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace' } }, item.type),
						),
						item.text ? h('div', { style: { marginTop: '6px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: THEME.text } }, item.text) : null,
					))) : null,
					!loading && !error && sessions && !items.length ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.textDim, border: `1px dashed ${THEME.border}`, borderRadius: '10px' } }, t('timeline-empty')) : null,
					hiddenCount > 0 ? h('div', { style: { marginTop: '10px', fontSize: '11.5px', color: THEME.textFaint } }, fmt('timeline-hidden', hiddenCount)) : null,
				),
			);
		}

		// -----------------------------------------------------------------
		// 主面板
		// -----------------------------------------------------------------
		function MonitorPanel(props) {
			const { ctx, config, useSessions, useSessionStatus, useWorkspaces } = props;
			const [detailId, setDetailId] = useState('');
			const [page, setPage] = useState(0);
			const [now, setNow] = useState(() => Date.now());
			const [paused, setPaused] = useState(false);
			const [showKeys, setShowKeys] = useState(false);
			const pausedRef = useRef(false);

			useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), config.statusRefreshIntervalMs);
				return () => clearInterval(timer);
			}, [config.statusRefreshIntervalMs]);

			const list = useSessions ? useSessions((state) => state) : undefined;
			const statuses = useSessionStatus ? useSessionStatus((state) => state) : undefined;
			const workspaces = useWorkspaces ? useWorkspaces((state) => state) : undefined;

			const groups = useMemo(() => {
				if (!list || !workspaces) return [];
				const byId = list.byId || {};
				const archivedIds = workspaces.archivedSessionIds || [];
				const pinnedIds = workspaces.pinnedSessionIds || [];
				// 排序规则：在运行的排前面（running > 异常中断 > 等待 > 已完成），同一档内按最近更新靠前，
				// 再同则按 id 定序，保证每次刷新顺序稳定。卡片上限（maxSessionsPerWorkspace）截的是列表
				// 前若干张，所以这条规则同时决定了「谁会被截掉」：被截掉的只会是较不紧急的那些。
				const STATUS_RANK = { running: 0, error: 1, waiting: 2, completed: 3 };
				const statusRank = (kind) => (Object.prototype.hasOwnProperty.call(STATUS_RANK, kind) ? STATUS_RANK[kind] : 9);
				const activityAt = (member) => num(member.summary.updatedAt) || num(member.facts ? member.facts.lastPromptAt : 0);
				const byStatusThenActivity = (a, b) =>
					statusRank(a.kind) - statusRank(b.kind)
					|| activityAt(b) - activityAt(a)
					|| String(a.id).localeCompare(String(b.id));
				const build = (ids) => {
					const members = ids.map((id) => {
						const runtime = statuses && typeof statuses.get === 'function' ? statuses.get(id) : undefined;
						const facts = readFacts(list, id);
						return {
							id, summary: byId[id] || { id, displayTitle: id, updatedAt: 0 }, runtime, facts,
							kind: statusOf(runtime, facts),
							pinned: contains(pinnedIds, id), archived: contains(archivedIds, id),
						};
					});
					// 关掉 prioritizeRunningSessions 就回到框架给的原始顺序（workspace.sessionIds / list.ids），
					// 上限截断也跟着回到原顺序的前 N 张。
					if (config.prioritizeRunningSessions) members.sort(byStatusThenActivity);
					return members;
				};
				const result = [];
				for (const workspace of asList(workspaces.items)) {
					const ids = asList(workspace.sessionIds).filter((id) => {
						const summary = byId[id];
						if (!summary) return false;
						if (summary.blank === true) return false;
						if (!config.showArchivedSessions && contains(archivedIds, id)) return false;
						return true;
					});
					result.push({
						key: workspace.workspaceId || workspace.path || String(result.length),
						title: str(workspace.title, 80) || t('workspace-unnamed'),
						path: str(workspace.path, 120),
						created: workspace.createdAt != null ? formatTime(typeof workspace.createdAt === 'number' ? workspace.createdAt : Date.parse(workspace.createdAt)) : '',
						members: build(ids),
					});
				}
				const owned = new Set();
				for (const group of result) for (const member of group.members) owned.add(member.id);
				const extras = asList(list.ids).filter((id) => {
					if (owned.has(id)) return false;
					const summary = byId[id];
					if (!summary || summary.blank === true) return false;
					if (!config.showArchivedSessions && contains(archivedIds, id)) return false;
					return true;
				});
				if (extras.length) result.push({ key: '__ungrouped', title: t('ungrouped'), path: '', created: '', members: build(extras) });
				// 工作区模块本身也按同一条规则排：有会话在跑的工作区排在前面（轮播一次只显示一个模块，
				// 所以这条决定了先看哪个工作区），同级按该组最新的活动时间靠前。
				const groupBest = (group) => {
					let best = 9;
					for (const member of group.members) best = Math.min(best, statusRank(member.kind));
					return best;
				};
				const groupNewest = (group) => {
					let newest = 0;
					for (const member of group.members) newest = Math.max(newest, activityAt(member));
					return newest;
				};
				const present = result.filter((group) => group.members.length > 0);
				if (!config.prioritizeRunningSessions) return present;
				return present.sort((a, b) => groupBest(a) - groupBest(b) || groupNewest(b) - groupNewest(a) || String(a.title).localeCompare(String(b.title)));
			}, [list, statuses, workspaces, config.showArchivedSessions, config.prioritizeRunningSessions]);

			const totals = useMemo(() => {
				const counts = { running: 0, waiting: 0, completed: 0, error: 0, sessions: 0, monitored: 0 };
				for (const group of groups) {
					for (const member of group.members) {
						counts[member.kind] += 1;
						counts.sessions += 1;
						if (member.facts && member.facts.hasAny) counts.monitored += 1;
					}
				}
				return counts;
			}, [groups]);

			const keyReport = useMemo(() => {
				const members = groups.flatMap((group) => group.members);
				const counts = new Map();
				let sample = '';
				for (const member of members) {
					const summary = list && list.byId ? list.byId[member.id] : undefined;
					const snapshot = list && list.projectionsBySession ? list.projectionsBySession[member.id] : undefined;
					const values = (snapshot && snapshot.values) || (summary && summary.projectionValues) || {};
					const keys = Object.keys(values);
					for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
					if (!sample && keys.length) {
						const parts = [];
						for (const key of keys) {
							let preview = '';
							try { preview = JSON.stringify(values[key]) || ''; } catch { preview = typeof values[key]; }
							parts.push(`${key}: ${preview.length > 140 ? preview.slice(0, 140) + '…' : preview}`);
						}
						sample = parts.join('\n');
					}
				}
				return { rows: [...counts.entries()].sort((a, b) => b[1] - a[1]), sample };
			}, [groups, list]);

			const carouselOn = groups.length > config.carouselWorkspaceThreshold || totals.sessions > config.carouselThreshold;
			const pageCount = carouselOn ? Math.max(1, groups.length) : 1;

			useEffect(() => {
				if (!carouselOn || pageCount < 2) return undefined;
				const timer = setInterval(() => {
					if (pausedRef.current) return;
					setPage((current) => (current + 1) % pageCount);
				}, config.carouselIntervalMs);
				return () => clearInterval(timer);
			}, [carouselOn, pageCount, config.carouselIntervalMs]);

			useEffect(() => {
				if (page >= pageCount) setPage(0);
			}, [page, pageCount]);

			useEffect(() => {
				if (!detailId) return undefined;
				const onKey = (event) => { if (event.key === 'Escape') setDetailId(''); };
				document.addEventListener('keydown', onKey);
				return () => document.removeEventListener('keydown', onKey);
			}, [detailId]);

			const allMembers = groups.flatMap((group) => group.members);
			const detailMember = detailId ? allMembers.find((member) => member.id === detailId) : undefined;
			const detailGroup = detailMember ? groups.find((group) => group.members.indexOf(detailMember) !== -1) : undefined;
			const detailWithWorkspace = detailMember ? { ...detailMember, workspaceTitle: detailGroup ? detailGroup.title : t('ungrouped'), workspaceCreated: detailGroup ? detailGroup.created : '' } : undefined;
			const shownGroups = carouselOn && groups[page] ? [groups[page]] : groups;

			const reloadList = () => {
				const sessions = ctx.get ? ctx.get('sessions') : undefined;
				if (sessions && typeof sessions.refresh === 'function') {
					const result = sessions.refresh();
					if (result && typeof result.catch === 'function') result.catch(() => undefined);
					return;
				}
				// rc.5 的列表更新是宿主推帧，没有可轮询的东西：这个按钮只重新计算相对时间标签
				setNow(Date.now());
			};
			const closePanel = () => {
				const layout = ctx.get ? ctx.get('layout') : undefined;
				if (!layout || typeof layout.selectPanel !== 'function') return;
				try { layout.selectPanel(null); } catch {}
			};
			const setPause = (value) => {
				pausedRef.current = value;
				setPaused(value);
			};
			const button = (label, onClick, wide) => h('button', {
				type: 'button', onClick,
				style: {
					padding: '7px 13px', fontSize: '12.5px', color: THEME.text, backgroundColor: THEME.panel2,
					border: `1px solid ${THEME.border}`, borderRadius: '7px', cursor: 'pointer', font: 'inherit',
					minWidth: wide ? undefined : '32px',
				},
			}, label);

			return h('div', { style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', gap: '16px', padding: '20px', overflow: 'hidden', backgroundColor: THEME.bg, color: THEME.text, fontSize: '14px' } },
				h('style', null, ANIM_CSS),

				// 顶部模块：标题 + 统计瓦片 + 操作
				h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 } },
					h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' } },
						h('div', null,
							h('div', { style: { fontSize: '21px', fontWeight: 700, letterSpacing: '.02em' } }, t('title')),
							h('div', { style: { marginTop: '4px', fontSize: '12.5px', color: THEME.textDim } }, `${t('subtitle')} · ${config.showArchivedSessions ? t('archived-shown') : t('archived-hidden')}`),
						),
						h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
							button(t('reload'), reloadList, true),
							button(t('close'), closePanel, true),
						),
					),
					h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: '10px' } },
						h(StatTile, { value: groups.length, label: t('workspaces') }),
						h(StatTile, { value: totals.sessions, label: t('sessions') }),
						h(StatTile, { value: totals.running, label: t('running-count'), color: THEME.green }),
						h(StatTile, { value: totals.waiting, label: t('waiting-count'), color: THEME.yellow }),
						h(StatTile, { value: totals.completed, label: t('completed-count'), color: THEME.gray }),
						h(StatTile, { value: totals.error, label: t('error-count'), color: THEME.red }),
					),
					h('div', { style: { fontSize: '11.5px', color: totals.monitored === 0 && totals.sessions > 0 ? THEME.yellow : THEME.textFaint } },
						totals.monitored === 0 && totals.sessions > 0 ? t('projection-missing') : fmt('projection-ready', totals.monitored, totals.sessions),
					),
					showKeys ? h('div', { style: { padding: '10px 12px', backgroundColor: THEME.panel, border: `1px dashed ${THEME.border}`, borderRadius: '10px', fontSize: '11.5px', color: THEME.textDim } },
						h('div', { style: { fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
							keyReport.rows.length ? keyReport.rows.map((entry) => `${entry[0]} ×${entry[1]}`).join('   ') : '(no projection key visible)',
						),
						keyReport.sample ? h('pre', { style: { margin: '8px 0 0', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: THEME.textFaint, fontFamily: 'ui-monospace, Consolas, monospace' } }, keyReport.sample) : null,
						h('div', { style: { marginTop: '6px', color: THEME.textFaint } }, t('projection-keys-hint')),
					) : null,
				),

				!useSessions || !useWorkspaces ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.yellow, border: `1px solid ${THEME.yellow}`, borderRadius: '10px' } }, t('no-data-source')) : null,
				list && list.phase && list.phase !== 'ready' ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.textDim, border: `1px dashed ${THEME.border}`, borderRadius: '10px' } }, t('loading')) : null,
				groups.length === 0 && (!list || !list.phase || list.phase === 'ready') ? h('div', { style: { padding: '12px', fontSize: '12.5px', color: THEME.textDim, border: `1px dashed ${THEME.border}`, borderRadius: '10px' } }, t('no-sessions')) : null,

				// 主体展示区（轮播时一次只显示一个工作区模块）
				h('div', {
					onMouseEnter: () => setPause(true),
					onMouseLeave: () => setPause(false),
					style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', padding: '2px' },
				},
					h('div', { key: carouselOn ? `page-${page}` : 'all', style: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1600px', margin: '0 auto', width: '100%' } },
						shownGroups.map((group) => h(WorkspaceGroup, { key: group.key, group, maxSessions: config.maxSessionsPerWorkspace, onOpen: setDetailId, now })),
					),
				),

				// 底部控制条模块：轮播控件 + 图例
				h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', paddingTop: '14px', borderTop: `1px solid ${THEME.border}`, flexShrink: 0 } },
					carouselOn && pageCount > 1 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
						button('‹', () => setPage((current) => (current - 1 + pageCount) % pageCount)),
						h('div', { style: { display: 'flex', gap: '7px' } }, groups.map((group, index) => h('button', {
							key: group.key, type: 'button', title: group.title, 'aria-label': group.title, onClick: () => setPage(index),
							style: {
								width: '10px', height: '10px', padding: 0, borderRadius: '50%', cursor: 'pointer',
								border: `1px solid ${index === page ? THEME.accent : THEME.borderStrong}`,
								backgroundColor: index === page ? THEME.accent : 'transparent',
							},
						}))),
						button('›', () => setPage((current) => (current + 1) % pageCount)),
						h('span', { style: { fontSize: '12px', color: THEME.textDim, fontVariantNumeric: 'tabular-nums' } }, fmt('page-of', page + 1, pageCount)),
						paused ? h('span', { style: { fontSize: '12px', color: THEME.yellow } }, t('carousel-paused')) : null,
					) : h('div'),
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', color: THEME.textFaint, flexWrap: 'wrap' } },
						h('span', null, `${t('legend')} · ${t('progress-note')}`),
						button(t('projection-keys'), () => setShowKeys((value) => !value), true),
					),
				),

				detailWithWorkspace ? h(DetailDrawer, { ctx, member: detailWithWorkspace, onClose: () => setDetailId('') }) : null,
			);
		}

		// -----------------------------------------------------------------
		// Activation
		// -----------------------------------------------------------------
		function readLiveConfig(ctx, fallback) {
			const forms = ctx.get ? ctx.get('configForms') : undefined;
			if (!forms || typeof forms.get !== 'function') return fallback;
			let raw;
			try { raw = forms.get(ENTRY); } catch { return fallback; }
			return normalizeConfig(raw);
		}

		return {
			inject: ['slots'],
			apply(ctx, rawConfig) {
				const config = readLiveConfig(ctx, normalizeConfig(rawConfig));
				ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ENTRY },
					(props) => h(MonitorPanel, { ctx, config, ...props })));
				ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
					name: 'sidebar.panellist', id: ENTRY, order: 20, label: () => t('panel'),
				}, PanelIcon));
			},
		};
	},
});
