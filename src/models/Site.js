const mongoose = require('mongoose');
const crypto   = require('crypto');

// ── Chiffrement de la clé AES avant stockage en base ─────────
// La clé AES-128 (32 hex chars) est chiffrée avec AES-256-CBC
// en utilisant AES_MASTER_KEY depuis les variables d'environnement.
// Ainsi si MongoDB est compromis, la clé LoRa reste protégée.
const MASTER_KEY = process.env.AES_MASTER_KEY; // doit faire 64 hex chars (32 octets)

function encryptAESKey(plainKey) {
  if (!MASTER_KEY || MASTER_KEY.length !== 64) return plainKey; // fallback si pas configuré
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(MASTER_KEY, 'hex'), iv);
  const encrypted = cipher.update(plainKey, 'utf8', 'hex') + cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted; // stocker iv + données chiffrées
}

function decryptAESKey(stored) {
  if (!MASTER_KEY || MASTER_KEY.length !== 64) return stored; // fallback si pas configuré
  if (!stored || !stored.includes(':')) return stored;        // déjà en clair (ancien format)
  const [ivHex, encrypted] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(MASTER_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}

const SiteSchema = new mongoose.Schema({
  siteId:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  siteName:  { type: String, required: true, trim: true },
  active:    { type: Boolean, default: true },

  // ── Chiffrement AES-128 réseau LoRa ──────────────────────
  aesEnabled: { type: Boolean, default: true  },
  aesKey:     { type: String,  default: null  }, // ✅ stocké chiffré avec AES_MASTER_KEY

  // ── Paramètres radio LoRa partagés par tous les nœuds ───
  // Ces 4 paramètres DOIVENT être identiques sur tous les nœuds
  // du réseau pour qu'ils puissent communiquer.
  loraFrequency: { type: String, default: '868 MHz' },
  loraSf:        { type: String, default: 'SF10'    },
  loraBw:        { type: String, default: '125 kHz' },
  loraCr:        { type: String, default: '4/5'     },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ── Chiffrer automatiquement la clé avant sauvegarde ─────────
SiteSchema.pre('save', function (next) {
  if (this.isModified('aesKey') && this.aesKey) {
    // Ne chiffrer que si la clé n'est pas déjà chiffrée (pas de ':')
    if (!this.aesKey.includes(':')) {
      this.aesKey = encryptAESKey(this.aesKey);
    }
  }
  this.updatedAt = Date.now();
  next();
});

// ── Méthode pour lire la clé déchiffrée ──────────────────────
SiteSchema.methods.getDecryptedAESKey = function () {
  return this.aesKey ? decryptAESKey(this.aesKey) : null;
};

module.exports = mongoose.model('Site', SiteSchema);