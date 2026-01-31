const mongoose = require('mongoose');

const rateLimitStateSchema = new mongoose.Schema({
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
	successfulTweetsCount: {
		type: Number,
		default: 0
	},
	lastErrorOccurredAt: {
		type: Date,
		default: null
	},
	lastUpdated: {
		type: Date,
		default: Date.now
	}
}, {
	collection: 'ratelimitstate'
});

// Ensure only one document exists
rateLimitStateSchema.statics.getState = async function() {
	let state = await this.findOne();
	if (!state) {
		state = await this.create({});
	}
	return state;
};

const RateLimitState = mongoose.model('RateLimitState', rateLimitStateSchema);

module.exports = RateLimitState;

