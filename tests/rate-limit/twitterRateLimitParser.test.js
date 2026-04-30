const test = require('node:test');
const assert = require('node:assert/strict');
const {
	isRateLimitError,
	parseTwitterRateLimit,
	normalizeResetAt,
} = require('../../rate-limit/providers/twitterRateLimitParser');

test('isRateLimitError detects common 429 shapes', () => {
	assert.equal(isRateLimitError({ code: 429 }), true);
	assert.equal(isRateLimitError({ status: 429 }), true);
	assert.equal(isRateLimitError({ response: { status: 429 } }), true);
	assert.equal(isRateLimitError({ rateLimit: { limit: 10 } }), true);
	assert.equal(isRateLimitError({ code: 500 }), false);
});

test('parseTwitterRateLimit parses header variants and seconds reset', () => {
	const parsed = parseTwitterRateLimit({
		headers: {
			'X-Rate-Limit-Limit': '25',
			'X-Rate-Limit-Remaining': '4',
			'X-Rate-Limit-Reset': '1714473600',
		},
	});

	assert.equal(parsed.limit, 25);
	assert.equal(parsed.remaining, 4);
	assert.ok(parsed.resetAt instanceof Date);
	assert.equal(parsed.resetAt.getUTCFullYear() >= 2024, true);
});

test('normalizeResetAt supports milliseconds', () => {
	const reset = normalizeResetAt(1714473600123);
	assert.ok(reset instanceof Date);
	assert.equal(reset.getTime(), 1714473600123);
});
