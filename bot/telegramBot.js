const { Telegraf } = require('telegraf');
const { handleChannelPost } = require('../handlers/channelPostHandler');

let bot = null;

const setupBotHandlers = (botInstance) => {
	botInstance.on('channel_post', async (ctx) => {
		await handleChannelPost(ctx);
	});
};

const initTelegramBot = () => {
	try {
		if (!process.env.TELEGRAM_BOT_TOKEN) {
			console.warn('TELEGRAM_BOT_TOKEN not provided. Bot will not be initialized.');
			return;
		}

		bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
		
		// Setup bot handlers
		setupBotHandlers(bot);
		
		// Set webhook for production or use polling for development
		if (process.env.NODE_ENV === 'production') {
			const webhookUrl = process.env.WEBHOOK_URL || 'https://tele-x-fusion-main.onrender.com/api/webhook';
			
			bot.telegram.setWebhook(webhookUrl, {
				drop_pending_updates: true,
				allowed_updates: ['channel_post', 'message']
			})
				.then(() => {
					console.log(`Webhook set to: ${webhookUrl}`);
					return bot.telegram.getWebhookInfo();
				})
				.then((webhookInfo) => {
					console.log('Webhook info:', JSON.stringify(webhookInfo, null, 2));
				})
				.catch(error => {
					console.error('Failed to set webhook:', error.message);
					if (error.response?.error_code === 409) {
						console.log('Webhook conflict resolved (this is normal when switching from polling)');
					}
				});
		} else {
			// Use long polling for development
			bot.launch()
				.then(() => {
					console.log('Telegram bot started in polling mode');
				})
				.catch(error => {
					console.error('Failed to start bot in polling mode:', error);
				});
		}
		
		// Enable graceful stop
		process.once('SIGINT', () => {
			if (bot) {
				bot.stop('SIGINT');
			}
		});
		process.once('SIGTERM', () => {
			if (bot) {
				bot.stop('SIGTERM');
			}
		});
	} catch (error) {
		console.error('Failed to initialize Telegram bot', error);
	}
};

const getBot = () => bot;

module.exports = {
	initTelegramBot,
	getBot,
};

