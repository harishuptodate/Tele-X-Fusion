const { RateLimitDecision } = require('../domain/RateLimitDecision');
const repository = require('../repositories/rateLimitRepository');
const {
	isRateLimitError,
	parseTwitterRateLimit,
} = require('../providers/twitterRateLimitParser');

const WINDOW_MS = 24 * 60 * 60 * 1000;

const normalizeErrorForRateLimit = (error) => {
	if (!error) return error;

	const headers = error.headers || error.response?.headers || error.rateLimit || {};
	const status = error.status || error.code || error.response?.status;
	const code = error.code || error.status || error.response?.status;

	return {
		...error,
		headers,
		status,
		code,
	};
};

const ensureWindowReset = async (state) => {
	const now = new Date();
	let shouldReset = false;

	if (state.windowStartTime) {
		const elapsedMs = now.getTime() - state.windowStartTime.getTime();
		if (elapsedMs >= WINDOW_MS) {
			shouldReset = true;
		}
	}

	if (state.resetAt && now >= state.resetAt) {
		shouldReset = true;
	}

	if (shouldReset) {
		state.successfulTweetsCount = 0;
		state.remaining = state.limit;
		state.windowStartTime = now;
		state.resetAt = new Date(now.getTime() + WINDOW_MS);
		state.lastUpdated = now;
		await state.save();
	}
};

const preflightCheck = async () => {
	const state = await repository.getState();
	await ensureWindowReset(state);

	const now = new Date();
	const limitKnown = state.limit !== null && state.limit !== undefined;
	const isExplicitlyExhausted = state.remaining !== null && state.remaining !== undefined && state.remaining <= 0;
	const withinBlockedWindow = state.resetAt && now < state.resetAt;

	if (limitKnown && isExplicitlyExhausted && withinBlockedWindow) {
		return {
			decision: RateLimitDecision.BLOCK,
			reason: 'twitter_rate_limit_exhausted',
			resetAt: state.resetAt.toISOString(),
			remaining: state.remaining,
			limit: state.limit,
		};
	}

	return {
		decision: RateLimitDecision.ALLOW,
		reason: 'ok',
		resetAt: state.resetAt ? state.resetAt.toISOString() : null,
		remaining: state.remaining,
		limit: state.limit,
	};
};

const recordSuccess = async () => {
	const state = await repository.getState();
	const now = new Date();

	if (state.windowStartTime) {
		const elapsedMs = now.getTime() - state.windowStartTime.getTime();
		if (elapsedMs >= WINDOW_MS) {
			state.successfulTweetsCount = 0;
			state.windowStartTime = now;
		}
	} else {
		state.windowStartTime = now;
	}

	const currentCount = state.successfulTweetsCount || 0;
	if (state.limit !== null && state.limit !== undefined && currentCount >= state.limit) {
		state.successfulTweetsCount = 0;
		state.windowStartTime = now;
		state.resetAt = new Date(now.getTime() + WINDOW_MS);
		state.remaining = state.limit;
	} else {
		state.successfulTweetsCount = currentCount + 1;
	}

	if (state.limit !== null && state.limit !== undefined) {
		state.remaining = Math.max(0, state.limit - state.successfulTweetsCount);
	}

	if (!state.resetAt && state.windowStartTime) {
		state.resetAt = new Date(state.windowStartTime.getTime() + WINDOW_MS);
	}

	state.lastUpdated = now;
	await state.save();
};

const recordRateLimitError = async (error) => {
	const normalizedError = normalizeErrorForRateLimit(error);
	const isRateLimit = isRateLimitError(normalizedError);
	// #region agent log
	fetch('http://127.0.0.1:7628/ingest/1fd3aeed-313d-4e3a-95df-30f08beb7214',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'121def'},body:JSON.stringify({sessionId:'121def',runId:'initial',hypothesisId:'H4',location:'rate-limit/services/outboundRateLimitService.js:101',message:'recordRateLimitError gate result',data:{isRateLimit,code:normalizedError?.code??null,status:normalizedError?.status??null,hasRateLimit:!!normalizedError?.rateLimit,responseStatus:normalizedError?.response?.status??null,title:normalizedError?.data?.title??null},timestamp:Date.now()})}).catch(()=>{});
	// #endregion
	if (!isRateLimit) return false;

	const parsed = parseTwitterRateLimit(normalizedError);
	// #region agent log
	fetch('http://127.0.0.1:7628/ingest/1fd3aeed-313d-4e3a-95df-30f08beb7214',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'121def'},body:JSON.stringify({sessionId:'121def',runId:'initial',hypothesisId:'H5',location:'rate-limit/services/outboundRateLimitService.js:106',message:'Parsed rate-limit values',data:{limit:parsed?.limit??null,remaining:parsed?.remaining??null,resetAt:parsed?.resetAt?parsed.resetAt.toISOString():null},timestamp:Date.now()})}).catch(()=>{});
	// #endregion
	const state = await repository.getState();
	if (parsed.limit !== null) state.limit = parsed.limit;
	if (parsed.remaining !== null) state.remaining = parsed.remaining;

	if (parsed.resetAt) {
		state.resetAt = parsed.resetAt;
	} else if (!state.resetAt && state.windowStartTime) {
		state.resetAt = new Date(state.windowStartTime.getTime() + WINDOW_MS);
	}

	state.lastErrorOccurredAt = new Date();
	state.lastUpdated = new Date();
	await state.save();
	return true;
};

const getRateLimitState = async () => {
	const state = await repository.getState();
	await ensureWindowReset(state);
	return repository.getSnapshot(state);
};

module.exports = {
	preflightCheck,
	recordSuccess,
	recordRateLimitError,
	getRateLimitState,
	ensureWindowReset,
};
