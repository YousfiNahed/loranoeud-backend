const Log      = require('../models/Log');
const mongoose = require('mongoose');

// ────────────────────────────────────────────────────────────
//  POST /api/logs
//  Reçoit un log créé localement (offline-first push).
//  L'app crée les logs dans SQLite et les pousse ici quand internet dispo.
//
//  ANTI-DOUBLON :
//  Si le réseau est instable, pushPendingLogs() peut envoyer le même log
//  deux fois (timeout côté client → retry au cycle suivant alors que MongoDB
//  a quand même créé le log). On vérifie donc si un log avec le même msg
//  existe déjà dans MongoDB dans une fenêtre de ±60s avant de créer.
//  Si trouvé → on retourne le log existant avec son _id (le client met à jour
//  son server_id localement et ne retentera plus).
// ────────────────────────────────────────────────────────────
exports.createLog = async (req, res, next) => {
  try {
    const { tag, type, msg, nodeId, createdAt } = req.body;

    if (!msg?.trim())
      return res.status(400).json({ message: 'Le champ msg est requis.' });

    const siteId      = req.user.siteId;
    const cleanMsg    = msg.trim();
    const createdAtMs = createdAt ? new Date(createdAt).getTime() : Date.now();
    const windowStart = new Date(createdAtMs - 60000);
    const windowEnd   = new Date(createdAtMs + 60000);

    // Chercher un log identique déjà présent dans MongoDB
    const existing = await Log.findOne({
      siteId,
      msg:       cleanMsg,
      createdAt: { $gte: windowStart, $lte: windowEnd },
    });

    if (existing) {
      // Retourner le log existant — le client récupère son _id et arrête de réessayer
      console.log(`[logController] Doublon ignoré : "${cleanMsg.substring(0, 60)}"`);
      return res.status(201).json({ log: { _id: existing._id, ...existing.toObject() } });
    }

    const log = await Log.create({
      siteId,
      tag:       tag  ?? 'SYS',
      type:      type ?? 'info',
      msg:       cleanMsg,
      nodeId:    nodeId ?? null,
      createdAt: new Date(createdAtMs),
    });

    res.status(201).json({ log: { _id: log._id, ...log.toObject() } });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/logs
//  Récupère les logs du site avec filtre optionnel
// ────────────────────────────────────────────────────────────
exports.getLogs = async (req, res, next) => {
  try {
    const { tag, type, nodeId, limit = 200 } = req.query;

    const filter = { siteId: req.user.siteId };
    if (tag)    filter.tag  = tag.toUpperCase();
    if (type)   filter.type = type;

    // nodeId peut arriver comme ObjectId string ou comme IP string
    // Le champ nodeId dans Log est une String libre → on fait un $in des deux formes
    if (nodeId) {
      const candidates = [nodeId];
      if (mongoose.Types.ObjectId.isValid(nodeId)) {
        candidates.push(String(new mongoose.Types.ObjectId(nodeId)));
      }
      filter.nodeId = { $in: candidates };
    }

    const logs = await Log.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit), 500));

    const total    = await Log.countDocuments({ siteId: req.user.siteId });
    const errors   = await Log.countDocuments({ siteId: req.user.siteId, type: 'error' });
    const firstLog = await Log.findOne({ siteId: req.user.siteId }).sort({ createdAt: 1 });
    const uptime   = firstLog ? formatUptime(Date.now() - firstLog.createdAt.getTime()) : '—';

    const formatted = logs.map(l => ({
      id:   l._id,
      time: new Date(l.createdAt).toLocaleTimeString('fr-FR', { hour12: false }),
      tag:  l.tag,
      msg:  l.msg,
      type: l.type,
    }));

    res.json({ logs: formatted, stats: { ok: total, errors, uptime } });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/logs
//  Vider les logs du site (Responsable only)
// ────────────────────────────────────────────────────────────
exports.clearLogs = async (req, res, next) => {
  try {
    await Log.deleteMany({ siteId: req.user.siteId });
    res.json({ message: 'Journaux effacés.' });
  } catch (err) { next(err); }
};

// ── Helper ───────────────────────────────────────────────────
function formatUptime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}min`;
}