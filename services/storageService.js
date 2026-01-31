const fs = require('fs').promises;
const CONFIG = require('../config');

// Store rate limit information (loaded from JSON)
let rateLimitState = {
	limit: null,
	remaining: null,
	resetAt: null,
	lastUpdated: null,
	successfulTweetsCount: 0,
	lastErrorOccurredAt: null
};

const loadProcessedMessageIds = async () => {
	try {
		const data = await fs.readFile(CONFIG.PROCESSED_MESSAGES_FILE, 'utf-8');
		const parsed = JSON.parse(data);
		return parsed.messageIds || [];
	} catch (error) {
		if (error.code === 'ENOENT') {
			return [];
		}
		console.error('Error loading processed message IDs:', error.message);
		return [];
	}
};

const saveProcessedMessageIds = async (messageIds) => {
	try {
		const last10 = messageIds.slice(-CONFIG.MAX_PROCESSED_MESSAGE_IDS);
		const data = { messageIds: last10 };
		await fs.writeFile(CONFIG.PROCESSED_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf-8');
	} catch (error) {
		console.error('Error saving processed message IDs:', error.message);
	}
};

const isMessagePostedToTwitter = async (messageId) => {
	try {
		const messageIds = await loadProcessedMessageIds();
		return messageIds.includes(messageId);
	} catch (error) {
		console.error('Error checking if message was posted:', error.message);
		return false;
	}
};

const addMessageToProcessed = async (messageId) => {
	try {
		const messageIds = await loadProcessedMessageIds();
		const filtered = messageIds.filter(id => id !== messageId);
		filtered.push(messageId);
		await saveProcessedMessageIds(filtered);
	} catch (error) {
		console.error('Error adding message to processed list:', error.message);
	}
};

const loadRateLimitState = async () => {
	try {
		const data = await fs.readFile(CONFIG.RATE_LIMIT_STATE_FILE, 'utf-8');
		const parsed = JSON.parse(data);
		rateLimitState = {
			limit: parsed.limit || null,
			remaining: parsed.remaining !== undefined ? parsed.remaining : null,
			resetAt: parsed.resetAt || null,
			lastUpdated: parsed.lastUpdated || null,
			successfulTweetsCount: parsed.successfulTweetsCount || 0,
			lastErrorOccurredAt: parsed.lastErrorOccurredAt || null
		};
		console.log('Loaded rate limit state from JSON');
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.log('Rate limit state file not found, using defaults');
		} else {
			console.error('Error loading rate limit state:', error.message);
		}
	}
};

const saveRateLimitState = async () => {
	try {
		rateLimitState.lastUpdated = new Date().toISOString();
		await fs.writeFile(CONFIG.RATE_LIMIT_STATE_FILE, JSON.stringify(rateLimitState, null, 2), 'utf-8');
	} catch (error) {
		console.error('Error saving rate limit state:', error.message);
	}
};

const incrementSuccessfulTweetCount = async () => {
	rateLimitState.successfulTweetsCount = (rateLimitState.successfulTweetsCount || 0) + 1;
	if (rateLimitState.limit !== null) {
		rateLimitState.remaining = Math.max(0, rateLimitState.remaining - 1);
	}
	await saveRateLimitState();
};

const handleRateLimitError = async (error) => {
	if (error.code === 429 && error.headers) {
		const userLimit = error.headers['x-user-limit-24hour-limit'];
		const userRemaining = error.headers['x-user-limit-24hour-remaining'];
		const userReset = error.headers['x-user-limit-24hour-reset'];

		const userResetDate = new Date(Number(userReset) * 1000);
		
		rateLimitState = {
			limit: userLimit ? parseInt(userLimit) : rateLimitState.limit,
			remaining: userRemaining ? parseInt(userRemaining) : rateLimitState.remaining,
			resetAt: userResetDate.toISOString(),
			lastUpdated: new Date().toISOString(),
			successfulTweetsCount: rateLimitState.successfulTweetsCount || 0,
			lastErrorOccurredAt: new Date().toISOString()
		};
		
		await saveRateLimitState();
		
		console.log(`🔒 User Tweet Limit: ${rateLimitState.limit}, Remaining: ${rateLimitState.remaining}`);
		console.log(`🕒 User Limit Resets At: ${userResetDate.toString()}`);
		console.log('Skipping tweet posting due to rate limit.');
	}
};

const getRateLimitState = () => rateLimitState;

const canMakeTwitterRequest = () => {
	if (rateLimitState.limit === null) {
		return true;
	}
	const realTimeRemaining = rateLimitState.limit - (rateLimitState.successfulTweetsCount || 0);
	if (realTimeRemaining <= 0) {
		console.log(`Rate limit reached. Limit: ${rateLimitState.limit}, Posted: ${rateLimitState.successfulTweetsCount}, Remaining: ${realTimeRemaining}`);
		return false;
	}
	return true;
};

module.exports = {
	isMessagePostedToTwitter,
	addMessageToProcessed,
	loadRateLimitState,
	saveRateLimitState,
	incrementSuccessfulTweetCount,
	handleRateLimitError,
	getRateLimitState,
	canMakeTwitterRequest,
};

