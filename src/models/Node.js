/**
 * models/Node.js — VERSION FINALE
 *
 * Ajouts par rapport à la version précédente :
 *   - configPending    : true si la config en BDD n'a pas encore été envoyée à la carte
 *   - configAppliedAt  : date de la dernière config confirmée par la carte
 *   - configError      : raison du dernier échec d'envoi
 *   - lowPower, retries, bw, cr : champs manquants dans l'ancienne version
 */

const mongoose = require('mongoose');

const MAC_REGEX  = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const isValidMAC = (v) => v && MAC_REGEX.test(v.trim());

const NodeSchema = new mongoose.Schema({
  siteId: { type: String, required: true, ref: 'Site' },
  name:   { type: String, required: true, trim: true },

  // Adresse permanente — identifiant unique de la carte
  macAddress: {
    type: String, required: true, trim: true,
    validate: {
      validator: v => isValidMAC(v),
      message: 'macAddress invalide. Format : XX:XX:XX:XX:XX:XX',
    },
  },

  mode: { type: String, enum: ['Master', 'Slave', 'Routeur'], default: 'Slave' },

  // RS485 / Modbus
  baudRate: { type: String,  default: '9600' },
  parity:   { type: String,  default: 'None' },
  modbusId: { type: String,  default: '1' },
  timeout:  { type: Number,  default: 1000 },
  retries:  { type: Boolean, default: true },

  // LoRa
  frequency: { type: String, default: '868 MHz' },
  sf:        { type: String, default: 'SF10' },
  bw:        { type: String, default: '125 kHz' },
  cr:        { type: String, default: '4/5' },
  txPower:   { type: Number, default: 17 },
  lowPower:  { type: Boolean, default: false },

  // Sécurité
  aes:    { type: Boolean, default: true },
  aesKey: { type: String,  default: null },

  // Sortie (Master uniquement)
  output:   { type: String, enum: ['Modbus RTU', 'Wi-Fi', 'Ethernet', null], default: null },
  wifiSsid: { type: String, default: null, trim: true },
  wifiPass: { type: String, default: null, trim: true },

  // Routeur parent
  parentRouterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Node', default: null },

  // Détection hardware
  detectedVia: { type: String, enum: ['bluetooth', 'wifi', null], default: null },
  firmware:    { type: String, default: null, trim: true },

  // Date de dernière config envoyée (depuis l'app directement)
  configAppliedAt: { type: Date, default: null },

  // État temps réel (mis à jour par pollNode dans l'app)
  status:   { type: String, enum: ['online', 'offline', 'warning', 'error'], default: 'offline' },
  rssi:     { type: Number },
  snr:      { type: Number },
  latency:  { type: Number },
  lastSeen: { type: Date },

  active:    { type: Boolean, default: true },
  createdAt: { type: Date,    default: Date.now },
  updatedAt: { type: Date,    default: Date.now },
});

// Index unicité par MAC par site
NodeSchema.index({ siteId: 1, macAddress: 1 }, { unique: true });

// Nettoyage automatique avant sauvegarde
NodeSchema.pre('save', function (next) {
  if (this.macAddress) this.macAddress = this.macAddress.trim().toUpperCase();

  // Effacer les champs Master si le mode n'est pas Master
  if (this.mode !== 'Master') {
    this.output   = null;
    this.wifiSsid = null;
    this.wifiPass = null;
  }

  // Effacer les champs WiFi si la sortie n'est pas Wi-Fi
  if (this.output !== 'Wi-Fi') {
    this.wifiSsid = null;
    this.wifiPass = null;
  }

  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Node', NodeSchema);