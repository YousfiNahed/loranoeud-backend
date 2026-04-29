const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  siteId:    { type: String, required: true },
  tag:       { type: String, default: 'SYS' },      // MODBUS, LORA, OTA, SYS, NET, RSSI
  type:      { type: String, default: 'info' },     // ok, error, warn, info
  msg:       { type: String, required: true },
  nodeId:    { type: String },                       // optionnel : nœud concerné
  createdAt: { type: Date, default: Date.now },
});

LogSchema.index({ siteId: 1, createdAt: -1 });

// ── Helper statique pour ajouter un log facilement ──────────
LogSchema.statics.add = async function (siteId, { tag = 'SYS', type = 'info', msg, nodeId }) {
  try {
    // Toujours stocker nodeId comme String (ObjectId ou IP) pour faciliter le filtre
    const nodeIdStr = nodeId != null ? String(nodeId) : undefined;
    await this.create({ siteId, tag, type, msg, nodeId: nodeIdStr });
  } catch (err) {
    console.error('[Log.add]', err.message);
  }
};

module.exports = mongoose.model('Log', LogSchema);