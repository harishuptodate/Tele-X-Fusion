const { TwitterApi } = require('twitter-api-v2');
const {
	canMakeTwitterRequest,
	incrementSuccessfulTweetCount,
	handleRateLimitError,
} = require('./storageService');
const { downloadTelegramFile, getHighestQualityPhoto } = require('./telegramService');
const { hasAmazonLinks } = require('../utils/textUtils');
const CONFIG = require('../config');

const twitterClient = new TwitterApi({
	appKey: process.env.TWITTER_API_KEY,
	appSecret: process.env.TWITTER_API_SECRET_KEY,
	accessToken: process.env.TWITTER_ACCESS_TOKEN,
	accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const postTweet = async (captionChunks, message, retrievedText, textContent) => {
	if (!canMakeTwitterRequest()) {
		console.log('Rate limit reached, skipping tweet posting');
		return false;
	}

	try {
		let tweetResponse;
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

		// Post replies if initial tweet was successful
		if (tweetResponse && tweetResponse.data) {
			for (let i = 1; i < captionChunks.length; i++) {
				if (!canMakeTwitterRequest()) {
					console.log('Rate limit reached while posting replies, stopping');
					break;
				}
				tweetResponse = await twitterClient.v2.reply(
					captionChunks[i],
					tweetResponse.data.id,
				);
			}
			
			await incrementSuccessfulTweetCount();
			console.log('Tweet posted successfully!');
			return true;
		} else {
			console.log('Initial tweet failed, skipping reply tweets.');
			return false;
		}
	} catch (error) {
		if (error.code === 429 && error.headers) {
			await handleRateLimitError(error);
		} else {
			throw error;
		}
		return false;
	}
};

module.exports = {
	postTweet,
};

