/**
 * dsh-workspace-monitor — Host half.
 *
 * What it does: folds each Session's durable log into one small projection
 * (`dshWorkspaceMonitor`) that the Client dashboard reads as a whole value, so cards and the
 * detail header never rescan a log themselves.
 *
 * What it deliberately does not do: no timers, no HTTP routes, no agent tools, no live
 * status table of its own. Running / idle / error truth stays with the framework
 * (`api-session/*` and `agent/status` drive the Client's `useSessionStatus`), and this plugin
 * only adds durable counts the log already proves. The projection registration rides this
 * plugin's fiber, so unloading the bundle removes the key and every cached cell.
 */

/** Projection key, namespaced so it cannot collide with another plugin's unit. */
const PROJECTION_KEY = 'dshWorkspaceMonitor';
/** Bump when the state shape changes: stored checkpoint rows of an older version are refolded. */
const STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// Config
//
// The plugin page builds its config form out of a Schemastery schema, so this plugin exports
// one. `@deepseek-ai/schemastery` is a Host package: the Loader resolves it for an installed
// bundle even though this checkout has no `node_modules` of its own (verified against
// `@goodandready/dsh-vision-bridge`, which imports it the same way with no dependencies
// declared). If it ever cannot be resolved, the export falls back to the hand-rolled
// `~standard` validator, so the plugin still mounts and still validates its row config.
// ---------------------------------------------------------------------------

const NUMBER_FIELDS = [
	['carouselIntervalMs', 8000, 1500, 120000],
	['carouselThreshold', 9, 1, 200],
	['carouselWorkspaceThreshold', 3, 1, 50],
	['maxSessionsPerWorkspace', 6, 1, 50],
	['statusRefreshIntervalMs', 2000, 500, 60000],
];
const BOOLEAN_FIELDS = [['showArchivedSessions', false], ['prioritizeRunningSessions', true]];

/**
 * Validate and normalize the row config.
 * @param {unknown} input - raw config from `cordis.patch.yml`.
 * @returns {{ value: object } | { issues: { message: string, path: string[] }[] }}
 */
export function normalizeConfig(input) {
	const source = input && typeof input === 'object' && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};
	/** @type {Record<string, number | boolean>} */
	const value = {};
	/** @type {{ message: string, path: string[] }[]} */
	const issues = [];
	for (const [name, fallback, min, max] of NUMBER_FIELDS) {
		const raw = source[name];
		if (raw === undefined || raw === null) {
			value[name] = fallback;
			continue;
		}
		if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
			issues.push({ message: `${name} must be an integer, got ${String(raw)}`, path: [name] });
			continue;
		}
		if (raw < min || raw > max) {
			issues.push({ message: `${name} must be between ${min} and ${max}`, path: [name] });
			continue;
		}
		value[name] = raw;
	}
	for (const [name, fallback] of BOOLEAN_FIELDS) {
		const raw = source[name];
		if (raw === undefined || raw === null) {
			value[name] = fallback;
			continue;
		}
		if (typeof raw !== 'boolean') {
			issues.push({ message: `${name} must be true or false`, path: [name] });
			continue;
		}
		value[name] = raw;
	}
	return issues.length ? { issues } : { value };
}

/**
 * Same fields, but never rejects: a value the form wrote out of range is pulled back into the
 * range and the default is used for anything that is not a number at all. A tunable that the
 * page cannot read must not take the dashboard down.
 * @param {unknown} input
 * @returns {Record<string, number | boolean>}
 */
export function clampConfig(input) {
	const source = input && typeof input === 'object' && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};
	/** @type {Record<string, number | boolean>} */
	const value = {};
	for (const [name, fallback, min, max] of NUMBER_FIELDS) {
		const raw = source[name];
		if (typeof raw !== 'number' || !Number.isFinite(raw)) {
			value[name] = fallback;
			continue;
		}
		value[name] = Math.min(max, Math.max(min, Math.round(raw)));
	}
	for (const [name, fallback] of BOOLEAN_FIELDS) {
		const raw = source[name];
		value[name] = typeof raw === 'boolean' ? raw : fallback;
	}
	return value;
}

let schemastery = /** @type {any} */ (null);
try {
	schemastery = (await import('@deepseek-ai/schemastery')).default ?? null;
} catch {
	// No Host Schemastery in reach: keep the validator-only form of the export.
	schemastery = null;
}

export const Config = schemastery
	? schemastery.object({
		carouselIntervalMs: schemastery
			.number()
			.description('Carousel page interval, ms (1500-120000). 轮播翻页间隔。')
			.default(8000),
		carouselThreshold: schemastery
			.number()
			.description('Session count in one workspace that starts the carousel (1-200). 单个工作区触发轮播的会话数。')
			.default(9),
		carouselWorkspaceThreshold: schemastery
			.number()
			.description('Workspace count that starts the carousel (1-50). 触发轮播的工作区数量。')
			.default(3),
		maxSessionsPerWorkspace: schemastery
			.number()
			.description('Cards shown per workspace group (1-50). 每个工作区显示的会话卡片数。')
			.default(6),
		showArchivedSessions: schemastery
			.boolean()
			.description('Include archived sessions in the cards. 是否显示已归档会话。')
			.default(false),
		prioritizeRunningSessions: schemastery
			.boolean()
			.description('Order cards and workspace modules by urgency (running, interrupted, waiting, completed). Off = keep the framework order. 是否把在运行的会话排在前面。')
			.default(true),
		statusRefreshIntervalMs: schemastery
			.number()
			.description('How often the panel re-reads session status, ms (500-60000). 状态刷新间隔。')
			.default(2000),
	})
	: {
		'~standard': { version: 1, vendor: 'dsh-workspace-monitor', validate: normalizeConfig },
	};

/** True when the Schemastery form is live; used by the smoke test and by diagnostics. */
export const hasConfigSchema = Boolean(schemastery);


// ---------------------------------------------------------------------------
// Projection state
// ---------------------------------------------------------------------------

/** @returns {object} the fold's starting state for one Session. */
function emptyState() {
	return {
		turns: 0,
		steps: 0,
		toolCalls: 0,
		toolResults: 0,
		toolErrors: 0,
		userMessages: 0,
		assistantMessages: 0,
		tokens: { input: 0, output: 0 },
		lastTurnEndReason: '',
		provider: '',
		model: '',
		contextWindow: 0,
	};
}

const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value) => typeof value === 'string' ? value.slice(0, 120) : '';

/** TokenUsage field naming varies across providers, so every known spelling is read. */
function readUsage(usage) {
	if (!usage || typeof usage !== 'object') return { input: 0, output: 0 };
	const record = /** @type {Record<string, unknown>} */ (usage);
	return {
		input: number(record.input) || number(record.prompt_tokens) || number(record.prompt) || number(record.input_tokens) || 0,
		output: number(record.output) || number(record.completion_tokens) || number(record.completion) || number(record.output_tokens) || 0,
	};
}

/**
 * Normalize one state or view value. Used as both `stateSchema` and `viewSchema`: the
 * registry only requires a `parse(value)` method that returns the usable value or throws.
 * @param {unknown} value
 */
export function normalizeState(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace monitor state must be an object');
	const state = /** @type {Record<string, unknown>} */ (value);
	const tokens = state.tokens && typeof state.tokens === 'object' ? /** @type {Record<string, unknown>} */ (state.tokens) : {};
	return {
		turns: number(state.turns),
		steps: number(state.steps),
		toolCalls: number(state.toolCalls),
		toolResults: number(state.toolResults),
		toolErrors: number(state.toolErrors),
		userMessages: number(state.userMessages),
		assistantMessages: number(state.assistantMessages),
		tokens: { input: number(tokens.input), output: number(tokens.output) },
		lastTurnEndReason: text(state.lastTurnEndReason),
		provider: text(state.provider),
		model: text(state.model),
		contextWindow: number(state.contextWindow),
	};
}

const stateSchema = { parse: normalizeState };

/** Turn endings that mean "the last run did not finish cleanly". */
const FAILURE_REASONS = new Set(['error', 'aborted', 'interrupted', 'blocked', 'max-tokens']);

/**
 * Fold one committed Session event into the state. The framework compares the returned
 * reference with `Object.is`, so an unchanged event must return the same object.
 *
 * A committed event is the envelope `{ type, seq, time, data }`, and the payload lives under
 * `data` (`turn/end` carries `data.reason.kind`, `assistant/message` carries `data.usage`).
 * `payload` reads `data` first and falls back to the envelope so a folded unit never depends
 * on one spelling of the same fact.
 * @param {object} state
 * @param {{ type: string, data?: object }} event
 */
export function foldEvent(state, event) {
	if (!event || typeof event.type !== 'string') return state;
	const eventLike = /** @type {Record<string, unknown>} */ (event);
	const data = eventLike.data && typeof eventLike.data === 'object' ? /** @type {Record<string, unknown>} */ (eventLike.data) : eventLike;
	switch (event.type) {
		case 'turn/start':
			return { ...state, turns: state.turns + 1 };
		case 'step/start':
			return { ...state, steps: state.steps + 1 };
		case 'tool/call':
			return { ...state, toolCalls: state.toolCalls + 1 };
		case 'tool/result': {
			const message = data.message && typeof data.message === 'object' ? /** @type {Record<string, unknown>} */ (data.message) : {};
			const failed = Boolean(message.isError) || Boolean(data.error) || Boolean(message.error);
			return { ...state, toolResults: state.toolResults + 1, toolErrors: state.toolErrors + (failed ? 1 : 0) };
		}
		case 'user/message':
			return { ...state, userMessages: state.userMessages + 1 };
		case 'assistant/message': {
			const usage = readUsage(data.usage);
			return {
				...state,
				assistantMessages: state.assistantMessages + 1,
				tokens: { input: state.tokens.input + usage.input, output: state.tokens.output + usage.output },
			};
		}
		case 'assistant/attempt':
			return state;
		case 'request/context':
			return { ...state, provider: text(data.provider), model: text(data.model), contextWindow: number(data.contextWindow) };
		case 'turn/end': {
			const reason = data.reason && typeof data.reason === 'object' ? /** @type {Record<string, unknown>} */ (data.reason) : {};
			return { ...state, lastTurnEndReason: text(reason.kind) };
		}
		default:
			return state;
	}
}

/** The client-visible value: the state itself, already small (numbers plus three short strings). */
function view(state) {
	return normalizeState(state);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Register the projection unit. `sessionProjections` is looked up optionally so this plugin
 * stays inactive, rather than throwing, in a profile that does not mount it.
 * @param {any} ctx
 * @param {Record<string, number | boolean>} config
 */
export function apply(ctx, config) {
	const known = clampConfig(config);
	ctx.inject(['sessionProjections'], () => {
		ctx.sessionProjections.register({
			key: PROJECTION_KEY,
			stateVersion: STATE_VERSION,
			stateSchema,
			init: () => emptyState(),
			apply: foldEvent,
			wire: { viewSchema: stateSchema, view },
		});
	});
	// Counts are host-side facts; the tunables belong to the Client view, which reads the same
	// row config through the Client `configForms` map. Values are clamped here (never rejected)
	// so a hand-edited `cordis.patch.yml` or a config written by the plugin page cannot take the
	// panel down; out-of-range numbers come back as the nearest allowed value.
	void known;
}
