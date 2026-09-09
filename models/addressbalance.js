var mongoose = require('mongoose')
  , Schema = mongoose.Schema;

// Per-(address, currency) balance — additive side-collection written alongside
// the currency-blind Address collection. Enables per-coin Holders/Supply/richlist
// without touching the existing Address docs, get_address, richlist or address page.
var AddressBalanceSchema = new Schema({
  a_id: { type: String, index: true },
  currency: { type: String, index: true },
  received: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
}, { id: false });

AddressBalanceSchema.index({ a_id: 1, currency: 1 }, { unique: true });
AddressBalanceSchema.index({ currency: 1, balance: -1 });

module.exports = mongoose.model('AddressBalance', AddressBalanceSchema);
