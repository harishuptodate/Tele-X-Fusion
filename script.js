require('dotenv').config();
const fs = require('fs');
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

// A simple delay function to simulate awaiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Listen to any message in the Telegram channel
bot.on('channel_post', async (ctx) => {
	const message = ctx.channelPost;
	const messageId = message.message_id.toString(); // Use message_id as a unique identifier
	const messageTimestamp = message.date * 1000; // Convert to milliseconds
	const currentTimestamp = Date.now(); // Get current timestamp

	const processedMessageIds = getLastProcessedMessageIds();
	console.log('Last processed message IDs:', processedMessageIds);

	// Check if the message is new and recent
	if (!processedMessageIds.includes(messageId)) {
		processedMessageIds.push(messageId); // Add the new message ID

		// Keep only the last 10 processed message IDs
		if (processedMessageIds.length > 10) {
			processedMessageIds.shift(); // Remove the oldest message ID
		}

		setLastProcessedMessageIds(processedMessageIds); // Update the file

		const caption = replaceLinksAndText(message.caption || message.text); // Use either caption or text
		console.log('Filtered caption:', caption);

		// Add "#Deals24" at the end of the caption
		const finalCaption = caption + '\n\n#Deals24'; // Adding in a new line
		console.log('Final caption with hashtag:', finalCaption);

		try {
			// Split the caption if it's longer than 280 characters
			const captionChunks = splitText(finalCaption, 280);
			console.log('Caption chunks:', captionChunks);

			let firstTweet = await twitterClient.v2.tweet(captionChunks[0]);
			console.log('First tweet posted:', firstTweet);

			// Post remaining parts as a thread
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
		await delay(100); // Add a small delay after processing the message
	} else {
		console.log('Skipping already processed message.');
	}
});

// Start the bot and check for launch errors
bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => console.error('Error starting the bot:', err));
