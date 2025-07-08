require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');
const express = require('express');
const fetch = require('node-fetch');
const path = './processedMessages.json';

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

// Check if it's sale mode
const IS_SALE_MODE = process.env.IS_SALE_MODE === 'true';


// Read and write processed message IDs
const getLastProcessedMessageIds = () => {
	if (!fs.existsSync(path)) return [];
	const data = fs.readFileSync(path, 'utf-8');
	return JSON.parse(data) || [];
};

// Write processed message IDs
const setLastProcessedMessageIds = (messageIds) => {
	fs.writeFileSync(path, JSON.stringify(messageIds), 'utf-8');
};

// check if message is recent (within 5 minutes)
const isRecentMessage = (messageDate) => {
    const messageTimestamp = messageDate * 1000;  // Convert Telegram timestamp (seconds) to milliseconds
    const currentTimestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const currentDateInKolkata = new Date(currentTimestamp).getTime(); // Convert to milliseconds

    return (currentDateInKolkata - messageTimestamp) <= (5 * 60 * 1000); // 5 minutes in milliseconds
};


// link remover
const removeLinks = (text) => text.replace(/https?:\/\/\S+/g, '');

// replace with our own links and text 
const replaceLinksAndText = (text) =>
	text
		.replace(
			/https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
			'https://t.me/deals24com',
		)
		.replace(/TRT Premium Deals/g, 'Deals24');

// normalize message
const normalizeMessage = (text) =>
	removeLinks(text).trim().replace(/\s+/g, ' ').toLowerCase();


// split text into chunks to tackle twitter's 280 character limit
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

// calculate hash to check for duplicate content
const calculateHash = (text) => {
	const normalizedText = normalizeMessage(text);
	return crypto.createHash('sha256').update(normalizedText).digest('hex');
};

// check if message is low context, to skip low-context / unncessary messages 
const isLowContext = (text) => {
	const meaningfulText = text.replace(/https?:\/\/\S+/g, '').trim();
	if (meaningfulText.length < 30) return true;
	const lowContextKeywords = ['loot', 'deal', 'link', 'fast', 'price drop'];
	const keywordMatch = lowContextKeywords.some((keyword) =>
		meaningfulText.toLowerCase().includes(keyword),
	);
	return keywordMatch && meaningfulText.length < 60;
};

// check if message contains amazon link to skip posting its image
const containsAmazonLink = (text) => {
	const amazonRegex = /https?:\/\/(www\.)?(amzn\.to|amazon\.[a-z.]+)/gi;
	return amazonRegex.test(text);
};

// check if product is profitable
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

// to avoid rate limiting, we'll wait for 1 second before sending the next message...
// to avoid race  conditions...
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get highest-quality image from photo array
const getHighestQualityPhoto = (photos) => {
	if (!photos || photos.length === 0) return null;
	return photos.reduce(
		(max, p) => (p.file_size > max.file_size ? p : max),
		photos[0],
	);
};

// Download image file from Telegram
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

	const containsAmazon = containsAmazonLink(textContent);

	const processedMessageIds = getLastProcessedMessageIds();
	processedMessageIds.push(messageId);
	if (processedMessageIds.length > 10) processedMessageIds.shift();
	setLastProcessedMessageIds(processedMessageIds);
	contentHashes.push(messageHash);
	if (contentHashes.length > 50) contentHashes.shift();

	const caption = replaceLinksAndText(textContent) + '\n\n#Deals24';
	const captionChunks = splitText(caption, 280);

	try {
		let tweetResponse;

		// Image logic
		if (message.photo && message.photo.length > 0 && !containsAmazon) {
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
			tweetResponse = await twitterClient.v2.tweet(captionChunks[0]);
		}

		for (let i = 1; i < captionChunks.length; i++) {
			tweetResponse = await twitterClient.v2.reply(
				captionChunks[i],
				tweetResponse.data.id,
			);
		}

		console.log('Tweet posted successfully!');
	} catch (error) {
		console.error('Error posting tweet:', error);
	}

	await delay(200);
});

bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => console.error('Error starting the bot:', err));
