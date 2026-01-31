const express = require('express');
const { getRateLimitState } = require('../services/storageService');
const { handleChannelPost } = require('../handlers/channelPostHandler');

const router = express.Router();

// Health check route
router.get('/', (req, res) => {
	let response = 'Bot is running!<br><br>';
	const rateLimitState = getRateLimitState();
	
	if (rateLimitState.limit !== null) {
		const realTimeRemaining = rateLimitState.limit - (rateLimitState.successfulTweetsCount || 0);
		
		response += `🔒 Total Tweet Limit: ${rateLimitState.limit}<br>`;
		response += `✅ Successful Tweets Today: ${rateLimitState.successfulTweetsCount || 0}<br>`;
		response += `📊 Real-Time Remaining: ${realTimeRemaining}<br>`;
		
		if (rateLimitState.resetAt) {
			const resetDate = new Date(rateLimitState.resetAt);
			response += `🕒 Limit Resets At: ${resetDate.toLocaleString()}<br>`;
		}
		
		if (rateLimitState.lastErrorOccurredAt) {
			const errorDate = new Date(rateLimitState.lastErrorOccurredAt);
			response += `⚠️ Last Rate Limit Error: ${errorDate.toLocaleString()}<br>`;
		}
		
		if (rateLimitState.lastUpdated) {
			response += `🔄 Last Updated: ${new Date(rateLimitState.lastUpdated).toLocaleString()}`;
		}
	} else {
		response += 'Rate limit information not available yet.<br>';
		response += 'Waiting for first rate limit error or successful tweet.';
	}
	
	res.send(response);
});

// Webhook endpoint for Telegram
router.post('/webhook', async (req, res) => {
	try {
		console.log('=== WEBHOOK REQUEST RECEIVED ===');
		console.log('Body:', JSON.stringify(req.body, null, 2));
		
		const update = req.body;
		
		// Check if this is a channel_post update
		if (update.channel_post || update.channelPost) {
			await handleChannelPost(update);
		} else {
			console.log('Update is not a channel_post, ignoring');
		}
		
		console.log('Webhook processed successfully');
		res.sendStatus(200);
	} catch (error) {
		console.error('Error processing webhook:', error);
		const { logError } = require('../utils/logger');
		logError('Webhook handler', error);
		res.sendStatus(200);
	}
});

// GET request handler for webhook endpoint
router.get('/webhook', (req, res) => {
	console.log('GET request to webhook endpoint');
	res.json({ 
		status: 'Webhook endpoint is active',
		method: 'GET',
		timestamp: new Date().toISOString()
	});
});

// Test endpoint
router.get('/webhook/test', (req, res) => {
	res.json({ 
		status: 'Webhook endpoint is reachable',
		timestamp: new Date().toISOString()
	});
});

module.exports = router;

