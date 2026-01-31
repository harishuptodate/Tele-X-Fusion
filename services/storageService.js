const CONFIG = require('../config');
const ProcessedMessage = require('../models/ProcessedMessage');
const RateLimitState = require('../models/RateLimitState');

const isMessagePostedToTwitter = async (messageId) => {
	try {
		const message = await ProcessedMessage.findOne({ messageId: messageId });
		return !!message;
	} catch (error) {
		console.error('Error checking if message was posted:', error.message);
		return false;
	}
};

const addMessageToProcessed = async (messageId) => {
	try {
		// Check if already exists
		const existing = await ProcessedMessage.findOne({ messageId: messageId });
		if (existing) {
			return; // Already exists, no need to add
		}

		// Add new message
		await ProcessedMessage.create({ messageId: messageId });

		// Keep only last 10 messages - delete oldest ones
		const allMessages = await ProcessedMessage.find()
			.sort({ createdAt: -1 })
			.limit(CONFIG.MAX_PROCESSED_MESSAGE_IDS + 1);

		if (allMessages.length > CONFIG.MAX_PROCESSED_MESSAGE_IDS) {
			// Delete oldest messages beyond the limit
			const messagesToDelete = allMessages.slice(CONFIG.MAX_PROCESSED_MESSAGE_IDS);
			const idsToDelete = messagesToDelete.map(msg => msg._id);
			await ProcessedMessage.deleteMany({ _id: { $in: idsToDelete } });
		}
	} catch (error) {
		console.error('Error adding message to processed list:', error.message);
	}
};

const loadRateLimitState = async () => {
	try {
		const state = await RateLimitState.getState();
		console.log('Loaded rate limit state from MongoDB');
	} catch (error) {
		console.error('Error loading rate limit state:', error.message);
	}
};

const saveRateLimitState = async (stateData) => {
	try {
		const state = await RateLimitState.getState();
		Object.assign(state, stateData, { lastUpdated: new Date() });
		await state.save();
	} catch (error) {
		console.error('Error saving rate limit state:', error.message);
	}
};

const incrementSuccessfulTweetCount = async () => {
	try {
		const state = await RateLimitState.getState();
		state.successfulTweetsCount = (state.successfulTweetsCount || 0) + 1;
		// Decrement remaining if we have it
		if (state.remaining !== null && state.limit !== null) {
			state.remaining = Math.max(0, state.remaining - 1);
		}
		state.lastUpdated = new Date();
		await state.save();
	} catch (error) {
		console.error('Error incrementing successful tweet count:', error.message);
	}
};

const handleRateLimitError = async (error) => {
	if (error.code === 429 && error.headers) {
		try {
			const userLimit = error.headers['x-user-limit-24hour-limit'];
			const userRemaining = error.headers['x-user-limit-24hour-remaining'];
			const userReset = error.headers['x-user-limit-24hour-reset'];

			const userResetDate = new Date(Number(userReset) * 1000);
			
			const state = await RateLimitState.getState();
			state.limit = userLimit ? parseInt(userLimit) : state.limit;
			state.remaining = userRemaining ? parseInt(userRemaining) : state.remaining;
			state.resetAt = userResetDate;
			state.lastErrorOccurredAt = new Date();
			state.lastUpdated = new Date();
			// Preserve successfulTweetsCount
			await state.save();
			
			console.log(`🔒 User Tweet Limit: ${state.limit}, Remaining: ${state.remaining}`);
			console.log(`🕒 User Limit Resets At: ${userResetDate.toString()}`);
			console.log('Skipping tweet posting due to rate limit.');
		} catch (dbError) {
			console.error('Error handling rate limit error:', dbError.message);
		}
	}
};

const getRateLimitState = async () => {
	try {
		const state = await RateLimitState.getState();
		return {
			limit: state.limit,
			remaining: state.remaining,
			resetAt: state.resetAt ? state.resetAt.toISOString() : null,
			lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
			successfulTweetsCount: state.successfulTweetsCount || 0,
			lastErrorOccurredAt: state.lastErrorOccurredAt ? state.lastErrorOccurredAt.toISOString() : null
		};
	} catch (error) {
		console.error('Error getting rate limit state:', error.message);
		return {
			limit: null,
			remaining: null,
			resetAt: null,
			lastUpdated: null,
			successfulTweetsCount: 0,
			lastErrorOccurredAt: null
		};
	}
};

const canMakeTwitterRequest = async () => {
	try {
		const state = await RateLimitState.getState();
		if (state.limit === null) {
			return true;
		}
		// Use remaining from error headers
		if (state.remaining !== null && state.remaining <= 0) {
			console.log(`Rate limit reached. Limit: ${state.limit}, Remaining: ${state.remaining}`);
			return false;
		}
		return true;
	} catch (error) {
		console.error('Error checking rate limit:', error.message);
		return true; // Allow request on error
	}
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

