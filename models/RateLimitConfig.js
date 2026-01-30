const mongoose = require('mongoose');

const rateLimitConfigSchema = new mongoose.Schema({
	limit: {
		type: Number,
		default: null
	},
	remaining: {
		type: Number,
		default: null
	},
	resetAt: {
		type: Date,
		default: null
	},
	lastUpdated: {
		type: Date,
		default: Date.now
	}
}, {
	collection: 'ratelimitconfig',
	// Only allow one document in this collection
	strict: false
});

// Index for faster queries
rateLimitConfigSchema.index({ lastUpdated: -1 });

const RateLimitConfig = mongoose.model('RateLimitConfig', rateLimitConfigSchema);

module.exports = RateLimitConfig;

