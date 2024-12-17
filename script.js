require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');
const express = require('express');

// File to store the last few processed message IDs
const path = './processedMessages.json';

// Set up Express server to keep service alive
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
	res.send('Bot is running!');
});

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

// Telegram bot setup
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Twitter API setup
const twitterClient = new TwitterApi({
	appKey: process.env.TWITTER_API_KEY,
	appSecret: process.env.TWITTER_API_SECRET_KEY,
	accessToken: process.env.TWITTER_ACCESS_TOKEN,
	accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Hashes to store unique content
let contentHashes = [];

// Function to get the last processed message IDs
const getLastProcessedMessageIds = () => {
	if (!fs.existsSync(path)) {
		return [];
	}
	const data = fs.readFileSync(path, 'utf-8');
	return JSON.parse(data) || [];
};

// Function to update the last processed message IDs in the file
const setLastProcessedMessageIds = (messageIds) => {
	fs.writeFileSync(path, JSON.stringify(messageIds), 'utf-8');
};

// Function to replace specific links and text
const replaceLinksAndText = (text) => {
	return text
		.replace(
			/https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
			'https://t.me/deals24com',
		)
		.replace(/TRT Premium Deals/g, 'Deals24');
};

// Function to split long text into chunks
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

// Function to calculate hash of a message's content
const calculateHash = (text) => {
	return crypto.createHash('sha256').update(text).digest('hex');
};

// Function to filter low-context messages
const isLowContext = (text) => {
	const meaningfulText = text.replace(/https?:\/\/\S+/g, '').trim(); // Remove links
	if (meaningfulText.length < 30) return true; // Too short
	const lowContextKeywords = ['loot', 'deal', 'link', 'fast', 'price drop'];
	const keywordMatch = lowContextKeywords.some((keyword) =>
		meaningfulText.toLowerCase().includes(keyword),
	);
	return keywordMatch && meaningfulText.length < 60; // Keywords but no big context
};

// A simple delay function to simulate awaiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Listen to any message in the Telegram channel
bot.on('channel_post', async (ctx) => {
	const message = ctx.channelPost;
	const messageId = message.message_id.toString();
	const textContent = message.caption || message.text;

	// Check if the message is already processed by its hash
	const messageHash = calculateHash(textContent);
	if (contentHashes.includes(messageHash)) {
		console.log('Skipping duplicate content.');
		return;
	}

	// Skip low-context messages
	if (isLowContext(textContent)) {
		console.log('Skipping low-context message:', textContent);
		return;
	}

	// Add message ID and content hash to processed list
	const processedMessageIds = getLastProcessedMessageIds();
	processedMessageIds.push(messageId);
	if (processedMessageIds.length > 10) processedMessageIds.shift(); // Keep the last 10
	setLastProcessedMessageIds(processedMessageIds);

	contentHashes.push(messageHash);
	if (contentHashes.length > 50) contentHashes.shift(); // Limit stored hashes to save memory

	// Process and post the message
	const caption = replaceLinksAndText(textContent);
	const finalCaption = caption + '\n\n#Deals24';
	try {
		const captionChunks = splitText(finalCaption, 280);
		let firstTweet = await twitterClient.v2.tweet(captionChunks[0]);
		console.log('First tweet posted:', firstTweet);

		for (let i = 1; i < captionChunks.length; i++) {
			firstTweet = await twitterClient.v2.reply(
				captionChunks[i],
				firstTweet.data.id,
			);
			console.log(`Reply ${i} posted:`, firstTweet);
		}
		console.log('Tweet posted successfully!');
	} catch (error) {
		console.error('Error posting tweet:', error);
	}

	// Delay to reduce race conditions
	await delay(100);
});

// Start the bot and check for launch errors
bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => console.error('Error starting the bot:', err));
