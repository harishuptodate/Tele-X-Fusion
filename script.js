require('dotenv').config();
const { Telegraf } = require('telegraf');
const { TwitterApi } = require('twitter-api-v2');

// Telegram bot setup
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Twitter API setup
const twitterClient = new TwitterApi({
	appKey: process.env.TWITTER_API_KEY,
	appSecret: process.env.TWITTER_API_SECRET_KEY,
	accessToken: process.env.TWITTER_ACCESS_TOKEN,
	accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// Log the Twitter client to ensure it's initialized
console.log('Twitter client initialized:', twitterClient);

// Function to replace specific links and text
const replaceLinksAndText = (text) => {
	return text
		.replace(
			/https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
			'https://t.me/deals24com',
		)
		.replace(/TRT Premium Deals/g, 'Deals24 https://t.me/deals24com');
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

// Listen to any message in the Telegram channel
bot.on('channel_post', async (ctx) => {
	const message = ctx.channelPost;
	console.log('Received a message from Telegram channel:', message);

	if (message) {
		const caption = replaceLinksAndText(message.caption || message.text);
		console.log('Filtered caption:', caption);

		try {
			const captionChunks = splitText(caption, 280);
			console.log('Caption chunks:', captionChunks);

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
	} else {
		console.log('No message found in the context.');
	}
});

// Start the bot and check for launch errors
bot
	.launch()
	.then(() => console.log('Bot is up and running.'))
	.catch((err) => console.error('Error starting the bot:', err));
