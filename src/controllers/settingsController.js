/**
 * settingsController.js
 *
 * Gestion des paramètres globaux du site.
 *
 * 1. Chiffrement AES-128 réseau LoRa.
 * 2. Paramètres radio LoRa (frequency, SF, BW, CR) — identiques sur tous les nœuds.
 *
 * La clé AES est stockée dans le modèle Site (champ aesEnabled + aesKey).
 * Les paramètres LoRa sont stockés dans Site et propagés à tous les nœuds via updateMany.
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

    // ✅ OFFLINE-FIRST : retourner la vraie clé pour que l'app
    // puisse initialiser SQLite au premier login sur un nouvel appareil.
    // La clé est protégée par le token JWT (route protégée).
    res.json({
      aesEnabled: site.aesEnabled ?? true,
      aesKey:     site.aesKey ?? null,
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

// ── Validation paramètres LoRa ───────────────────────────────
const VALID_FREQ = ['433 MHz', '868 MHz', '915 MHz'];
const VALID_SF   = ['SF7', 'SF8', 'SF9', 'SF10', 'SF11', 'SF12'];
const VALID_BW   = ['125 kHz', '250 kHz', '500 kHz'];
const VALID_CR   = ['4/5', '4/6', '4/7', '4/8'];

// ────────────────────────────────────────────────────────────
//  GET /api/settings/lora-network
//  Récupère les paramètres LoRa réseau du site (Responsable only)
// ────────────────────────────────────────────────────────────
exports.getLoraNetwork = async (req, res, next) => {
  try {
    const site = await Site.findOne({ siteId: req.user.siteId });
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    res.json({
      loraFrequency: site.loraFrequency ?? '868 MHz',
      loraSf:        site.loraSf        ?? 'SF10',
      loraBw:        site.loraBw        ?? '125 kHz',
      loraCr:        site.loraCr        ?? '4/5',
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/settings/lora-network
//  Met à jour les paramètres radio LoRa et les propage à TOUS les nœuds du site.
//  Responsable uniquement.
//
//  Logique identique à updateEncryption :
//    1. Valide les valeurs reçues
//    2. Sauvegarde dans Site
//    3. Node.updateMany → tous les nœuds actifs reçoivent les nouveaux paramètres
//       + configPending = true (nodePusher les renverra à la carte dès reconnexion)
// ────────────────────────────────────────────────────────────
exports.updateLoraNetwork = async (req, res, next) => {
  try {
    const { loraFrequency, loraSf, loraBw, loraCr } = req.body;

    if (!VALID_FREQ.includes(loraFrequency))
      return res.status(400).json({ message: `Fréquence invalide. Valeurs acceptées : ${VALID_FREQ.join(', ')}.` });
    if (!VALID_SF.includes(loraSf))
      return res.status(400).json({ message: `Spreading Factor invalide. Valeurs acceptées : ${VALID_SF.join(', ')}.` });
    if (!VALID_BW.includes(loraBw))
      return res.status(400).json({ message: `Bandwidth invalide. Valeurs acceptées : ${VALID_BW.join(', ')}.` });
    if (!VALID_CR.includes(loraCr))
      return res.status(400).json({ message: `Coding Rate invalide. Valeurs acceptées : ${VALID_CR.join(', ')}.` });

    // 1. Sauvegarder dans le Site
    const site = await Site.findOneAndUpdate(
      { siteId: req.user.siteId },
      { loraFrequency, loraSf, loraBw, loraCr, updatedAt: new Date() },
      { new: true, upsert: false }
    );
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    // 2. Propager à TOUS les nœuds actifs du site
    //    configPending = true → nodePusher renverra la config à chaque carte dès reconnexion
    const updateResult = await Node.updateMany(
      { siteId: req.user.siteId, active: { $ne: false } },
      {
        $set: {
          frequency:     loraFrequency,
          sf:            loraSf,
          bw:            loraBw,
          cr:            loraCr,
          configPending: true,
          updatedAt:     new Date(),
        },
      }
    );

    const onlineCount  = await Node.countDocuments({ siteId: req.user.siteId, status: 'online',          active: { $ne: false } });
    const offlineCount = await Node.countDocuments({ siteId: req.user.siteId, status: { $ne: 'online' }, active: { $ne: false } });

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Paramètres LoRa réseau mis à jour par ${req.user.fullName} : ${loraFrequency} · ${loraSf} · ${loraBw} · ${loraCr}. ${updateResult.modifiedCount} nœud(s) mis à jour.`,
    });

    res.json({
      message:      `Paramètres LoRa propagés sur ${updateResult.modifiedCount} nœud(s).`,
      loraFrequency, loraSf, loraBw, loraCr,
      updatedNodes:  onlineCount,
      pendingNodes:  offlineCount,
    });
  } catch (err) { next(err); }
};