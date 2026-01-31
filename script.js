require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const CONFIG = require('./config');
const routes = require('./routes');
const { initTelegramBot } = require('./bot/telegramBot');
const {
	loadRateLimitState,
	saveRateLimitState,
} = require('./services/storageService');

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/api', routes);

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI, CONFIG.MONGODB_CONNECTION_OPTIONS)
	.then(() => {
		console.log('Connected to MongoDB');
		
		// Load rate limit state
		loadRateLimitState();
		
		// Start the server
		app.listen(CONFIG.PORT, () => {
			console.log(`Server running on port ${CONFIG.PORT}`);
		});
		
		// Initialize Telegram bot if token exists
		initTelegramBot();
	})
	.catch((err) => {
		console.error('Failed to connect to MongoDB', err);
		process.exit(1);
	});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitState();
	const { getBot } = require('./bot/telegramBot');
	const bot = getBot();
	if (bot) {
		bot.stop('SIGINT');
	}
	mongoose.connection.close();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitState();
	const { getBot } = require('./bot/telegramBot');
	const bot = getBot();
	if (bot) {
		bot.stop('SIGTERM');
	}
	mongoose.connection.close();
	process.exit(0);
});
