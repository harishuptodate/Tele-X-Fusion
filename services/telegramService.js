const fetch = require('node-fetch');
const TelegramMessage = require('../models/TelegramMessage');

const getMessageTextById = async (messageId) => {
	if (!messageId) {
		console.error('getMessageTextById: messageId is required');
		return null;
	}
	try {
		const message = await TelegramMessage.findOne(
			{ messageId: messageId },
			{ text: 1 }
		);
		if (!message) {
			return null;
		}
		return message.text;
	} catch (error) {
		console.error('Error retrieving message text:', error.message);
		return null;
	}
};

const getHighestQualityPhoto = (photos) => {
	if (!photos || photos.length === 0) return null;
	return photos.reduce(
		(max, p) => (p.file_size > max.file_size ? p : max),
		photos[0],
	);
};

const downloadTelegramFile = async (fileId, botToken) => {
	if (!fileId || !botToken) {
		console.error('downloadTelegramFile: fileId and botToken are required');
		return null;
	}
	
	try {
		const fileInfoResponse = await fetch(
			`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
		);
		
		if (!fileInfoResponse.ok) {
			console.error(`Telegram API error: ${fileInfoResponse.status} ${fileInfoResponse.statusText}`);
			return null;
		}
		
		const fileData = await fileInfoResponse.json();
		
		if (!fileData.ok || !fileData.result || !fileData.result.file_path) {
			console.error('Invalid file data from Telegram API:', fileData);
			return null;
		}
		
		const filePath = fileData.result.file_path;
		const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
		const response = await fetch(fileUrl);
		
		if (!response.ok) {
			console.error(`Failed to download file: ${response.status} ${response.statusText}`);
			return null;
		}
		
		return Buffer.from(await response.arrayBuffer());
	} catch (error) {
		console.error('Error downloading image from Telegram:', error.message);
		console.error('Stack trace:', error.stack);
		return null;
	}
};

module.exports = {
	getMessageTextById,
	getHighestQualityPhoto,
	downloadTelegramFile,
};

