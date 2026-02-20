const { TwitterApi } = require('twitter-api-v2');
const {
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
					try {
						const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, {
							type: 'photo',
						});
						tweetResponse = await twitterClient.v2.tweet({
							text: captionChunks[0],
							media: { media_ids: [mediaId] },
						});
					} catch (mediaError) {
						// Handle rate limit error from media upload
						if (mediaError.code === 429 || mediaError.rateLimit) {
							console.log('Rate limit error during media upload');
							await handleRateLimitError(mediaError);
							return false;
						}
						throw mediaError;
					}
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
				try {
					tweetResponse = await twitterClient.v2.reply(
						captionChunks[i],
						tweetResponse.data.id,
					);
				} catch (replyError) {
					// Handle rate limit error from reply
					if (replyError.code === 429 || replyError.rateLimit) {
						console.log('Rate limit error while posting reply');
						await handleRateLimitError(replyError);
						break;
					}
					throw replyError;
				}
			}
			
			await incrementSuccessfulTweetCount();
			console.log('Tweet posted successfully!');
			return true;
		} else {
			console.log('Initial tweet failed, skipping reply tweets.');
			return false;
		}
	} catch (error) {
		console.log('Error posting tweet:', error);
		console.log('Error details:', {
			code: error.code,
			status: error.status,
			message: error.message,
			hasHeaders: !!error.headers,
			hasResponse: !!error.response,
			hasRateLimit: !!error.rateLimit,
			headers: error.headers,
			responseHeaders: error.response?.headers
		});
		
		// Check for rate limit error (429) in various formats
		if (error.code === 429 || error.status === 429 || error.rateLimit) {
			console.log('Rate limit error detected, updating database...');
			await handleRateLimitError(error);
			return false;
		} else {
			throw error;
		}
	}
};

module.exports = {
	postTweet,
};

