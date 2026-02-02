const express = require('express');
const { getRateLimitState } = require('../services/storageService');
const { handleChannelPost } = require('../handlers/channelPostHandler');
const CONFIG = require('../config');

const router = express.Router();

// Health check route
router.get('/', async (req, res) => {
	const rateLimitState = await getRateLimitState();
	const saleModeStatus = CONFIG.IS_SALE_MODE ? 'ON' : 'OFF';
	const saleModeColor = CONFIG.IS_SALE_MODE ? '#28a745' : '#dc3545';
	const saleModeEmoji = CONFIG.IS_SALE_MODE ? '🟢' : '🔴';
	
	let rateLimitInfo = '';
	if (rateLimitState.limit !== null) {
		rateLimitInfo += `
			<div class="info-item">
				<span class="label">🔒 Total Tweet Limit:</span>
				<span class="value">${rateLimitState.limit}</span>
			</div>
			<div class="info-item">
				<span class="label">✅ Successful Tweets Today:</span>
				<span class="value">${rateLimitState.successfulTweetsCount || 0}</span>
			</div>`;
		
		if (rateLimitState.remaining !== null) {
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">📊 Remaining:</span>
				<span class="value">${rateLimitState.remaining}</span>
			</div>`;
		}
		
		if (rateLimitState.resetAt) {
			const resetDate = new Date(rateLimitState.resetAt);
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">🕒 Limit Resets At:</span>
				<span class="value">${resetDate.toLocaleString()}</span>
			</div>`;
		}
		
		if (rateLimitState.lastErrorOccurredAt) {
			const errorDate = new Date(rateLimitState.lastErrorOccurredAt);
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">⚠️ Last Rate Limit Error:</span>
				<span class="value">${errorDate.toLocaleString()}</span>
			</div>`;
		}
		
		if (rateLimitState.lastUpdated) {
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">🔄 Last Updated:</span>
				<span class="value">${new Date(rateLimitState.lastUpdated).toLocaleString()}</span>
			</div>`;
		}
	} else {
		rateLimitInfo = '<p class="no-data">Rate limit information not available yet.<br>Waiting for first rate limit error or successful tweet.</p>';
	}
	
	const html = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Tele-X-Fusion Bot Status</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			justify-content: center;
			align-items: center;
			padding: 20px;
		}
		
		.container {
			background: white;
			border-radius: 20px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
			padding: 40px;
			max-width: 800px;
			width: 100%;
		}
		
		h1 {
			font-size: 2.5rem;
			color: #333;
			text-align: center;
			margin-bottom: 30px;
			font-weight: 700;
		}
		
		.status-badge {
			display: inline-block;
			background: ${saleModeColor};
			color: white;
			padding: 12px 24px;
			border-radius: 25px;
			font-size: 1.2rem;
			font-weight: 600;
			margin-bottom: 30px;
			text-align: center;
			width: 100%;
		}
		
		.info-section {
			margin-top: 30px;
		}
		
		.info-item {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 15px 0;
			border-bottom: 1px solid #eee;
		}
		
		.info-item:last-child {
			border-bottom: none;
		}
		
		.label {
			font-size: 1.1rem;
			color: #666;
			font-weight: 500;
		}
		
		.value {
			font-size: 1.2rem;
			color: #333;
			font-weight: 700;
		}
		
		.no-data {
			text-align: center;
			color: #999;
			font-size: 1.1rem;
			padding: 20px 0;
		}
		
		@media (max-width: 600px) {
			h1 {
				font-size: 2rem;
			}
			
			.container {
				padding: 20px;
			}
			
			.info-item {
				flex-direction: column;
				align-items: flex-start;
				gap: 5px;
			}
			
			.value {
				font-size: 1.1rem;
			}
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>🤖 Tele-X-Fusion Bot</h1>
		<div class="status-badge">
			${saleModeEmoji} Sale Mode: ${saleModeStatus}
		</div>
		<div class="info-section">
			${rateLimitInfo}
		</div>
	</div>
</body>
</html>`;
	
	res.send(html);
});

// Webhook endpoint for Telegram
router.post('/webhook', async (req, res) => {
	try {
		console.log('=== WEBHOOK REQUEST RECEIVED ===');
		
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

module.exports = router;

