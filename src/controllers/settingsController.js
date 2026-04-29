/**
 * settingsController.js
 *
 * Gestion des paramètres globaux du site.
 * Actuellement : chiffrement AES-128 réseau LoRa.
 *
 * La clé AES est stockée dans le modèle Site (champ aesEnabled + aesKey).
 * Elle est ensuite propagée à tous les nœuds en ligne (champ aes dans Node).
 */

const Site = require('../models/Site');
const Node = require('../models/Node');
const Log  = require('../models/Log');

// ── Validation clé AES-128 (32 caractères hex) ──────────────
const AES_REGEX = /^[0-9A-Fa-f]{32}$/;
const isValidAESKey = (key) => AES_REGEX.test(key?.replace(/-/g, ''));
const cleanKey = (key) => (key ?? '').replace(/-/g, '').toUpperCase();

// ────────────────────────────────────────────────────────────
//  GET /api/settings/encryption
//  Récupère la config AES actuelle du site (Responsable only)
// ────────────────────────────────────────────────────────────
exports.getEncryption = async (req, res, next) => {
  try {
    const site = await Site.findOne({ siteId: req.user.siteId });
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    res.json({
      aesEnabled: site.aesEnabled ?? true,
      // Retourner la clé masquée (sécurité) — le front ne doit jamais voir la clé en clair
      aesKey: site.aesKey
        ? site.aesKey.slice(0, 4) + '••••••••••••••••••••••••' + site.aesKey.slice(-4)
        : null,
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/settings/encryption
//  Met à jour la config AES et la propage aux nœuds en ligne
//  Responsable uniquement (vérifié dans la route)
// ────────────────────────────────────────────────────────────
exports.updateEncryption = async (req, res, next) => {
  try {
    const { aesEnabled, aesKey } = req.body;

    if (typeof aesEnabled !== 'boolean') {
      return res.status(400).json({ message: 'aesEnabled doit être un booléen.' });
    }

    // Valider la clé si le chiffrement est activé
    let cleanedKey = null;
    if (aesEnabled) {
      if (!aesKey) {
        return res.status(400).json({ message: 'Une clé AES-128 est requise quand le chiffrement est activé.' });
      }
      cleanedKey = cleanKey(aesKey);
      if (!isValidAESKey(cleanedKey)) {
        return res.status(400).json({ message: 'Clé AES invalide. 32 caractères hexadécimaux requis (0-9, A-F).' });
      }
    }

    // Mettre à jour le site
    const site = await Site.findOneAndUpdate(
      { siteId: req.user.siteId },
      {
        aesEnabled,
        aesKey: cleanedKey,
        updatedAt: new Date(),
      },
      { new: true, upsert: false }
    );
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    // Propager le flag AES à tous les nœuds actifs du site
    const updateResult = await Node.updateMany(
      { siteId: req.user.siteId, active: { $ne: false } },
      { $set: { aes: aesEnabled, updatedAt: new Date() } }
    );

    // Compter les nœuds en ligne vs hors ligne
    const onlineCount  = await Node.countDocuments({ siteId: req.user.siteId, status: 'online' });
    const offlineCount = await Node.countDocuments({ siteId: req.user.siteId, status: { $ne: 'online' } });

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Chiffrement AES-128 ${aesEnabled ? 'activé' : 'désactivé'} par ${req.user.fullName}. ${updateResult.modifiedCount} nœud(s) mis à jour.`,
    });

    res.json({
      message:      `Chiffrement ${aesEnabled ? 'activé' : 'désactivé'} sur ${updateResult.modifiedCount} nœud(s).`,
      aesEnabled,
      updatedNodes: onlineCount,
      pendingNodes: offlineCount,
    });
  } catch (err) { next(err); }
};