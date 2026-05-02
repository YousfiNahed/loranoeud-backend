const Log      = require('../models/Log');
const mongoose = require('mongoose');

// ────────────────────────────────────────────────────────────
//  POST /api/logs
//  Reçoit un log créé localement (offline-first push)
//  L'app crée les logs dans SQLite et les pousse ici quand internet dispo
// ────────────────────────────────────────────────────────────
exports.createLog = async (req, res, next) => {
  try {
    const { tag, type, msg, nodeId, createdAt } = req.body;

    if (!msg?.trim())
      return res.status(400).json({ message: 'Le champ msg est requis.' });

    const log = await Log.create({
      siteId:    req.user.siteId,
      tag:       tag  ?? 'SYS',
      type:      type ?? 'info',
      msg:       msg.trim(),
      nodeId:    nodeId ?? null,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
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
      // Si c'est un ObjectId valide, ajouter aussi la forme toString
      if (mongoose.Types.ObjectId.isValid(nodeId)) {
        candidates.push(String(new mongoose.Types.ObjectId(nodeId)));
      }
      filter.nodeId = { $in: candidates };
    }

    const logs = await Log.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit), 500));

    // Stats rapides
    const total    = await Log.countDocuments({ siteId: req.user.siteId });
    const errors   = await Log.countDocuments({ siteId: req.user.siteId, type: 'error' });
    const firstLog = await Log.findOne({ siteId: req.user.siteId }).sort({ createdAt: 1 });
    const uptime   = firstLog
      ? formatUptime(Date.now() - firstLog.createdAt.getTime())
      : '—';

    const formatted = logs.map(l => ({
      id:   l._id,
      time: new Date(l.createdAt).toLocaleTimeString('fr-FR', { hour12: false }),
      tag:  l.tag,
      msg:  l.msg,
      type: l.type,
    }));

    res.json({
      logs: formatted,
      stats: { ok: total, errors, uptime },
    });
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