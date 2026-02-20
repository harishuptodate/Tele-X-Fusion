const express = require('express');
const { getRateLimitState, getSaleModeState, setSaleModeState } = require('../services/storageService');
const { handleChannelPost } = require('../handlers/channelPostHandler');
const CONFIG = require('../config');

const router = express.Router();

// Helper function to format date in IST (DD/MM/YYYY HH:MM:SS)
const formatISTDate = (dateString) => {
	if (!dateString) return '';
	const date = new Date(dateString);
	
	// Convert to IST using toLocaleString with Asia/Kolkata timezone
	const istString = date.toLocaleString('en-GB', { 
		timeZone: 'Asia/Kolkata',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	
	// Format: DD/MM/YYYY HH:MM:SS
	// toLocaleString returns format like "DD/MM/YYYY, HH:MM:SS", so we need to replace comma
	return istString.replace(', ', ' ');
};

// Health check route
router.get('/', async (req, res) => {
	const rateLimitState = await getRateLimitState();
	const saleModeState = await getSaleModeState();
	const isSaleMode = saleModeState.isSaleMode;
	const saleModeStatus = isSaleMode ? 'ON' : 'OFF';
	const saleModeColor = isSaleMode ? '#28a745' : '#dc3545';
	const saleModeEmoji = isSaleMode ? '🟢' : '🔴';
	
	let rateLimitInfo = '';
	const hasAnyData = rateLimitState.limit !== null || 
	                   rateLimitState.remaining !== null || 
	                   rateLimitState.resetAt !== null ||
	                   rateLimitState.lastErrorOccurredAt !== null ||
	                   rateLimitState.lastUpdated !== null;
	
	if (hasAnyData) {
		if (rateLimitState.limit !== null) {
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">🔒 Total Tweet Limit:</span>
				<span class="value">${rateLimitState.limit}</span>
			</div>`;
		}
		
		rateLimitInfo += `
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
		
		// Always show Limit Resets At
		let resetDisplay = '';
		if (rateLimitState.resetAt) {
			const resetDate = new Date(rateLimitState.resetAt);
			const now = new Date();
			const timeUntilReset = resetDate.getTime() - now.getTime();
			const isExpired = timeUntilReset <= 0;
			
			resetDisplay = formatISTDate(rateLimitState.resetAt);
			if (!isExpired) {
				const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
				const minutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));
				resetDisplay += ` (in ${hours}h ${minutes}m)`;
			} else {
				resetDisplay += ' (EXPIRED - should reset soon)';
			}
		} else {
			// Show "limit not yet reached" when resetAt is null
			resetDisplay = 'limit not yet reached';
		}
		
		rateLimitInfo += `
			<div class="info-item">
				<span class="label">🕒 Limit Resets At:</span>
				<span class="value">${resetDisplay}</span>
			</div>`;
		
		if (rateLimitState.lastErrorOccurredAt) {
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">⚠️ Last Rate Limit Error:</span>
				<span class="value">${formatISTDate(rateLimitState.lastErrorOccurredAt)}</span>
			</div>`;
		}
		
		if (rateLimitState.lastUpdated) {
			rateLimitInfo += `
			<div class="info-item">
				<span class="label">🔄 Last Updated:</span>
				<span class="value">${formatISTDate(rateLimitState.lastUpdated)}</span>
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
			display: flex;
			align-items: center;
			justify-content: space-between;
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
		
		.status-text {
			flex: 1;
			text-align: center;
		}
		
		.toggle-button {
			background: rgba(255, 255, 255, 0.3);
			border: 2px solid white;
			color: white;
			padding: 8px 20px;
			border-radius: 20px;
			cursor: pointer;
			font-size: 1rem;
			font-weight: 600;
			transition: all 0.3s ease;
			margin-left: 15px;
		}
		
		.toggle-button:hover {
			background: rgba(255, 255, 255, 0.5);
			transform: scale(1.05);
		}
		
		.toggle-button:active {
			transform: scale(0.95);
		}
		
		.toggle-button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
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
		<div class="status-badge" id="saleModeBadge">
			<span class="status-text">${saleModeEmoji} Sale Mode: ${saleModeStatus}</span>
			<button class="toggle-button" id="toggleButton" onclick="toggleSaleMode()">Toggle</button>
		</div>
		<div class="info-section">
			${rateLimitInfo}
		</div>
	</div>
	<script>
		async function toggleSaleMode() {
			const button = document.getElementById('toggleButton');
			const badge = document.getElementById('saleModeBadge');
			const statusText = badge.querySelector('.status-text');
			
			button.disabled = true;
			button.textContent = 'Updating...';
			
			try {
				const response = await fetch('/api/sale-mode/toggle', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					}
				});
				
				const data = await response.json();
				
				if (response.ok && data.success) {
					// Update UI
					const isOn = data.isSaleMode;
					statusText.textContent = (isOn ? '🟢' : '🔴') + ' Sale Mode: ' + (isOn ? 'ON' : 'OFF');
					badge.style.background = isOn ? '#28a745' : '#dc3545';
				} else {
					alert('Failed to toggle sale mode: ' + (data.error || 'Unknown error'));
				}
			} catch (error) {
				console.error('Error toggling sale mode:', error);
				alert('Error toggling sale mode. Please try again.');
			} finally {
				button.disabled = false;
				button.textContent = 'Toggle';
			}
		}
	</script>
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

// Toggle sale mode endpoint
router.post('/api/sale-mode/toggle', async (req, res) => {
	try {
		const currentState = await getSaleModeState();
		const newState = !currentState.isSaleMode;
		
		const success = await setSaleModeState(newState);
		
		if (success) {
			res.json({
				success: true,
				isSaleMode: newState,
				message: `Sale mode ${newState ? 'enabled' : 'disabled'}`
			});
		} else {
			res.status(500).json({
				success: false,
				error: 'Failed to update sale mode state'
			});
		}
	} catch (error) {
		console.error('Error toggling sale mode:', error);
		res.status(500).json({
			success: false,
			error: error.message || 'Internal server error'
		});
	}
});

module.exports = router;

