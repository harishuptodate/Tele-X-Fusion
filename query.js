require('dotenv').config();
const mongoose = require('mongoose');
const TelegramMessage = require('./models/TelegramMessage');

// MongoDB connection options
const MONGODB_CONNECTION_OPTIONS = {
	maxPoolSize: 10,
	serverSelectionTimeoutMS: 5000,
	retryWrites: true,
};

// Connect to MongoDB
const connectMongoDB = async () => {
	try {
		await mongoose.connect(process.env.MONGODB_URI, MONGODB_CONNECTION_OPTIONS);
		console.log('Connected to MongoDB');
	} catch (error) {
		console.error('Error connecting to MongoDB:', error);
		throw error;
	}
};

// Query function to get text by messageId
const getTextByMessageId = async (messageId) => {
	try {
		const message = await TelegramMessage.findOne(
			{ messageId: messageId },
			{ text: 1 } // Projection: only fetch text field
		);
		
		if (!message) {
			return null;
		}
		
		return message.text;
	} catch (error) {
		console.error('Error querying message by messageId:', error.message);
		throw error;
	}
};

// Main function to run query
const runQuery = async () => {
	// Get messageId from command line argument
	const messageId = process.argv[2];
	
	if (!messageId) {
		console.error('Usage: node query.js <messageId>');
		process.exit(1);
	}
	
	try {
		await connectMongoDB();
		const text = await getTextByMessageId(messageId);
		
		if (text) {
			console.log('Message Text:');
			console.log(text);
		} else {
			console.log(`No message found with messageId: ${messageId}`);
		}
		
		// Close connection
		await mongoose.connection.close();
		process.exit(0);
	} catch (error) {
		console.error('Query failed:', error);
		await mongoose.connection.close();
		process.exit(1);
	}
};

// Export the query function for use in other files
module.exports = { getTextByMessageId, connectMongoDB };

// Run query if executed directly
if (require.main === module) {
	runQuery();
}

