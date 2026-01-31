const mongoose = require('mongoose');

const processedMessageSchema = new mongoose.Schema({
	messageId: {
		type: String,
		required: true,
		unique: true
	},
	createdAt: {
		type: Date,
		default: Date.now
	}
});

// Index for faster queries and automatic cleanup
processedMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // Auto-delete after 24 hours

const ProcessedMessage = mongoose.model('ProcessedMessage', processedMessageSchema);

module.exports = ProcessedMessage;

