const RateLimitState = require('../../models/RateLimitState');

const getState = async () => RateLimitState.getState();

const saveState = async (state, updates = {}) => {
	Object.assign(state, updates, { lastUpdated: new Date() });
	await state.save();
	return state;
};

const getSnapshot = (state) => ({
	limit: state.limit,
	remaining: state.remaining,
	resetAt: state.resetAt ? state.resetAt.toISOString() : null,
	lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
	successfulTweetsCount: state.successfulTweetsCount || 0,
	windowStartTime: state.windowStartTime ? state.windowStartTime.toISOString() : null,
	lastErrorOccurredAt: state.lastErrorOccurredAt ? state.lastErrorOccurredAt.toISOString() : null,
});

module.exports = {
	getState,
	saveState,
	getSnapshot,
};
