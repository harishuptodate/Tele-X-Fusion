const CONFIG = require('../config');
const {
	isMessagePostedToTwitter,
	addMessageToProcessed,
} = require('../services/storageService');
const { postTweet } = require('../services/twitterService');
const { getMessageTextById } = require('../services/telegramService');
const {
	validateMessage,
	isRecentMessage,
	calculateHash,
	isLowContext,
	isProfitableProduct,
	replaceLinksAndText,
	splitText,
} = require('../utils/textUtils');
const { logError, delay } = require('../utils/logger');

// Use Set for O(1) hash lookups
const contentHashes = new Set();

const handleChannelPost = async (updateOrCtx) => {
	try {
		console.log('Channel post received!');
		
		// Extract message from either ctx (polling) or update (webhook)
		let message;
		if (updateOrCtx.channelPost) {
			message = updateOrCtx.channelPost;
		} else if (updateOrCtx.channel_post) {
			message = updateOrCtx.channel_post;
		} else {
			console.log('No channelPost found in update/ctx');
			return;
		}
		
		// Input validation
		try {
			validateMessage(message);
		} catch (validationError) {
			logError('Message validation', validationError);
			return;
		}
		
		const messageId = message.message_id.toString();
		const textContent = message.caption || message.text;
		
		console.log(`Processing message ID: ${messageId}, Text preview: ${textContent ? textContent.substring(0, 50) : 'No text'}`);
		
		if (!textContent) {
			console.log('Skipping message without text content');
			return;
		}

		// FIRST: Check if messageId was already posted to Twitter
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
		if (CONFIG.IS_SALE_MODE && !isProfitableProduct(textContent)) {
			console.log('Skipping non-profitable product in sale mode:', textContent.substring(0, 100));
			return;
		}

		// Add hash to Set (handle size limit)
		contentHashes.add(messageHash);
		if (contentHashes.size > CONFIG.MAX_CONTENT_HASHES) {
			const hashArray = Array.from(contentHashes);
			hashArray.shift();
			contentHashes.clear();
			hashArray.forEach(hash => contentHashes.add(hash));
		}

		// Check DB for better caption text
		const retrievedText = await getMessageTextById(messageId);
		
		// Process caption - use DB text if available, otherwise use Telegram text
		const processedCaption = replaceLinksAndText(retrievedText || textContent);
		const captionWithHashtag = processedCaption + '\n\n#Deals24';
		
		let finalCaption = captionWithHashtag;
		if (retrievedText) {
			console.log('Using better caption from DB:', retrievedText.substring(0, 100));
		} else {
			console.log('No text found in DB for messageId, using Telegram text:', messageId);
		}

		const captionChunks = splitText(finalCaption, CONFIG.TWEET_MAX_LENGTH);

		// Post to Twitter
		const success = await postTweet(captionChunks, message, retrievedText, textContent);
		
		if (success) {
			// After successful tweet: add messageId to processed list
			await addMessageToProcessed(messageId);
		}

		console.log('Message processing completed.');
		await delay(CONFIG.POST_PROCESSING_DELAY_MS);
	} catch (error) {
		logError('Channel post handler', error);
	}
};

module.exports = {
	handleChannelPost,
};

