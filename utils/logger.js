const logError = (context, error, additionalInfo = {}) => {
	const errorLog = {
		timestamp: new Date().toISOString(),
		context,
		message: error.message || String(error),
		stack: error.stack,
		...additionalInfo
	};
	console.error(`[ERROR] ${context}:`, JSON.stringify(errorLog, null, 2));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
	logError,
	delay,
};

