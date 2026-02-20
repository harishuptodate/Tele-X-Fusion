require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const CONFIG = require('./config');
const routes = require('./routes');
const { initTelegramBot } = require('./bot/telegramBot');
const {
	loadRateLimitState,
	loadSaleModeState,
} = require('./services/storageService');

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/', routes);

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI, CONFIG.MONGODB_CONNECTION_OPTIONS)
	.then(async () => {
		console.log('Connected to MongoDB');
		
		// Load rate limit state
		await loadRateLimitState();
		
		// Load sale mode state
		await loadSaleModeState();
		
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
