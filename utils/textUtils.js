const crypto = require('crypto');
const CONFIG = require('../config');

const PROFITABLE_PRODUCT_REGEXES = CONFIG.PROFITABLE_KEYWORDS.map(
	keyword => new RegExp(`\\b${keyword}\\b`, 'i')
);

const removeLinks = (text) => {
	if (!text) return '';
	return text.replace(CONFIG.REGEX_PATTERNS.httpLink, '');
};

const replaceLinksAndText = (text) => {
	if (!text) return '';
	return text
		.replace(CONFIG.REGEX_PATTERNS.telegramLink, 'https://t.me/deals24com')
		.replace(CONFIG.REGEX_PATTERNS.trtPremium, 'Deals24');
};

const normalizeMessage = (text) => {
	if (!text) return '';
	return removeLinks(text)
		.trim()
		.replace(CONFIG.REGEX_PATTERNS.whitespace, ' ')
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

const hasAmazonLinks = (text) => {
	if (!text) return false;
	return CONFIG.REGEX_PATTERNS.amazonLink.test(text);
};

const isLowContext = (text) => {
	if (!text) return true;
	const meaningfulText = removeLinks(text).trim();
	if (meaningfulText.length < CONFIG.MIN_CONTEXT_LENGTH) return true;
	const keywordMatch = CONFIG.LOW_CONTEXT_KEYWORDS.some((keyword) =>
		meaningfulText.toLowerCase().includes(keyword),
	);
	return keywordMatch && meaningfulText.length < CONFIG.LOW_CONTEXT_LENGTH;
};

const isProfitableProduct = (text) => {
	if (!text) return false;
	return PROFITABLE_PRODUCT_REGEXES.some(regex => regex.test(text));
};

const isRecentMessage = (messageDate) => {
	if (!messageDate) return false;
	const messageTimestamp = messageDate * 1000;
	const currentTimestamp = Date.now();
	return currentTimestamp - messageTimestamp <= CONFIG.MESSAGE_RECENCY_THRESHOLD_MS;
};

const validateMessage = (message) => {
	if (!message) {
		throw new Error('Message is null or undefined');
	}
	if (!message.message_id) {
		throw new Error('Message ID is missing');
	}
	return true;
};

module.exports = {
	removeLinks,
	replaceLinksAndText,
	normalizeMessage,
	splitText,
	calculateHash,
	hasAmazonLinks,
	isLowContext,
	isProfitableProduct,
	isRecentMessage,
	validateMessage,
};

