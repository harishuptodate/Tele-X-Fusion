const CONFIG = require('../config');
const ProcessedMessage = require('../models/ProcessedMessage');
const RateLimitState = require('../models/RateLimitState');
const SaleModeState = require('../models/SaleModeState');

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
		const now = new Date();
		
		// Check if 24 hours have passed since windowStartTime - if so, reset the count
		if (state.windowStartTime) {
			const timeSinceWindowStart = now.getTime() - state.windowStartTime.getTime();
			const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
			
			if (timeSinceWindowStart >= twentyFourHours) {
				// Reset successfulTweetsCount and start a new window
				state.successfulTweetsCount = 0;
				state.windowStartTime = now;
				console.log('24-hour window has passed, resetting successfulTweetsCount and starting new window');
			}
		} else {
			// First tweet - set windowStartTime
			state.windowStartTime = now;
		}
		
		// Increment successful tweet count
		state.successfulTweetsCount = (state.successfulTweetsCount || 0) + 1;
		
		// Decrement remaining if we have it
		if (state.remaining !== null && state.limit !== null) {
			state.remaining = Math.max(0, state.remaining - 1);
		}
		
		// Calculate resetAt as windowStartTime + 24 hours if not already set from error headers
		if (!state.resetAt && state.windowStartTime) {
			const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
			state.resetAt = new Date(state.windowStartTime.getTime() + twentyFourHours);
		}
		
		// Never set resetAt to null - always maintain a reset time
		state.lastUpdated = now;
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
		
		// Update reset time if we have it (only update if error provides reset time)
		if (userReset !== undefined && userReset !== null) {
			// Reset can be in seconds (Unix timestamp) or milliseconds
			const resetValue = Number(userReset);
			const userResetDate = resetValue < 10000000000 
				? new Date(resetValue * 1000)  // Unix timestamp in seconds
				: new Date(resetValue);         // Already in milliseconds
			state.resetAt = userResetDate;
		}
		// If error doesn't provide resetAt, preserve existing resetAt or calculate from windowStartTime
		else if (!state.resetAt && state.windowStartTime) {
			const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
			state.resetAt = new Date(state.windowStartTime.getTime() + twentyFourHours);
		}
		
		// Always update error timestamp and last updated
		state.lastErrorOccurredAt = new Date();
		state.lastUpdated = new Date();
		
		// Preserve successfulTweetsCount and windowStartTime (don't overwrite them)
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

// Check and reset rate limit state if 24 hours have passed
// This function only maintains DB state for stats display, it does NOT block requests
const checkAndResetRateLimit = async () => {
	try {
		const state = await RateLimitState.getState();
		const now = new Date();
		
		let shouldReset = false;
		const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
		
		// Check if 24 hours have passed since windowStartTime (time-based reset)
		if (state.windowStartTime) {
			const timeSinceWindowStart = now.getTime() - state.windowStartTime.getTime();
			if (timeSinceWindowStart >= twentyFourHours) {
				shouldReset = true;
				console.log('24-hour window has passed, resetting successfulTweetsCount and starting new window');
			}
		}
		
		// Check if resetAt time has passed (error-based reset)
		if (state.resetAt && now >= state.resetAt) {
			shouldReset = true;
			console.log('Rate limit reset time has passed, resetting remaining count');
		}
		
		// Perform reset if either condition is met
		if (shouldReset) {
			state.successfulTweetsCount = 0;
			state.remaining = state.limit; // Reset to full limit
			state.windowStartTime = now; // Start new window
			// Calculate new resetAt based on new windowStartTime
			state.resetAt = new Date(now.getTime() + twentyFourHours);
			state.lastUpdated = now;
			await state.save();
		}
	} catch (error) {
		console.error('Error checking and resetting rate limit:', error.message);
	}
};

const getRateLimitState = async () => {
	try {
		// Check and reset rate limit state if 24 hours have passed (for stats display)
		await checkAndResetRateLimit();
		
		const state = await RateLimitState.getState();
		return {
			limit: state.limit,
			remaining: state.remaining,
			resetAt: state.resetAt ? state.resetAt.toISOString() : null,
			lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
			successfulTweetsCount: state.successfulTweetsCount || 0,
			windowStartTime: state.windowStartTime ? state.windowStartTime.toISOString() : null,
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
			windowStartTime: null,
			lastErrorOccurredAt: null
		};
	}
};

const loadSaleModeState = async () => {
	try {
		const state = await SaleModeState.getState();
		// Update CONFIG.IS_SALE_MODE with value from DB
		// If DB state is null/undefined, fall back to env var
		if (state.isSaleMode !== undefined && state.isSaleMode !== null) {
			CONFIG.IS_SALE_MODE = state.isSaleMode;
		} else {
			// Fallback to environment variable if DB doesn't have a value
			CONFIG.IS_SALE_MODE = process.env.IS_SALE_MODE === 'true';
			// Save the env var value to DB for future use
			if (process.env.IS_SALE_MODE !== undefined) {
				state.isSaleMode = CONFIG.IS_SALE_MODE;
				state.lastUpdated = new Date();
				await state.save();
			}
		}
		console.log(`Loaded sale mode state from MongoDB: ${CONFIG.IS_SALE_MODE ? 'ON' : 'OFF'}`);
	} catch (error) {
		console.error('Error loading sale mode state:', error.message);
		// Fallback to environment variable on error
		CONFIG.IS_SALE_MODE = process.env.IS_SALE_MODE === 'true';
	}
};

const getSaleModeState = async () => {
	try {
		const state = await SaleModeState.getState();
		return {
			isSaleMode: state.isSaleMode,
			lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null
		};
	} catch (error) {
		console.error('Error getting sale mode state:', error.message);
		return {
			isSaleMode: CONFIG.IS_SALE_MODE,
			lastUpdated: null
		};
	}
};

const setSaleModeState = async (isEnabled) => {
	try {
		const state = await SaleModeState.getState();
		state.isSaleMode = isEnabled;
		state.lastUpdated = new Date();
		await state.save();
		// Update CONFIG in memory immediately
		CONFIG.IS_SALE_MODE = isEnabled;
		console.log(`Sale mode updated to: ${isEnabled ? 'ON' : 'OFF'}`);
		return true;
	} catch (error) {
		console.error('Error setting sale mode state:', error.message);
		return false;
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
	checkAndResetRateLimit,
	loadSaleModeState,
	getSaleModeState,
	setSaleModeState,
};

