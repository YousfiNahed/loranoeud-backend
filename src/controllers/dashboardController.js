const Node = require('../models/Node');
const Log  = require('../models/Log');

// ────────────────────────────────────────────────────────────
//  GET /api/dashboard
//  Statistiques globales du site
// ────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res, next) => {
  try {
    const siteId = req.user.siteId;

    const [totalNodes, onlineNodes, recentLogs] = await Promise.all([
      Node.countDocuments({ siteId, active: true }),
      Node.countDocuments({ siteId, active: true, status: 'online' }),
      Log.find({ siteId }).sort({ createdAt: -1 }).limit(5),
    ]);

    // Latence moyenne
    const nodesWithLatency = await Node.find({ siteId, latency: { $exists: true } });
    const avgLatency = nodesWithLatency.length
      ? Math.round(nodesWithLatency.reduce((s, n) => s + n.latency, 0) / nodesWithLatency.length)
      : 0;

    // Uptime estimé
    const uptime = onlineNodes > 0
      ? ((onlineNodes / Math.max(totalNodes, 1)) * 100).toFixed(1)
      : '0.0';

    const alerts = recentLogs.map(l => ({
      id:    l._id,
      title: l.msg.length > 40 ? l.msg.slice(0, 40) + '…' : l.msg,
      sub:   new Date(l.createdAt).toLocaleTimeString('fr-FR', { hour12: false }) + ' · ' + l.tag,
      type:  l.type === 'error' ? 'error' : l.type === 'warn' ? 'warning' : 'ok',
    }));

    res.json({
      stats: {
        nodes:       onlineNodes,   // nœuds en ligne (utilisé par le front)
        onlineNodes: onlineNodes,   // alias explicite
        total:       totalNodes,    // total tous statuts
        uptime,
        latency: avgLatency,
        loss:    '0.0',
      },
      alerts,
    });
  } catch (err) { next(err); }
};