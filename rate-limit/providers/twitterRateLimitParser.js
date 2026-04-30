const RATE_LIMIT_HEADER_KEYS = {
	limit: ['x-user-limit-24hour-limit', 'x-rate-limit-limit', 'x-ratelimit-limit'],
	remaining: ['x-user-limit-24hour-remaining', 'x-rate-limit-remaining', 'x-ratelimit-remaining'],
	reset: ['x-user-limit-24hour-reset', 'x-rate-limit-reset', 'x-ratelimit-reset'],
};

const isRateLimitError = (error) => {
	if (!error) return false;
	return Boolean(
		error.code === 429 ||
		error.status === 429 ||
		!!error.rateLimit ||
		(error.response && error.response.status === 429)
	);
};

const toNumber = (value) => {
	if (value === undefined || value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const normalizeResetAt = (resetValue) => {
	const numericReset = toNumber(resetValue);
	if (numericReset === null) return null;
	return numericReset < 10000000000
		? new Date(numericReset * 1000)
		: new Date(numericReset);
};

const pickHeaderValue = (headers = {}, candidateKeys = []) => {
	const normalizedHeaders = Object.entries(headers).reduce((acc, [key, value]) => {
		acc[String(key).toLowerCase()] = value;
		return acc;
	}, {});

	for (const key of candidateKeys) {
		const value = normalizedHeaders[key];
		if (value !== undefined && value !== null) {
			return value;
		}
	}
	return null;
};

const extractHeaders = (error) => {
	if (!error) return {};
	return error.headers || error.response?.headers || error.rateLimit || {};
};

const parseTwitterRateLimit = (error) => {
	const headers = extractHeaders(error);
	const parsedLimit = pickHeaderValue(headers, RATE_LIMIT_HEADER_KEYS.limit);
	const parsedRemaining = pickHeaderValue(headers, RATE_LIMIT_HEADER_KEYS.remaining);
	const parsedReset = pickHeaderValue(headers, RATE_LIMIT_HEADER_KEYS.reset);

	return {
		limit: toNumber(parsedLimit ?? error?.rateLimit?.limit),
		remaining: toNumber(parsedRemaining ?? error?.rateLimit?.remaining),
		resetAt: normalizeResetAt(parsedReset ?? error?.rateLimit?.reset),
	};
};

module.exports = {
	isRateLimitError,
	parseTwitterRateLimit,
	normalizeResetAt,
};
