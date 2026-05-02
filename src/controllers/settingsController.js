/**
 * settingsController.js
 *
 * Gestion des paramètres globaux du site.
 *
 * 1. Chiffrement AES-128 réseau LoRa — clé en Base64 (16 octets = 24 chars).
 * 2. Paramètres radio LoRa (frequency, SF, BW, CR) — identiques sur tous les nœuds.
 *
 * ARCHITECTURE : SQLite (app) → ESP32 (direct WiFi) → cloud (optionnel)
 * Le backend ne contacte JAMAIS les cartes directement — il ne peut pas
 * joindre leurs IPs locales (192.168.x.x) depuis internet.
 * Il se contente de sauvegarder en MongoDB. L'app mobile lit depuis SQLite
 * et pousse directement vers la carte quand elle est sur le même réseau.
 */

const Site = require('../models/Site');
const Node = require('../models/Node');
const Log  = require('../models/Log');

// ── Validation clé AES-128 en Base64 (16 octets → 24 chars) ──
const AES_B64_REGEX = /^[A-Za-z0-9+/]{22}==$/;
const isValidAESKey = (key) => {
  if (!key || !AES_B64_REGEX.test(key)) return false;
  try { return Buffer.from(key, 'base64').length === 16; }
  catch { return false; }
};

// ────────────────────────────────────────────────────────────
//  GET /api/settings/encryption
// ────────────────────────────────────────────────────────────
exports.getEncryption = async (req, res, next) => {
  try {
    const site = await Site.findOne({ siteId: req.user.siteId });
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    res.json({
      aesEnabled: site.aesEnabled ?? true,
      aesKey:     site.aesKey ?? null, // clé en clair — connexion sécurisée par JWT
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/settings/encryption
//  Sauvegarde en MongoDB. L'app mobile se charge de pousser
//  la config aux cartes directement depuis le réseau local.
// ────────────────────────────────────────────────────────────
exports.updateEncryption = async (req, res, next) => {
  try {
    const { aesEnabled, aesKey } = req.body;

    if (typeof aesEnabled !== 'boolean') {
      return res.status(400).json({ message: 'aesEnabled doit être un booléen.' });
    }

    let cleanedKey = null;
    if (aesEnabled) {
      if (!aesKey) {
        return res.status(400).json({ message: 'Une clé AES-128 est requise quand le chiffrement est activé.' });
      }
      cleanedKey = aesKey.trim();
      if (!isValidAESKey(cleanedKey)) {
        return res.status(400).json({ message: 'Clé AES invalide. 24 caractères Base64 requis (16 octets, ex: aB3+xZ7/kL9mN2pQ4rS6tA==).' });
      }
    }

    // 1. Mettre à jour le Site
    const site = await Site.findOneAndUpdate(
      { siteId: req.user.siteId },
      { aesEnabled, aesKey: cleanedKey, updatedAt: new Date() },
      { new: true, upsert: false }
    );
    if (!site) return res.status(404).json({ message: 'Site introuvable.' });

    // 2. Propager flag + clé à tous les nœuds en MongoDB
    //    configPending = true → l'app mobile poussera la config à la carte
    //    dès qu'elle sera connectée au même réseau WiFi que la carte
    const updateResult = await Node.updateMany(
      { siteId: req.user.siteId, active: { $ne: false } },
      { $set: { aes: aesEnabled, aesKey: cleanedKey, configPending: true, updatedAt: new Date() } }
    );

    const onlineCount  = await Node.countDocuments({ siteId: req.user.siteId, status: 'online' });
    const offlineCount = await Node.countDocuments({ siteId: req.user.siteId, status: { $ne: 'online' } });

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Chiffrement AES-128 ${aesEnabled ? 'activé' : 'désactivé'} par ${req.user.fullName}. ${updateResult.modifiedCount} nœud(s) mis à jour en base.`,
    });

    res.json({
      message:      `Chiffrement ${aesEnabled ? 'activé' : 'désactivé'} — ${updateResult.modifiedCount} nœud(s) mis à jour.`,
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
//  Sauvegarde en MongoDB. L'app mobile se charge de pousser
//  la config aux cartes directement depuis le réseau local.
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

    // 2. Propager à tous les nœuds en MongoDB
    //    configPending = true → l'app mobile poussera la config à la carte
    //    dès qu'elle sera connectée au même réseau WiFi que la carte
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
      msg: `Paramètres LoRa réseau mis à jour par ${req.user.fullName} : ${loraFrequency} · ${loraSf} · ${loraBw} · ${loraCr}. ${updateResult.modifiedCount} nœud(s) mis à jour en base.`,
    });

    res.json({
      message:      `Paramètres LoRa mis à jour — ${updateResult.modifiedCount} nœud(s) en base.`,
      loraFrequency, loraSf, loraBw, loraCr,
      updatedNodes:  onlineCount,
      pendingNodes:  offlineCount,
    });
  } catch (err) { next(err); }
};