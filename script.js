require('dotenv').config();
const fs = require('fs').promises;
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');
const express = require('express');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const TelegramMessage = require('./models/TelegramMessage');

// Configuration constants
const CONFIG = {
	PORT: process.env.PORT || 3000,
	MESSAGE_PROCESSING_DELAY_MS: 7000,
	MESSAGE_RECENCY_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
	MAX_CONTENT_HASHES: 50, // Maximum number of content hashes to store
	MAX_PROCESSED_MESSAGE_IDS: 10, // Maximum number of processed message IDs to store
	TWEET_MAX_LENGTH: 280, // Maximum length of a tweet
	POST_PROCESSING_DELAY_MS: 300, // Delay after posting a tweet
	MIN_CONTEXT_LENGTH: 30, // Minimum length of a context
	LOW_CONTEXT_LENGTH: 60, // Minimum length of a low-context message
	MONGODB_CONNECTION_OPTIONS: {
		maxPoolSize: 10,
		serverSelectionTimeoutMS: 5000,
		retryWrites: true,
	},
};

const IS_SALE_MODE = process.env.IS_SALE_MODE === 'true';

// Pre-compiled regex patterns
const REGEX_PATTERNS = {
	amazonLink: /(https?:\/\/)?(www\.)?(amazon\.[a-z]{2,}|amzn\.to)\/[^\s]*/gi,
	httpLink: /https?:\/\/\S+/g,
	telegramLink: /https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
	trtPremium: /TRT Premium Deals/g,
	whitespace: /\s+/g,
};

// Pre-compiled profitable product regex patterns
const PROFITABLE_KEYWORDS = [
	'tv', 'tvs', '4ktvs', '4k', 'laptop', 'washing machine', 'ai', 'kg',
	'12 kg', '9 kg', '7 kg', '8 kg', '6.5 kg', '10 kg', '8.5 kg',
	'front load', 'top load', 'air conditioner', 'ac', 'acs', 'ton',
	'refrigerator', '653 l', 'single door', 'double door', 'triple door',
	'side by side', 'intel', 'core', 'ryzen', 'bravia',
];

const PROFITABLE_PRODUCT_REGEXES = PROFITABLE_KEYWORDS.map(
	keyword => new RegExp(`\\b${keyword}\\b`, 'i')
);

const LOW_CONTEXT_KEYWORDS = ['loot', 'deal', 'link', 'fast', 'price drop'];

const PORT = CONFIG.PORT;

// JSON file paths
const PROCESSED_MESSAGES_FILE = './processedMessages.json';
const RATE_LIMIT_STATE_FILE = './rateLimitState.json';

// Store rate limit information (loaded from JSON)
let rateLimitState = {
	limit: null,
	remaining: null,
	resetAt: null,
	lastUpdated: null,
	successfulTweetsCount: 0,
	lastErrorOccurredAt: null
};

// Use Set for O(1) hash lookups instead of array
const contentHashes = new Set();

// JSON Storage Helper Functions
const loadProcessedMessageIds = async () => {
	try {
		const data = await fs.readFile(PROCESSED_MESSAGES_FILE, 'utf-8');
		const parsed = JSON.parse(data);
		return parsed.messageIds || [];
	} catch (error) {
		if (error.code === 'ENOENT') {
			// File doesn't exist, return empty array
			return [];
		}
		console.error('Error loading processed message IDs:', error.message);
		return [];
	}
};

const saveProcessedMessageIds = async (messageIds) => {
	try {
		// Keep only last 10 messageIds
		const last10 = messageIds.slice(-CONFIG.MAX_PROCESSED_MESSAGE_IDS);
		const data = { messageIds: last10 };
		await fs.writeFile(PROCESSED_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf-8');
	} catch (error) {
		console.error('Error saving processed message IDs:', error.message);
	}
};

const isMessagePostedToTwitter = async (messageId) => {
	try {
		const messageIds = await loadProcessedMessageIds();
		return messageIds.includes(messageId);
	} catch (error) {
		console.error('Error checking if message was posted:', error.message);
		return false; // On error, assume not posted to avoid skipping
	}
};

const addMessageToProcessed = async (messageId) => {
	try {
		const messageIds = await loadProcessedMessageIds();
		// Remove if already exists (to avoid duplicates)
		const filtered = messageIds.filter(id => id !== messageId);
		// Add to end
		filtered.push(messageId);
		await saveProcessedMessageIds(filtered);
	} catch (error) {
		console.error('Error adding message to processed list:', error.message);
	}
};

const loadRateLimitState = async () => {
	try {
		const data = await fs.readFile(RATE_LIMIT_STATE_FILE, 'utf-8');
		const parsed = JSON.parse(data);
		rateLimitState = {
			limit: parsed.limit || null,
			remaining: parsed.remaining !== undefined ? parsed.remaining : null,
			resetAt: parsed.resetAt || null,
			lastUpdated: parsed.lastUpdated || null,
			successfulTweetsCount: parsed.successfulTweetsCount || 0,
			lastErrorOccurredAt: parsed.lastErrorOccurredAt || null
		};
		console.log('Loaded rate limit state from JSON');
	} catch (error) {
		if (error.code === 'ENOENT') {
			// File doesn't exist, use defaults
			console.log('Rate limit state file not found, using defaults');
		} else {
			console.error('Error loading rate limit state:', error.message);
		}
	}
};

const saveRateLimitState = async () => {
	try {
		rateLimitState.lastUpdated = new Date().toISOString();
		await fs.writeFile(RATE_LIMIT_STATE_FILE, JSON.stringify(rateLimitState, null, 2), 'utf-8');
	} catch (error) {
		console.error('Error saving rate limit state:', error.message);
	}
};

const incrementSuccessfulTweetCount = async () => {
	rateLimitState.successfulTweetsCount = (rateLimitState.successfulTweetsCount || 0) + 1;
	if (rateLimitState.limit !== null) {
		rateLimitState.remaining = Math.max(0, rateLimitState.remaining - 1);
	}
	await saveRateLimitState();
};

const handleRateLimitError = async (error) => {
	if (error.code === 429 && error.headers) {
		const userLimit = error.headers['x-user-limit-24hour-limit'];
		const userRemaining = error.headers['x-user-limit-24hour-remaining'];
		const userReset = error.headers['x-user-limit-24hour-reset'];

		const userResetDate = new Date(Number(userReset) * 1000);
		
		// Store rate limit info from error
		rateLimitState = {
			limit: userLimit ? parseInt(userLimit) : rateLimitState.limit,
			remaining: userRemaining ? parseInt(userRemaining) : rateLimitState.remaining,
			resetAt: userResetDate.toISOString(),
			lastUpdated: new Date().toISOString(),
			successfulTweetsCount: rateLimitState.successfulTweetsCount || 0,
			lastErrorOccurredAt: new Date().toISOString()
		};
		
		await saveRateLimitState();
		
		console.log(`🔒 User Tweet Limit: ${rateLimitState.limit}, Remaining: ${rateLimitState.remaining}`);
		console.log(`🕒 User Limit Resets At: ${userResetDate.toString()}`);
		console.log('Skipping tweet posting due to rate limit.');
	}
};

// MongoDB connection with retry logic
const connectMongoDB = async () => {
	try {
		await mongoose.connect(process.env.MONGODB_URI, CONFIG.MONGODB_CONNECTION_OPTIONS);
		console.log('Connected to MongoDB');
	} catch (error) {
		console.error('Error connecting to MongoDB:', error);
		// Retry connection after 5 seconds
		setTimeout(connectMongoDB, 5000);
	}
};

// Initialize Express app
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
	let response = 'Bot is running!<br><br>';
	
	if (rateLimitState.limit !== null) {
		// Calculate real-time remaining: limit - successfulTweetsCount
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

// Initialize bot and Twitter client
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const twitterClient = new TwitterApi({
	appKey: process.env.TWITTER_API_KEY,
	appSecret: process.env.TWITTER_API_SECRET_KEY,
	accessToken: process.env.TWITTER_ACCESS_TOKEN,
	accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Check if we should proceed with Twitter API call based on rate limits
const canMakeTwitterRequest = () => {
	if (rateLimitState.limit === null) {
		return true; // No limit info available, proceed
	}
	
	// Calculate real-time remaining: limit - successfulTweetsCount
	const realTimeRemaining = rateLimitState.limit - (rateLimitState.successfulTweetsCount || 0);
	
	if (realTimeRemaining <= 0) {
		console.log(`Rate limit reached. Limit: ${rateLimitState.limit}, Posted: ${rateLimitState.successfulTweetsCount}, Remaining: ${realTimeRemaining}`);
		return false;
	}
	return true;
};

// Helper function to check if text contains Amazon links
function hasAmazonLinks(text) {
	if (!text) return false;
	return REGEX_PATTERNS.amazonLink.test(text);
}

// Input validation
const validateMessage = (message) => {
	if (!message) {
		throw new Error('Message is null or undefined');
	}
	if (!message.message_id) {
		throw new Error('Message ID is missing');
	}
	return true;
};

const isRecentMessage = (messageDate) => {
	if (!messageDate) return false;
	const messageTimestamp = messageDate * 1000;
	const currentTimestamp = Date.now();
	return currentTimestamp - messageTimestamp <= CONFIG.MESSAGE_RECENCY_THRESHOLD_MS;
};

// Link remover
const removeLinks = (text) => {
	if (!text) return '';
	return text.replace(REGEX_PATTERNS.httpLink, '');
};

const replaceLinksAndText = (text) => {
	if (!text) return '';
	return text
		.replace(REGEX_PATTERNS.telegramLink, 'https://t.me/deals24com')
		.replace(REGEX_PATTERNS.trtPremium, 'Deals24');
};

const normalizeMessage = (text) => {
	if (!text) return '';
	return removeLinks(text)
		.trim()
		.replace(REGEX_PATTERNS.whitespace, ' ')
		.toLowerCase();
};

const splitText = (text, maxLength) => {
	if (!text) return [];
	const words = text.split(' ');
	const chunks = [];
	let chunk = '';
	for (const word of words) {
		if (chunk.length + word.length + 1 <= maxLength) {
			chunk += (chunk ? ' ' : '') + word;
		} else {
			chunks.push(chunk);
			chunk = word;
		}
	}
	if (chunk) chunks.push(chunk);
	return chunks;
};

const calculateHash = (text) => {
	const normalizedText = normalizeMessage(text);
	return crypto.createHash('sha256').update(normalizedText).digest('hex');
};

const isLowContext = (text) => {
	if (!text) return true;
	const meaningfulText = removeLinks(text).trim();
	if (meaningfulText.length < CONFIG.MIN_CONTEXT_LENGTH) return true;
	const keywordMatch = LOW_CONTEXT_KEYWORDS.some((keyword) =>
		meaningfulText.toLowerCase().includes(keyword),
	);
	return keywordMatch && meaningfulText.length < CONFIG.LOW_CONTEXT_LENGTH;
};

const isProfitableProduct = (text) => {
	if (!text) return false;
	return PROFITABLE_PRODUCT_REGEXES.some(regex => regex.test(text));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to get text from database using messageId with projection for optimization
const getMessageTextById = async (messageId) => {
	if (!messageId) {
		console.error('getMessageTextById: messageId is required');
		return null;
	}
	try {
		const message = await TelegramMessage.findOne(
			{ messageId: messageId },
			{ text: 1 } // Projection: only fetch text field
		);
		if (!message) {
			return null;
		}
		return message.text;
	} catch (error) {
		console.error('Error retrieving message text:', error.message);
		return null; // Return null instead of throwing to prevent crashes
	}
};


// Helper to get highest-quality image from photo array
const getHighestQualityPhoto = (photos) => {
	if (!photos || photos.length === 0) return null;
	return photos.reduce(
		(max, p) => (p.file_size > max.file_size ? p : max),
		photos[0],
	);
};

// Download file from Telegram with improved error handling
const downloadTelegramFile = async (fileId, botToken) => {
	if (!fileId || !botToken) {
		console.error('downloadTelegramFile: fileId and botToken are required');
		return null;
	}
	
	try {
		const fileInfoResponse = await fetch(
			`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
		);
		
		if (!fileInfoResponse.ok) {
			console.error(`Telegram API error: ${fileInfoResponse.status} ${fileInfoResponse.statusText}`);
			return null;
		}
		
		const fileData = await fileInfoResponse.json();
		
		if (!fileData.ok || !fileData.result || !fileData.result.file_path) {
			console.error('Invalid file data from Telegram API:', fileData);
			return null;
		}
		
		const filePath = fileData.result.file_path;
		const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
		const response = await fetch(fileUrl);
		
		if (!response.ok) {
			console.error(`Failed to download file: ${response.status} ${response.statusText}`);
			return null;
		}
		
		return Buffer.from(await response.arrayBuffer());
	} catch (error) {
		console.error('Error downloading image from Telegram:', error.message);
		console.error('Stack trace:', error.stack);
		return null;
	}
};

// Standardized error logging
const logError = (context, error, additionalInfo = {}) => {
	const errorLog = {
		timestamp: new Date().toISOString(),
		context,
		message: error.message || String(error),
		stack: error.stack,
		...additionalInfo
	};
	console.error(`[ERROR] ${context}:`, JSON.stringify(errorLog, null, 2));
};

// Message listener
bot.on('channel_post', async (ctx) => {
	try {
		const message = ctx.channelPost;
		
		// Input validation
		try {
			validateMessage(message);
		} catch (validationError) {
			logError('Message validation', validationError);
			return;
		}
		
		const messageId = message.message_id.toString();
		const textContent = message.caption || message.text;
		
		if (!textContent) {
			console.log('Skipping message without text content');
			return;
		}

		// FIRST: Check if messageId was already posted to Twitter (preserve 17 tweets/day limit)
		const alreadyPosted = await isMessagePostedToTwitter(messageId);
		if (alreadyPosted) {
			console.log('Skipping message already posted to Twitter:', messageId);
			return;
		}

		// Wait before proceeding
		console.log(`Waiting ${CONFIG.MESSAGE_PROCESSING_DELAY_MS / 1000} seconds before processing message...`);
		await delay(CONFIG.MESSAGE_PROCESSING_DELAY_MS);
		console.log(`${CONFIG.MESSAGE_PROCESSING_DELAY_MS / 1000} seconds passed`);

		// Check if message is recent
		if (!isRecentMessage(message.date)) {
			console.log('Skipping old message:', textContent.substring(0, 100));
			return;
		}

		// Check for duplicate content using Set (O(1) lookup)
		const messageHash = calculateHash(textContent);
		if (contentHashes.has(messageHash)) {
			console.log('Skipping duplicate content.');
			return;
		}

		// Filter low-context messages
		if (isLowContext(textContent)) {
			console.log('Skipping low-context message:', textContent.substring(0, 100));
			return;
		}

		// Check sale mode filter
		if (IS_SALE_MODE && !isProfitableProduct(textContent)) {
			console.log('Skipping non-profitable product in sale mode:', textContent.substring(0, 100));
			return;
		}

		// Add hash to Set (automatically handles size limit with Set)
		contentHashes.add(messageHash);
		if (contentHashes.size > CONFIG.MAX_CONTENT_HASHES) {
			// Remove oldest entry (convert to array, remove first, recreate Set)
			const hashArray = Array.from(contentHashes);
			hashArray.shift();
			contentHashes.clear();
			hashArray.forEach(hash => contentHashes.add(hash));
		}

		// Check DB for better caption text (only for caption, not for posting check)
		const retrievedText = await getMessageTextById(messageId);
		
		// Process caption - use DB text if available (better caption), otherwise use Telegram text
		const processedCaption = replaceLinksAndText(retrievedText || textContent);
		const captionWithHashtag = processedCaption + '\n\n#Deals24';
		
		let finalCaption = captionWithHashtag;
		if (retrievedText) {
			console.log('Using better caption from DB:', retrievedText.substring(0, 100));
		} else {
			console.log('No text found in DB for messageId, using Telegram text:', messageId);
		}

		const captionChunks = splitText(finalCaption, CONFIG.TWEET_MAX_LENGTH);

		// Check rate limits before making API calls
		if (!canMakeTwitterRequest()) {
			console.log('Rate limit reached, skipping tweet posting');
			return;
		}

		try {
			let tweetResponse;

			// Check if message has Amazon links - skip image logic if it does
			const hasAmazonLink = hasAmazonLinks(retrievedText || textContent);
			
			// Image logic - skip if Amazon links are present
			if (!hasAmazonLink && message.photo && message.photo.length > 0) {
				const bestPhoto = getHighestQualityPhoto(message.photo);
				if (bestPhoto) {
					const imageBuffer = await downloadTelegramFile(
						bestPhoto.file_id,
						process.env.TELEGRAM_BOT_TOKEN,
					);
					if (imageBuffer) {
						const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
							type: 'photo',
						});
						tweetResponse = await twitterClient.v2.tweet({
							text: captionChunks[0],
							media: { media_ids: [mediaId] },
						});
					} else {
						console.log('Failed to download image, posting text only.');
						tweetResponse = await twitterClient.v2.tweet(captionChunks[0]);
					}
				} else {
					console.log('No valid photo found, posting text only.');
					tweetResponse = await twitterClient.v2.tweet(captionChunks[0]);
				}
			} else {
				if (hasAmazonLink) {
					console.log('Amazon links detected, posting text only without image.');
				}
				tweetResponse = await twitterClient.v2.tweet(captionChunks[0]);
			}

			// Only post replies if the initial tweet was successful
			if (tweetResponse && tweetResponse.data) {
				for (let i = 1; i < captionChunks.length; i++) {
					// Check rate limit before each reply
					if (!canMakeTwitterRequest()) {
						console.log('Rate limit reached while posting replies, stopping');
						break;
					}
					tweetResponse = await twitterClient.v2.reply(
						captionChunks[i],
						tweetResponse.data.id,
					);
				}
				
				// After successful tweet: add messageId to processed list and update rate limit
				await addMessageToProcessed(messageId);
				await incrementSuccessfulTweetCount();
				console.log('Tweet posted successfully!');
			} else {
				console.log('Initial tweet failed, skipping reply tweets.');
			}
		} catch (error) {
			if (error.code === 429 && error.headers) {
				// Handle rate limit error - store limit info from headers
				await handleRateLimitError(error);
			} else {
				logError('Tweet posting', error, { messageId, textContent: textContent.substring(0, 100) });
			}
		}

		console.log('Message processing completed.');
		await delay(CONFIG.POST_PROCESSING_DELAY_MS);
	} catch (error) {
		logError('Channel post handler', error);
	}
});

// Webhook endpoint for Telegram
app.post('/api/webhook', async (req, res) => {
	try {
		await bot.handleUpdate(req.body);
		res.sendStatus(200);
	} catch (error) {
		logError('Webhook handler', error);
		res.sendStatus(500);
	}
});

// Start Express server
app.listen(PORT, async () => {
	console.log(`Server running on port ${PORT}`);
	
	// Load rate limit state and connect to MongoDB on startup
	await loadRateLimitState();
	connectMongoDB();
	
	// Set webhook URL
	const webhookUrl = 'https://tele-x-fusion-main.onrender.com/api/webhook';
	try {
		// Delete any existing webhook first to avoid conflicts
		await bot.telegram.deleteWebhook({ drop_pending_updates: true });
		
		// Set the new webhook
		await bot.telegram.setWebhook(webhookUrl, {
			drop_pending_updates: true
		});
		console.log(`Webhook set to: ${webhookUrl}`);
		
		// Verify webhook info
		const webhookInfo = await bot.telegram.getWebhookInfo();
		console.log('Webhook info:', JSON.stringify(webhookInfo, null, 2));
	} catch (error) {
		// 409 errors are expected when switching from polling to webhook
		if (error.response?.error_code === 409) {
			console.log('Webhook conflict resolved (this is normal when switching from polling)');
			// Try setting webhook again after a brief delay
			setTimeout(async () => {
				try {
					await bot.telegram.setWebhook(webhookUrl, {
						drop_pending_updates: true
					});
					console.log(`Webhook successfully set to: ${webhookUrl}`);
				} catch (retryError) {
					console.error('Error setting webhook on retry:', retryError.message);
				}
			}, 2000);
		} else {
			logError('Webhook setup', error);
			console.log('Continuing without webhook setup...');
		}
	}
});

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitState();
	try {
		await bot.telegram.deleteWebhook();
		console.log('Webhook deleted');
	} catch (error) {
		console.error('Error deleting webhook:', error.message);
	}
	mongoose.connection.close();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitState();
	try {
		await bot.telegram.deleteWebhook();
		console.log('Webhook deleted');
	} catch (error) {
		console.error('Error deleting webhook:', error.message);
	}
	mongoose.connection.close();
	process.exit(0);
});
