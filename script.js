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
	MESSAGE_RECENCY_THRESHOLD_MS: 5 * 60 * 1000,
	MAX_CONTENT_HASHES: 50,
	MAX_PROCESSED_MESSAGE_IDS: 10,
	TWEET_MAX_LENGTH: 280,
	POST_PROCESSING_DELAY_MS: 300,
	MIN_CONTEXT_LENGTH: 30,
	LOW_CONTEXT_LENGTH: 60,
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

// Initialize Express app
const app = express();
const PORT = CONFIG.PORT;

// Store rate limit information (will be persisted)
let rateLimitInfo = {
	limit: null,
	remaining: null,
	resetAt: null,
	lastUpdated: null
};

// Use Set for O(1) hash lookups instead of array
const contentHashes = new Set();

// MongoDB connection with retry logic
const connectMongoDB = async () => {
	try {
		await mongoose.connect(process.env.MONGODB_URI, CONFIG.MONGODB_CONNECTION_OPTIONS);
		console.log('Connected to MongoDB');
		
		// Load rate limit info from database on startup
		await loadRateLimitInfo();
	} catch (error) {
		console.error('Error connecting to MongoDB:', error);
		// Retry connection after 5 seconds
		setTimeout(connectMongoDB, 5000);
	}
};

// Load rate limit info from database
const loadRateLimitInfo = async () => {
	try {
		// Try to load from a simple document (we'll create a simple config collection)
		const RateLimitConfig = mongoose.model('RateLimitConfig', new mongoose.Schema({
			limit: Number,
			remaining: Number,
			resetAt: Date,
			lastUpdated: Date
		}, { collection: 'ratelimitconfig' }));
		
		const config = await RateLimitConfig.findOne();
		if (config) {
			rateLimitInfo = {
				limit: config.limit,
				remaining: config.remaining,
				resetAt: config.resetAt ? config.resetAt.toString() : null,
				lastUpdated: config.lastUpdated ? config.lastUpdated.toISOString() : null
			};
			console.log('Loaded rate limit info from database');
		}
	} catch (error) {
		console.error('Error loading rate limit info:', error);
		// Non-critical, continue without it
	}
};

// Save rate limit info to database
const saveRateLimitInfo = async () => {
	try {
		const RateLimitConfig = mongoose.model('RateLimitConfig', new mongoose.Schema({
			limit: Number,
			remaining: Number,
			resetAt: Date,
			lastUpdated: Date
		}, { collection: 'ratelimitconfig' }));
		
		await RateLimitConfig.findOneAndUpdate(
			{},
			{
				limit: rateLimitInfo.limit,
				remaining: rateLimitInfo.remaining,
				resetAt: rateLimitInfo.resetAt ? new Date(rateLimitInfo.resetAt) : null,
				lastUpdated: new Date()
			},
			{ upsert: true, new: true }
		);
	} catch (error) {
		console.error('Error saving rate limit info:', error);
		// Non-critical, continue without saving
	}
};

// Health check endpoint
app.get('/', (req, res) => {
	let response = 'Bot is running!<br><br>';
	
	if (rateLimitInfo.limit !== null) {
		response += `🔒 User Tweet Limit: ${rateLimitInfo.limit}, Remaining: ${rateLimitInfo.remaining}<br>`;
		if (rateLimitInfo.resetAt) {
			response += `🕒 User Limit Resets At: ${rateLimitInfo.resetAt}<br>`;
		}
		if (rateLimitInfo.lastUpdated) {
			response += `Last Updated: ${rateLimitInfo.lastUpdated}`;
		}
	} else {
		response += 'Rate limit information not available yet.';
	}
	
	res.send(response);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
	if (rateLimitInfo.remaining === null || rateLimitInfo.remaining === undefined) {
		return true; // No info available, proceed
	}
	if (rateLimitInfo.remaining <= 0) {
		console.log('Rate limit reached, skipping Twitter API call');
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

// Check if message was already processed using MongoDB
const isMessageProcessed = async (messageId) => {
	try {
		const message = await TelegramMessage.findOne(
			{ messageId: messageId },
			{ _id: 1 } // Only check existence
		);
		return !!message;
	} catch (error) {
		console.error('Error checking if message is processed:', error.message);
		return false; // On error, assume not processed to avoid skipping messages
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

		// Check if message was already processed (using MongoDB)
		const alreadyProcessed = await isMessageProcessed(messageId);
		if (alreadyProcessed) {
			console.log('Skipping already processed message:', messageId);
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

		// Process caption
		const processedCaption = replaceLinksAndText(textContent);
		const captionWithHashtag = processedCaption + '\n\n#Deals24';
		
		// Retrieve message text from database using messageId
		const retrievedText = await getMessageTextById(messageId);
		
		// Fix: Initialize finalCaption properly for both code paths
		let finalCaption;
		if (retrievedText) {
			console.log('Retrieved text from DB:', retrievedText.substring(0, 100));
			finalCaption = replaceLinksAndText(retrievedText) + '\n\n#Deals24';
		} else {
			console.log('No text found in DB for messageId:', messageId);
			finalCaption = captionWithHashtag;
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
				console.log('Tweet posted successfully!');
			} else {
				console.log('Initial tweet failed, skipping reply tweets.');
			}
		} catch (error) {
			if (error.code === 429 && error.headers) {
				const userLimit = error.headers['x-user-limit-24hour-limit'];
				const userRemaining = error.headers['x-user-limit-24hour-remaining'];
				const userReset = error.headers['x-user-limit-24hour-reset'];

				const userResetDate = new Date(Number(userReset) * 1000);
				
				// Store rate limit info
				rateLimitInfo = {
					limit: userLimit,
					remaining: userRemaining,
					resetAt: userResetDate.toString(),
					lastUpdated: new Date().toISOString()
				};
				
				// Persist to database
				await saveRateLimitInfo();
				
				console.log(`🔒 User Tweet Limit: ${userLimit}, Remaining: ${userRemaining}`);
				console.log(`🕒 User Limit Resets At: ${userResetDate.toString()}`);
				console.log('Skipping tweet posting due to rate limit.');
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

// Connect to MongoDB and start bot
connectMongoDB();

bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => {
		logError('Bot launch', err);
		process.exit(1);
	});

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitInfo();
	bot.stop('SIGINT');
	mongoose.connection.close();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('Shutting down gracefully...');
	await saveRateLimitInfo();
	bot.stop('SIGTERM');
	mongoose.connection.close();
	process.exit(0);
});
