const CONFIG = require('../config');
const ProcessedMessage = require('../models/ProcessedMessage');
const SaleModeState = require('../models/SaleModeState');
const { outboundRateLimitService, rateLimitRepository } = require('../rate-limit');

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
		await rateLimitRepository.getState();
		console.log('Loaded rate limit state from MongoDB');
	} catch (error) {
		console.error('Error loading rate limit state:', error.message);
	}
};

const saveRateLimitState = async (stateData) => {
	try {
		const state = await rateLimitRepository.getState();
		await rateLimitRepository.saveState(state, stateData);
	} catch (error) {
		console.error('Error saving rate limit state:', error.message);
	}
};

const incrementSuccessfulTweetCount = async () => {
	try {
		await outboundRateLimitService.recordSuccess();
	} catch (error) {
		console.error('Error incrementing successful tweet count:', error.message);
	}
};

const handleRateLimitError = async (error) => {
	try {
		const updated = await outboundRateLimitService.recordRateLimitError(error);
		if (!updated) return;
		const state = await rateLimitRepository.getState();
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
		const state = await rateLimitRepository.getState();
		await outboundRateLimitService.ensureWindowReset(state);
	} catch (error) {
		console.error('Error checking and resetting rate limit:', error.message);
	}
};

const getRateLimitState = async () => {
	try {
		return await outboundRateLimitService.getRateLimitState();
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

