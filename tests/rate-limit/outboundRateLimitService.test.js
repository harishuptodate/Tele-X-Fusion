const test = require('node:test');
const assert = require('node:assert/strict');

const repository = require('../../rate-limit/repositories/rateLimitRepository');
const service = require('../../rate-limit/services/outboundRateLimitService');
const { RateLimitDecision } = require('../../rate-limit/domain/RateLimitDecision');
const { outboundRateLimitService } = require('../../rate-limit');
const { postTweet } = require('../../services/twitterService');

const buildMockState = (overrides = {}) => ({
	limit: null,
	remaining: null,
	resetAt: null,
	successfulTweetsCount: 0,
	windowStartTime: null,
	lastErrorOccurredAt: null,
	lastUpdated: new Date(),
	async save() {
		return this;
	},
	...overrides,
});

test('preflightCheck blocks when remaining is exhausted before reset', async () => {
	const originalGetState = repository.getState;
	repository.getState = async () =>
		buildMockState({
			limit: 10,
			remaining: 0,
			resetAt: new Date(Date.now() + 10 * 60 * 1000),
		});

	try {
		const decision = await service.preflightCheck();
		assert.equal(decision.decision, RateLimitDecision.BLOCK);
		assert.equal(decision.reason, 'twitter_rate_limit_exhausted');
	} finally {
		repository.getState = originalGetState;
	}
});

test('recordRateLimitError updates state from header payload', async () => {
	const state = buildMockState();
	const originalGetState = repository.getState;
	repository.getState = async () => state;

	try {
		const updated = await service.recordRateLimitError({
			code: 429,
			headers: {
				'x-rate-limit-limit': '15',
				'x-rate-limit-remaining': '0',
				'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 3600),
			},
		});

		assert.equal(updated, true);
		assert.equal(state.limit, 15);
		assert.equal(state.remaining, 0);
		assert.ok(state.resetAt instanceof Date);
	} finally {
		repository.getState = originalGetState;
	}
});

test('twitterService returns fail-fast result when preflight blocks', async () => {
	const originalPreflight = outboundRateLimitService.preflightCheck;
	outboundRateLimitService.preflightCheck = async () => ({
		decision: RateLimitDecision.BLOCK,
		reason: 'twitter_rate_limit_exhausted',
		resetAt: new Date(Date.now() + 300000).toISOString(),
	});

	try {
		const result = await postTweet(['hello'], {}, 'hello', 'hello');
		assert.equal(result.success, false);
		assert.equal(result.blockedByRateLimit, true);
		assert.equal(result.reason, 'twitter_rate_limit_exhausted');
	} finally {
		outboundRateLimitService.preflightCheck = originalPreflight;
	}
});
