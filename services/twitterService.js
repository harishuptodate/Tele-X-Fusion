const { TwitterApi } = require('twitter-api-v2');
const { TwitterApiRateLimitPlugin } = require('@twitter-api-v2/plugin-rate-limit');
const { outboundRateLimitService, RateLimitDecision } = require('../rate-limit');
const { downloadTelegramFile, getHighestQualityPhoto } = require('./telegramService');
const { hasAmazonLinks } = require('../utils/textUtils');
const { isRateLimitError, parseTwitterRateLimit } = require('../rate-limit/providers/twitterRateLimitParser');
const CONFIG = require('../config');

let twitterClient;
const twitterRateLimitPlugin = new TwitterApiRateLimitPlugin();
const getTwitterClient = () => {
	if (!twitterClient) {
		twitterClient = new TwitterApi(
			{
				appKey: process.env.TWITTER_API_KEY,
				appSecret: process.env.TWITTER_API_SECRET_KEY,
				accessToken: process.env.TWITTER_ACCESS_TOKEN,
				accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
			},
			{
				plugins: [twitterRateLimitPlugin],
			},
		);
	}
	return twitterClient;
};

const getFirstCaptionChunk = (captionChunks) => captionChunks?.[0] || '';

const extractTweetId = (tweetResponse) => {
	if (!tweetResponse) return null;
	if (typeof tweetResponse === 'string') return tweetResponse;
	return tweetResponse?.data?.id || tweetResponse?.id || null;
};

const normalizeTwitterError = (error) => {
	if (!error) return error;

	const parsedRateLimit = parseTwitterRateLimit(error);
	const headers = error.headers || error.response?.headers || error.rateLimit || {};
	const normalizedRateLimit = {
		...error.rateLimit,
	};

	if (parsedRateLimit.limit !== null) normalizedRateLimit.limit = parsedRateLimit.limit;
	if (parsedRateLimit.remaining !== null) normalizedRateLimit.remaining = parsedRateLimit.remaining;
	if (parsedRateLimit.resetAt) {
		normalizedRateLimit.reset = Math.floor(parsedRateLimit.resetAt.getTime() / 1000);
	}

	return {
		...error,
		headers,
		status: error.status || error.code || error.response?.status,
		code: error.code || error.status || error.response?.status,
		rateLimit: normalizedRateLimit,
	};
};

const isKnownRateLimitError = (error) => {
	const normalizedError = normalizeTwitterError(error);
	if (isRateLimitError(normalizedError)) return true;

	const errorType = normalizedError?.data?.type || normalizedError?.type || '';
	return errorType.includes('/rate-limit-exceeded') || errorType.includes('/usage-capped');
};

const postChunk = async (client, text, options = {}) => client.v2.tweet({
	text,
	...options,
});

const postTweet = async (captionChunks, message, retrievedText, textContent) => {
	try {
		const preflight = await outboundRateLimitService.preflightCheck();
		if (preflight.decision === RateLimitDecision.BLOCK) {
			console.log(`Rate limit preflight blocked posting until: ${preflight.resetAt || 'unknown'}`);
			return {
				success: false,
				blockedByRateLimit: true,
				reason: preflight.reason,
				resetAt: preflight.resetAt,
			};
		}

		const client = getTwitterClient();
		let tweetResponse;
		const hasAmazonLink = hasAmazonLinks(retrievedText || textContent);
		const firstCaptionChunk = getFirstCaptionChunk(captionChunks);
		
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
						const mediaId = await client.v1.uploadMedia(imageBuffer, {
							mimeType: 'image/jpeg',
						});
						tweetResponse = await postChunk(client, firstCaptionChunk, {
							media: { media_ids: [mediaId] },
						});
					} catch (mediaError) {
						const normalizedMediaError = normalizeTwitterError(mediaError);
						// #region agent log
						fetch('http://127.0.0.1:7628/ingest/1fd3aeed-313d-4e3a-95df-30f08beb7214',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'121def'},body:JSON.stringify({sessionId:'121def',runId:'initial',hypothesisId:'H2',location:'services/twitterService.js:55',message:'Media upload error classification input',data:{code:normalizedMediaError?.code??null,status:normalizedMediaError?.status??null,hasRateLimit:!!normalizedMediaError?.rateLimit,responseStatus:normalizedMediaError?.response?.status??null,title:normalizedMediaError?.data?.title??null,type:normalizedMediaError?.data?.type??null},timestamp:Date.now()})}).catch(()=>{});
						// #endregion
						// Handle rate limit error from media upload
						if (isKnownRateLimitError(normalizedMediaError)) {
							console.log('Rate limit error during media upload');
							await outboundRateLimitService.recordRateLimitError(normalizedMediaError);
							return {
								success: false,
								blockedByRateLimit: true,
								reason: 'twitter_rate_limit_error_media',
							};
						}
						throw mediaError;
					}
				} else {
					console.log('Failed to download image, posting text only.');
					tweetResponse = await postChunk(client, firstCaptionChunk);
				}
			} else {
				console.log('No valid photo found, posting text only.');
				tweetResponse = await postChunk(client, firstCaptionChunk);
			}
		} else {
			if (hasAmazonLink) {
				console.log('Amazon links detected, posting text only without image.');
			}
			tweetResponse = await postChunk(client, firstCaptionChunk);
		}

		// Post replies if initial tweet was successful
		let parentTweetId = extractTweetId(tweetResponse);
		if (parentTweetId) {
			for (let i = 1; i < captionChunks.length; i++) {
				try {
					tweetResponse = await postChunk(client, captionChunks[i], {
						reply: { in_reply_to_tweet_id: parentTweetId },
					});
					parentTweetId = extractTweetId(tweetResponse);
				} catch (replyError) {
					const normalizedReplyError = normalizeTwitterError(replyError);
					// Handle rate limit error from reply
					if (isKnownRateLimitError(normalizedReplyError)) {
						console.log('Rate limit error while posting reply');
						await outboundRateLimitService.recordRateLimitError(normalizedReplyError);
						break;
					}
					throw replyError;
				}
			}
			
			await outboundRateLimitService.recordSuccess();
			console.log('Tweet posted successfully!');
			return {
				success: true,
				blockedByRateLimit: false,
				reason: 'posted',
			};
		} else {
			console.log('Initial tweet failed, skipping reply tweets.');
			return {
				success: false,
				blockedByRateLimit: false,
				reason: 'initial_tweet_failed',
			};
		}
	} catch (error) {
		console.log('Error posting tweet:', error);
		const normalizedError = normalizeTwitterError(error);
		console.log('Error details:', {
			code: normalizedError.code,
			status: normalizedError.status,
			message: normalizedError.message,
			hasHeaders: !!normalizedError.headers,
			hasResponse: !!normalizedError.response,
			hasRateLimit: !!normalizedError.rateLimit,
			headers: normalizedError.headers,
			responseHeaders: normalizedError.response?.headers
		});

		// #region agent log
		fetch('http://127.0.0.1:7628/ingest/1fd3aeed-313d-4e3a-95df-30f08beb7214',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'121def'},body:JSON.stringify({sessionId:'121def',runId:'initial',hypothesisId:'H1',location:'services/twitterService.js:129',message:'Tweet error before rate-limit classification',data:{code:normalizedError?.code??null,status:normalizedError?.status??null,hasRateLimit:!!normalizedError?.rateLimit,responseStatus:normalizedError?.response?.status??null,title:normalizedError?.data?.title??null,type:normalizedError?.data?.type??null,detail:normalizedError?.data?.detail??null},timestamp:Date.now()})}).catch(()=>{});
		// #endregion
		
		// Check for rate limit error (429) in various formats
		const shouldTreatAsRateLimit = isKnownRateLimitError(normalizedError);
		// #region agent log
		fetch('http://127.0.0.1:7628/ingest/1fd3aeed-313d-4e3a-95df-30f08beb7214',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'121def'},body:JSON.stringify({sessionId:'121def',runId:'initial',hypothesisId:'H3',location:'services/twitterService.js:132',message:'Rate-limit branch decision',data:{shouldTreatAsRateLimit:Boolean(shouldTreatAsRateLimit),code:normalizedError?.code??null,status:normalizedError?.status??null,hasRateLimit:!!normalizedError?.rateLimit},timestamp:Date.now()})}).catch(()=>{});
		// #endregion
		if (shouldTreatAsRateLimit) {
			console.log('Rate limit error detected, updating database...');
			await outboundRateLimitService.recordRateLimitError(normalizedError);
			return {
				success: false,
				blockedByRateLimit: true,
				reason: 'twitter_rate_limit_error',
			};
		} else {
			throw error;
		}
	}
};

module.exports = {
	postTweet,
};

