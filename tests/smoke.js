/*
 * Smoke test for the Client half. It is NOT part of the plugin: it exists only to prove
 * the module self-registers, apply() registers both seats, and the panel / card / drawer
 * code actually runs against framework-shaped data without throwing.
 * Run from this package directory:  node tests/smoke.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const captured = {};
global.window = { __ModuleLoader__: { load: (module) => { captured.module = module; } } };
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true }); } catch { /* Node already defines navigator; the plugin falls back to English text */ }
const listeners = [];
global.document = {
	addEventListener: (name, handler) => listeners.push([name, handler]),
	removeEventListener: (name, handler) => {
		const index = listeners.findIndex((entry) => entry[0] === name && entry[1] === handler);
		if (index !== -1) listeners.splice(index, 1);
	},
};

// 本包的 package.json 写了 "type": "module"，所以不用 require()：把 client.js 源码当脚本执行。
// client.js 自己只调 window.__ModuleLoader__.load(...)，react 由下面 factory 收到的 require 提供。
new Function(fs.readFileSync(path.join(dirname, '..', 'client.js'), 'utf8'))();
if (!captured.module || typeof captured.module.factory !== 'function') {
	console.error('FAIL: the module did not self-register through window.__ModuleLoader__.load');
	process.exit(1);
}
console.log('OK: id =', captured.module.id, 'inject =', JSON.stringify(captured.module.inject));

// ---------------------------------------------------------------- fake React
const store = new Map();
const cleanups = [];
let scope = 0;
let cursor = 0;
const React = {
	createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(4).filter((child) => child !== null && child !== undefined && child !== false) }),
	useState: (initial) => {
		const key = `${scope}:${cursor++}`;
		if (!store.has(key)) store.set(key, { value: typeof initial === 'function' ? initial() : initial });
		const box = store.get(key);
		return [box.value, (next) => { box.value = typeof next === 'function' ? next(box.value) : next; }];
	},
	useEffect: (fn) => { cleanups.push(fn()); },
	useMemo: (fn) => fn(),
	useRef: (initial) => {
		const key = `ref:${scope}:${cursor++}`;
		if (!store.has(key)) store.set(key, { current: initial });
		return store.get(key);
	},
};

// build a fully invoked tree so both hooks and children get exercised
function build(element) {
	if (element === null || element === undefined) return null;
	if (typeof element === 'string' || typeof element === 'number') return { type: 'text', value: String(element), children: [] };
	if (typeof element !== 'object') return { type: 'text', value: String(element), children: [] };
	if (typeof element.type === 'function') {
		const parent = scope;
		scope = parent + 1;
		cursor = 0;
		const nested = build(element.type(element.props));
		scope = parent;
		return { type: 'component', props: element.props, children: [nested] };
	}
	const children = (element.children || []).map(build);
	return { type: element.type, props: element.props, children };
}
function render(component, props) { scope = 0; cursor = 0; return build(React.createElement(component, props)); }
function walk(node, visit) {
	if (!node) return;
	visit(node);
	for (const child of node.children || []) walk(child, visit);
}
function count(node) { let total = 0; walk(node, () => { total += 1; }); return total; }

// ---------------------------------------------------------------- fake framework data
const PROJECT = 'dshWorkspaceMonitor';
const now = Date.now();
const monitor = (turns, steps, calls, fails, user, assistant, reason, model) => ({
	turns, steps, toolCalls: calls, toolResults: calls, toolErrors: fails, userMessages: user, assistantMessages: assistant,
	tokens: { input: 1200 * turns, output: 400 * turns }, lastTurnEndReason: reason, provider: 'strata', model, contextWindow: 262144,
});
const byId = {};
const projectionsBySession = {};
const add = (id, title, projection, blank) => {
	byId[id] = { id, title, displayTitle: title, cwd: 'W:/demo-workspace', updatedAt: now - 60000, blank: blank === true };
	const values = {};
	if (projection) {
		values[PROJECT] = projection;
		values.modelSelection = { lastUsed: { provider: 'strata', model: 'qwen3.8-flash' }, pending: null };
		values.tokenUsage = { totals: { uncachedInputTokens: 1200 * projection.turns, outputTokens: 400 * projection.turns }, last: { turn: projection.turns } };
		values.sessionStats = { turns: projection.turns, steps: projection.steps, lastTurn: projection.turns, openStep: id === 's-run' ? { turn: projection.turns, step: projection.steps + 1 } : null };
		values.contextPressure = { surfaceTokens: 9000 + projection.turns * 1000, contextWindow: 262144, pressureTokens: 9000 + projection.turns * 1000 };
		values.sessionListMetadata = { blank: false, lastPromptAt: now - 30000 };
	}
	if (Object.keys(values).length) projectionsBySession[id] = { state: 'ready', values };
};
add('s-run', '运行中的会话', monitor(4, 9, 12, 0, 4, 6, 'end-turn', 'qwen3.8-flash'));
add('s-wait', '等待回应的会话', monitor(1, 1, 1, 0, 1, 1, 'end-turn', 'qwen3.8-flash'));
add('s-done', '已完成的会话', monitor(3, 5, 6, 1, 2, 4, 'end-turn', 'qwen3.8-flash'));
add('s-err', '异常中断的会话', monitor(2, 3, 4, 2, 1, 2, 'error', 'qwen3.8-flash'));
add('s-arch', '归档会话', monitor(1, 1, 0, 0, 1, 1, 'end-turn', 'qwen3.8-flash'));
add('s-blank', '空白会话', undefined, true);
add('s-learn', '学习工作区会话', undefined);
add('s-orphan', '未归属会话', undefined);

const statusMap = new Map([
	['s-run', { running: true, pendingInteraction: undefined, completionUnread: false }],
	['s-wait', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
]);
const list = { ids: Object.keys(byId), byId, phase: 'ready', projectionsBySession };
const workspaces = {
	items: [
		{ workspaceId: 'w1', path: 'W:/demo-workspace', title: 'demo-workspace', sessionIds: ['s-run', 's-wait', 's-done', 's-err', 's-arch', 's-blank', 's-learn'], createdAt: now - 86400000, updatedAt: now },
		{ workspaceId: 'w2', path: 'W:/demo-workspace-2', title: 'demo-workspace-2', sessionIds: [], createdAt: now - 86400000, updatedAt: now },
	],
	archivedSessionIds: ['s-arch'],
	pinnedSessionIds: ['s-run'],
	state: 'ready', phase: 'ready', error: undefined,
};
const hooks = {
	useSessions: (selector) => selector(list),
	useSessionStatus: (selector) => selector(statusMap),
	useWorkspaces: (selector) => selector(workspaces),
};

const windowValue = {
	entries: [
		{ type: 'event', event: { type: 'user/message', seq: 8, time: now - 90000, data: { content: [{ text: '把功能接回去' }] } } },
		{ type: 'event', event: { type: 'assistant/message', seq: 9, time: now - 80000, data: { message: '开始接线' } } },
		{ type: 'event', event: { type: 'tool/call', seq: 10, time: now - 70000, data: { name: 'edit', arguments: { file_path: 'client.js' } } } },
		{ type: 'event', event: { type: 'tool/result', seq: 11, time: now - 60000, data: { message: { isError: true }, error: { message: 'old_string 不唯一' } } } },
		{ type: 'event', event: { type: 'mystery/type', seq: 12, time: now - 50000, data: {} } },
		{ type: 'event', event: { type: 'turn/end', seq: 13, time: now - 40000, data: { reason: { kind: 'error' } } } },
		{ type: 'transient', transient: { kind: 'thinking' } },
	],
	hasMore: true, revision: 1, change: 'initial',
};
const releases = [];
let subscriptions = 0;
const sessionsService = {
	refresh: () => Promise.resolve(),
	retain: (id, options) => {
		if (!options || options.source !== 'controllerOperation') throw new Error('unexpected retain source');
		return {
			ready: Promise.resolve(),
			binding: {
				eventSource: { getSnapshot: () => windowValue, subscribe: () => { subscriptions += 1; return () => { subscriptions -= 1; }; } },
				session: { getSnapshot: () => ({ lastAgentError: 'tool/result failed' }), loadOlder: async () => { windowValue.hasMore = false; } },
			},
			release: () => releases.push(id),
		};
	},
};
const actions = [];
const calls = [];
const seats = [];
const ctx = {
	get: (key) => (key === 'sessions' ? sessionsService
		: key === 'layout' ? { selectPanel: (value) => actions.push('selectPanel:' + String(value)) }
			: key === 'uiWorkspace' ? { openSession: (id) => actions.push('openSession:' + id) } : undefined),
	slots: {
		inject: (name, fn) => { calls.push('inject:' + name); fn(); },
		register: (registration, component) => { seats.push({ name: registration.name, key: registration.key || registration.id, component }); },
	},
};

const api = captured.module.factory((name) => {
	if (name !== 'react') throw new Error('unexpected require: ' + name);
	return React;
});
api.apply(ctx, { carouselIntervalMs: 8000, carouselThreshold: 9, carouselWorkspaceThreshold: 1, maxSessionsPerWorkspace: 3, showArchivedSessions: false, statusRefreshIntervalMs: 60000 });

console.log('OK: apply calls =', JSON.stringify(calls));
console.log('OK: seats =', JSON.stringify(seats.map((seat) => `${seat.name}/${seat.key}`)));
if (seats.length !== 2) { console.error('FAIL: both seats must be registered'); process.exit(1); }

const main = seats.find((seat) => seat.name === 'main').component;
const sidebar = seats.find((seat) => seat.name === 'sidebar.panellist').component;
console.log('OK: sidebar icon =', JSON.stringify(sidebar({ size: 18, active: true })).slice(0, 80));

const tree = render(main, { ...hooks, ctx });
const cards = [];
const groups = [];
const dots = [];
walk(tree, (node) => {
	if (node.props && node.props.role === 'button' && typeof node.props.onKeyDown === 'function') cards.push(node);
	if (node.type === 'section') groups.push(node);
	if (node.props && node.props.type === 'button' && node.props['aria-label']) dots.push(node);
});
console.log('OK: rendered elements =', count(tree), ' workspace modules =', groups.length, ' cards =', cards.length, ' carousel dots =', dots.length);
if (!cards.length || !groups.length) { console.error('FAIL: no cards or workspace modules rendered'); process.exit(1); }
if (dots.length < 1) { console.error('FAIL: carousel is on (7 sessions > threshold path) but no dots rendered'); process.exit(1); }

const pills = new Set();
walk(tree, (node) => { if (node.type === 'component') { /* component nodes carry no props label here */ } });
cards[0].props.onClick();

(async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
	render(main, { ...hooks, ctx });
	await new Promise((resolve) => setTimeout(resolve, 30));
	const drawerTree = render(main, { ...hooks, ctx });
	const texts = [];
	const borders = [];
	walk(drawerTree, (node) => {
		if (node.type === 'text' && node.value) texts.push(node.value);
		if (node.props && node.props.borderLeft) borders.push(node.props.borderLeft);
	});
	console.log('DEBUG drawer texts =', JSON.stringify(texts.slice(-30)));
	console.log('DEBUG borderLeft values =', JSON.stringify(borders.slice(0, 8)));
	let drawerFound = false;
	let timelineRows = 0;
	let hasLoadOlder = false;
	walk(drawerTree, (node) => {
		if (node.props && node.props.role === 'dialog') drawerFound = true;
		if (node.props && typeof node.props.onClick === 'function' && node.type === 'button') { /* button */ }
	});
	walk(drawerTree, (node) => {
		if (node.props && node.props.style && typeof node.props.style.borderLeft === 'string' && node.props.style.borderLeft.indexOf('3px solid') !== -1) timelineRows += 1;
		if (node.type === 'text' && node.value === '加载更早') hasLoadOlder = true;
	});
	console.log('OK: drawer rendered =', drawerFound, ' timeline rows =', timelineRows, ' load-older button =', hasLoadOlder, ' subscriptions =', subscriptions);
	if (!drawerFound || timelineRows < 4 || !hasLoadOlder || subscriptions < 1) { console.error('FAIL: the timeline path did not execute'); process.exit(1); }

	function findByText(node, wanted) {
		let found = null;
		walk(node, (entry) => {
			if (found) return;
			if (entry.type === 'button' && (entry.children || []).some((child) => child && child.type === 'text' && child.value === wanted)) found = entry;
		});
		return found;
	}
	const diagButton = findByText(drawerTree, '投影键诊断');
	if (!diagButton) { console.error('FAIL: the projection key diagnostic button was not rendered'); process.exit(1); }
	diagButton.props.onClick();
	const diagTree = render(main, { ...hooks, ctx });
	const diagTexts = [];
	walk(diagTree, (entry) => { if (entry.type === 'text' && entry.value && entry.value.indexOf('×') !== -1) diagTexts.push(entry.value); });
	console.log('OK: key diagnostic =', JSON.stringify(diagTexts).slice(0, 260));
	if (!diagTexts.some((value) => value.indexOf('modelSelection') !== -1 && value.indexOf(PROJECT) !== -1)) { console.error('FAIL: the key diagnostic does not list the framework keys'); process.exit(1); }

	const cardTexts = [];
	walk(diagTree, (entry) => { if (entry.type === 'text' && entry.value) cardTexts.push(entry.value); });
	const joined = cardTexts.join('|');
	console.log('OK: cards show model =', joined.indexOf('qwen3.8-flash') !== -1, ' show tokens =', joined.indexOf('4800') !== -1, ' show context percent bar =', joined.indexOf('上下文压力') !== -1);
	if (joined.indexOf('qwen3.8-flash') === -1) { console.error('FAIL: the model id from modelSelection was not rendered'); process.exit(1); }

	for (const cleanup of cleanups) { if (typeof cleanup === 'function') cleanup(); }
	console.log('OK: released retains =', JSON.stringify(releases), ' subscriptions after cleanup =', subscriptions, ' document listeners left =', listeners.length);
	if (releases.length < 1 || subscriptions !== 0 || listeners.length !== 0) { console.error('FAIL: cleanup is not complete'); process.exit(1); }

	// Host half: the exported Config must carry a validator, and clamping must never reject.
	const host = await import(new URL('../index.js', import.meta.url).href);
	const validator = host.Config && host.Config['~standard'] && typeof host.Config['~standard'].validate === 'function';
	console.log('OK: host Config =', Boolean(host.Config), ' schemastery form =', host.hasConfigSchema, ' validator attached =', Boolean(validator));
	if (!host.Config || !validator) { console.error('FAIL: the Host export has no Config validator'); process.exit(1); }
	const clamped = host.clampConfig({ carouselIntervalMs: 999999, maxSessionsPerWorkspace: 'x', showArchivedSessions: 'yes', statusRefreshIntervalMs: 1 });
	console.log('OK: clampConfig =', JSON.stringify(clamped));
	if (clamped.carouselIntervalMs !== 120000 || clamped.maxSessionsPerWorkspace !== 6 || clamped.showArchivedSessions !== false || clamped.statusRefreshIntervalMs !== 500) {
		console.error('FAIL: clampConfig did not pull every value back into range');
		process.exit(1);
	}
	const rejected = host.normalizeConfig({ carouselThreshold: 0 });
	if (!rejected.issues || rejected.issues.length < 1) { console.error('FAIL: normalizeConfig accepted an out-of-range value'); process.exit(1); }
	console.log('OK: normalizeConfig rejects out-of-range =', rejected.issues[0].message);
	console.log('ALL CHECKS PASSED');
})();
