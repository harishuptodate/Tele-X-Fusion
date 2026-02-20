require('dotenv').config();

module.exports = {
	PORT: process.env.PORT || 3000,
	MESSAGE_PROCESSING_DELAY_MS: 10000,
	MESSAGE_RECENCY_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
	MAX_CONTENT_HASHES: 50,
	MAX_PROCESSED_MESSAGE_IDS: 10,
	TWEET_MAX_LENGTH: 280,
	POST_PROCESSING_DELAY_MS: 300,
	MIN_CONTEXT_LENGTH: 30,
	LOW_CONTEXT_LENGTH: 60,
	MONGODB_CONNECTION_OPTIONS: {
		maxPoolSize: 10,
		serverSelectionTimeoutMS: 5000,
		retryWrites: true,
	},
	// IS_SALE_MODE is initialized from env var, but can be updated dynamically via MongoDB
	// Use loadSaleModeState() from storageService to load from DB on startup
	// The value will be updated in memory when toggled via frontend
	IS_SALE_MODE: process.env.IS_SALE_MODE === 'true',
	REGEX_PATTERNS: {
		amazonLink: /(https?:\/\/)?(www\.)?(amazon\.[a-z]{2,}|amzn\.to)\/[^\s]*/gi,
		httpLink: /https?:\/\/\S+/g,
		telegramLink: /https:\/\/t\.me\/\/nikhilfkm\/|https:\/\/t\.me\/trtpremiumdeals/g,
		trtPremium: /TRT Premium Deals/g,
		whitespace: /\s+/g,
	},
	PROFITABLE_KEYWORDS: [
		'tv', 'tvs', '4ktvs', '4k', 'laptop', 'washing machine', 'ai', 'kg',
		'12 kg', '9 kg', '7 kg', '8 kg', '6.5 kg', '10 kg', '8.5 kg',
		'front load', 'top load', 'air conditioner', 'ac', 'acs', 'ton',
		'refrigerator', '653 l', 'single door', 'double door', 'triple door',
		'side by side', 'intel', 'core', 'ryzen', 'bravia',
	],
	LOW_CONTEXT_KEYWORDS: ['loot', 'deal', 'link', 'fast', 'price drop'],
};

