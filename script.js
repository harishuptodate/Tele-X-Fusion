require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');
const express = require('express');
const fetch = require('node-fetch');
const path = './processedMessages.json';
const mongoose = require('mongoose');
const TelegramMessage = require('./models/TelegramMessage');

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('Connected to MongoDB'))
.catch((err) => console.error('Error connecting to MongoDB:', err));

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const twitterClient = new TwitterApi({
	appKey: process.env.TWITTER_API_KEY,
	appSecret: process.env.TWITTER_API_SECRET_KEY,
	accessToken: process.env.TWITTER_ACCESS_TOKEN,
	accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

let contentHashes = [];
const IS_SALE_MODE = process.env.IS_SALE_MODE === 'true';

const getLastProcessedMessageIds = () => {
	if (!fs.existsSync(path)) return [];
	const data = fs.readFileSync(path, 'utf-8');
	return JSON.parse(data) || [];
};

const setLastProcessedMessageIds = (messageIds) => {
	fs.writeFileSync(path, JSON.stringify(messageIds), 'utf-8');
};

// Helper function to check if text contains Amazon links
function hasAmazonLinks(text) {
  if (!text) return false;
  const amazonRegex = /(https?:\/\/)?(www\.)?(amazon\.[a-z]{2,}|amzn\.to)\/[^\s]*/gi;
  return amazonRegex.test(text);
}

const isRecentMessage = (messageDate) => {
	const messageTimestamp = messageDate * 1000;
	const currentTimestamp = Date.now();
	return currentTimestamp - messageTimestamp <= 5 * 60 * 1000;
};

// link remover
const removeLinks = (text) => text.replace(/https?:\/\/\S+/g, '');
const replaceLinksAndText = (text) =>
	text
		.replace(
			/https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
			'https://t.me/deals24com',
		)
		.replace(/TRT Premium Deals/g, 'Deals24');

const normalizeMessage = (text) =>
	removeLinks(text).trim().replace(/\s+/g, ' ').toLowerCase();

const splitText = (text, maxLength) => {
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
	const meaningfulText = text.replace(/https?:\/\/\S+/g, '').trim();
	if (meaningfulText.length < 30) return true;
	const lowContextKeywords = ['loot', 'deal', 'link', 'fast', 'price drop'];
	const keywordMatch = lowContextKeywords.some((keyword) =>
		meaningfulText.toLowerCase().includes(keyword),
	);
	return keywordMatch && meaningfulText.length < 60;
};

const isProfitableProduct = (text) => {
	const profitableKeywords = [
		'tv',
		'tvs',
		'4ktvs',
		'4k',
		'laptop',
		'washing machine',
		'ai',
		'kg',
		'12 kg',
		'9 kg',
		'7 kg',
		'8 kg',
		'6.5 kg',
		'10 kg',
		'8.5 kg',
		'front load',
		'top load',
		'air conditioner',
		'ac',
		'acs',
		'ton',
		'refrigerator',
		'653 l',
		'single door',
		'double door',
		'triple door',
		'side by side',
		'intel',
		'core',
		'ryzen',
		'bravia',
	];
	for (let keyword of profitableKeywords) {
		const regex = new RegExp(`\\b${keyword}\\b`, 'i');
		if (regex.test(text)) return true;
	}
	return false;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to get text from database using messageId
const getMessageTextById = async (messageId) => {
	try {
		const message = await TelegramMessage.findOne({ messageId: messageId });
		if (!message) {
			return null;
		}
		return message.text;
	} catch (error) {
		console.error('Error retrieving message text:', error);
		throw error;
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

// Download file from Telegram
const downloadTelegramFile = async (fileId, botToken) => {
	try {
		const fileInfo = await fetch(
			`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
		);
		const fileData = await fileInfo.json();
		const filePath = fileData.result.file_path;
		const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
		const response = await fetch(fileUrl);
		return Buffer.from(await response.arrayBuffer());
	} catch (error) {
		console.error('Error downloading image:', error);
		return null;
	}
};

// Message listener
bot.on('channel_post', async (ctx) => {
	const message = ctx.channelPost;
	const messageId = message.message_id.toString();
	const textContent = message.caption || message.text;
	if (!textContent) return;

	// Wait 9 seconds before proceeding
	console.log('Waiting 7 seconds before processing message...');
	await delay(7000);
	console.log('7 seconds passed');

	if (!isRecentMessage(message.date)) {
		console.log('Skipping old message:', textContent);
		return;
	}

	const messageHash = calculateHash(textContent);
	if (contentHashes.includes(messageHash)) {
		console.log('Skipping duplicate content.');
		return;
	}

	if (isLowContext(textContent)) {
		console.log('Skipping low-context message:', textContent);
		return;
	}

	if (IS_SALE_MODE && !isProfitableProduct(textContent)) {
		console.log('Skipping non-profitable product in sale mode:', textContent);
		return;
	}

	const processedMessageIds = getLastProcessedMessageIds();
	processedMessageIds.push(messageId);
	if (processedMessageIds.length > 10) processedMessageIds.shift();
	setLastProcessedMessageIds(processedMessageIds);
	contentHashes.push(messageHash);
	if (contentHashes.length > 50) contentHashes.shift();

	const caption = replaceLinksAndText(textContent) + '\n\n#Deals24';
	
	// Retrieve message text from database using messageId
	const retrievedText = await getMessageTextById(messageId);
	if (retrievedText) {
		console.log('Retrieved text from DB:', retrievedText);
	}

	const finalCaption = retrievedText ? retrievedText + '\n\n#Deals24' : caption;
	const captionChunks = splitText(finalCaption, 280);

	
	try {
		let tweetResponse;

		// Check if message has Amazon links - skip image logic if it does
		const hasAmazonLink = hasAmazonLinks(retrievedText) || hasAmazonLinks(textContent);
		
		// Image logic - skip if Amazon links are present
		if (!hasAmazonLink && message.photo && message.photo.length > 0) {
			const bestPhoto = getHighestQualityPhoto(message.photo);
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
			if (hasAmazonLink) {
				console.log('Amazon links detected, posting text only without image.');
			}
			tweetResponse = await twitterClient.v2.tweet(captionChunks[0]);
		}

		// Only post replies if the initial tweet was successful
		if (tweetResponse && tweetResponse.data) {
			for (let i = 1; i < captionChunks.length; i++) {
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
			console.log(`🔒 User Tweet Limit: ${userLimit}, Remaining: ${userRemaining}`);
			console.log(`🕒 User Limit Resets At: ${userResetDate.toString()}`);
			console.log('Skipping tweet posting due to rate limit.');
		} else {
			console.error('Error posting tweet:', error);
		}
	}

	console.log('Message processing completed.');
	await delay(300);
});

bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => console.error('Error starting the bot:', err));
