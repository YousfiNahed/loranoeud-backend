const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── Schéma des permissions (Technicien uniquement) ───────────
// Ces 4 permissions peuvent être accordées par le Responsable.
// Lecture des nœuds et consultation des logs = accessibles à tous.
// Chiffrement AES et gestion des comptes = Responsable uniquement (géré par le rôle).
const PermissionsSchema = new mongoose.Schema({
  canConfigureNodes: { type: Boolean, default: false }, // Modifier RS485/LoRa d'un nœud existant
  canManageNodes:    { type: Boolean, default: false }, // Ajouter / supprimer des nœuds
  canManageTopology: { type: Boolean, default: false }, // Lier/délier nœuds aux routeurs
  canLaunchOTA:      { type: Boolean, default: false }, // Mettre à jour le firmware
}, { _id: false });

// ── Schéma utilisateur ───────────────────────────────────────
const UserSchema = new mongoose.Schema({
  siteId:   { type: String, required: true, ref: 'Site' },
  fullName: { type: String, required: true, trim: true },
  email:    { type: String, required: true, trim: true, lowercase: true },

  // 2 rôles uniquement
  role: {
    type:     String,
    enum:     ['Responsable', 'Technicien'],
    required: true,
  },

  // Responsable → mot de passe hashé
  password: { type: String },

  // Technicien → PIN hashé (4 chiffres)
  pin: { type: String },

  permissions: { type: PermissionsSchema, default: () => ({}) },

  active:    { type: Boolean, default: true },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ── Index unique email par site ──────────────────────────────
UserSchema.index({ siteId: 1, email: 1 }, { unique: true });

// ── Hash password/pin avant sauvegarde ───────────────────────
UserSchema.pre('save', async function (next) {
  this.updatedAt = Date.now();

  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  if (this.isModified('pin') && this.pin) {
    this.pin = await bcrypt.hash(this.pin, 10);
  }
  next();
});

// ── Méthodes ────────────────────────────────────────────────
UserSchema.methods.comparePassword = function (pwd) {
  return bcrypt.compare(pwd, this.password);
};

UserSchema.methods.comparePin = function (pin) {
  return bcrypt.compare(pin, this.pin);
};

UserSchema.methods.toSafeObject = function () {
  return {
    id:          this._id,
    siteId:      this.siteId,
    fullName:    this.fullName,
    email:       this.email,
    role:        this.role,
    username:    this.fullName,
    permissions: this.permissions,
    active:      this.active,
    lastLogin:   this.lastLogin,
  };
};

module.exports = mongoose.model('User', UserSchema);