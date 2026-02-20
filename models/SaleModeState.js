const mongoose = require('mongoose');

const saleModeStateSchema = new mongoose.Schema({
	isSaleMode: {
		type: Boolean,
		default: false
	},
	lastUpdated: {
		type: Date,
		default: Date.now
	}
}, {
	collection: 'salemodestate'
});

// Ensure only one document exists
saleModeStateSchema.statics.getState = async function() {
	let state = await this.findOne();
	if (!state) {
		state = await this.create({ isSaleMode: false });
	}
	return state;
};

const SaleModeState = mongoose.model('SaleModeState', saleModeStateSchema);

module.exports = SaleModeState;

