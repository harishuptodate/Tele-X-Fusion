const CONFIG = require('../config');
const ProcessedMessage = require('../models/ProcessedMessage');
const RateLimitState = require('../models/RateLimitState');

// Helper function to format date in IST (DD/MM/YYYY HH:MM:SS)
const formatISTDate = (date) => {
	if (!date) return '';
	const dateObj = date instanceof Date ? date : new Date(date);
	const istString = dateObj.toLocaleString('en-GB', { 
		timeZone: 'Asia/Kolkata',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	return istString.replace(', ', ' ');
};

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
		// Reset the resetAt field when tweet is posted successfully
		state.resetAt = null;
		state.lastUpdated = new Date();
		await state.save();
	} catch (error) {
		console.error('Error incrementing successful tweet count:', error.message);
	}
};

const handleRateLimitError = async (error) => {
	// Check if this is a rate limit error
	const isRateLimitError = error.code === 429 || 
	                         error.status === 429 || 
	                         error.rateLimit ||
	                         (error.response && error.response.status === 429);
	
	if (!isRateLimitError) {
		return;
	}

	try {
		// Try to extract headers from different possible locations
		let headers = error.headers;
		if (!headers && error.response) {
			headers = error.response.headers;
		}
		if (!headers && error.rateLimit) {
			// Handle rateLimit object if present
			headers = error.rateLimit;
		}

		// Extract rate limit information from headers
		// Twitter API v2 uses different header names, try multiple formats
		const userLimit = headers?.['x-user-limit-24hour-limit'] || 
		                  headers?.['x-rate-limit-limit'] ||
		                  headers?.['x-ratelimit-limit'] ||
		                  error.rateLimit?.limit;
		
		const userRemaining = headers?.['x-user-limit-24hour-remaining'] || 
		                      headers?.['x-rate-limit-remaining'] ||
		                      headers?.['x-ratelimit-remaining'] ||
		                      error.rateLimit?.remaining;
		
		const userReset = headers?.['x-user-limit-24hour-reset'] || 
		                  headers?.['x-rate-limit-reset'] ||
		                  headers?.['x-ratelimit-reset'] ||
		                  error.rateLimit?.reset;

		// Get current state
		const state = await RateLimitState.getState();
		
		// Update limit if we have it
		if (userLimit !== undefined && userLimit !== null) {
			state.limit = parseInt(userLimit);
		}
		
		// Update remaining if we have it
		if (userRemaining !== undefined && userRemaining !== null) {
			state.remaining = parseInt(userRemaining);
		}
		
		// Update reset time if we have it
		if (userReset !== undefined && userReset !== null) {
			// Reset can be in seconds (Unix timestamp) or milliseconds
			const resetValue = Number(userReset);
			const userResetDate = resetValue < 10000000000 
				? new Date(resetValue * 1000)  // Unix timestamp in seconds
				: new Date(resetValue);         // Already in milliseconds
			state.resetAt = userResetDate;
		}
		
		// Always update error timestamp and last updated
		state.lastErrorOccurredAt = new Date();
		state.lastUpdated = new Date();
		
		// Preserve successfulTweetsCount
		await state.save();
		
		console.log('=== RATE LIMIT ERROR PROCESSED ===');
		console.log(`🔒 User Tweet Limit: ${state.limit ?? 'N/A'}, Remaining: ${state.remaining ?? 'N/A'}`);
		if (state.resetAt) {
			console.log(`🕒 User Limit Resets At: ${formatISTDate(state.resetAt)}`);
		}
		console.log(`⚠️ Last Error Occurred At: ${formatISTDate(state.lastErrorOccurredAt)}`);
		console.log(`🔄 Last Updated: ${formatISTDate(state.lastUpdated)}`);
		console.log('Skipping tweet posting due to rate limit.');
	} catch (dbError) {
		console.error('Error handling rate limit error:', dbError.message);
		console.error('Full error:', dbError);
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
		
		// Check if reset time has passed - if so, reset the remaining count
		if (state.resetAt && new Date() >= state.resetAt) {
			console.log('Rate limit reset time has passed, resetting remaining count');
			state.remaining = state.limit; // Reset to full limit
			state.lastUpdated = new Date();
			await state.save();
		}
		
		// Use remaining from error headers
		if (state.remaining !== null && state.remaining <= 0) {
			console.log(`Rate limit reached. Limit: ${state.limit}, Remaining: ${state.remaining}`);
			if (state.resetAt) {
				const timeUntilReset = Math.max(0, state.resetAt.getTime() - Date.now());
				const hoursUntilReset = Math.floor(timeUntilReset / (1000 * 60 * 60));
				const minutesUntilReset = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));
				console.log(`Rate limit resets in: ${hoursUntilReset}h ${minutesUntilReset}m`);
			}
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

