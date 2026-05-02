/**
 * controllers/syncController.js  — BACKEND (Node.js / Render)
 *
 * ═══════════════════════════════════════════════════════
 *  ARCHITECTURE OFFLINE-FIRST — RÈGLES ABSOLUES
 * ═══════════════════════════════════════════════════════
 *
 *  SQLite (téléphone) = source de vérité
 *  MongoDB (cloud)    = sauvegarde secondaire
 *
 *  SENS UNIQUE : téléphone → cloud uniquement
 *
 *  POST /api/sync/push
 *    → Reçoit les enregistrements sync_pending=1 depuis SQLite
 *    → Les applique dans MongoDB
 *    → Retourne { success: true }
 *
 *  POST /api/sync/pull  ← DÉSACTIVÉ (410 Gone)
 *    → Cette route est supprimée pour respecter l'architecture offline-first
 *    → Le cloud ne doit JAMAIS écraser SQLite
 *    → L'initialisation unique passe par GET /api/nodes, /api/users, etc.
 *      avec INSERT OR IGNORE côté SQLite (initializeFromCloudIfEmpty)
 */

const Node = require('../models/Node');
const Log  = require('../models/Log');
const Site = require('../models/Site');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/pull  — DÉSACTIVÉ
//  Route supprimée : le cloud n'écrase jamais SQLite.
//  Retourne 410 Gone pour informer les anciens clients.
// ─────────────────────────────────────────────────────────────
exports.pull = async (req, res) => {
  return res.status(410).json({
    error:   'Route désactivée',
    message: 'Architecture offline-first : le cloud ne doit jamais écraser SQLite. ' +
             'Utilisez initializeFromCloudIfEmpty() au premier démarrage via GET /api/nodes, /api/users, etc.',
  });
};

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/push
//  Reçoit les changements locaux (sync_pending=1) et les applique dans MongoDB
//  Appelé automatiquement par startAutoSync() toutes les 30s
// ─────────────────────────────────────────────────────────────
exports.push = async (req, res, next) => {
  try {
    const siteId  = req.user.siteId;
    const changes = req.body.changes ?? {};

    // ── Traiter les nœuds ────────────────────────────────────
    const nodeChanges = changes.nodes ?? {};
    const allNodeChanges = [
      ...(nodeChanges.created ?? []),
      ...(nodeChanges.updated ?? []),
    ];

    for (const raw of allNodeChanges) {
      const serverId = raw.server_id || raw.id;
      if (!serverId || serverId.length !== 24) continue; // pas un ObjectId MongoDB valide

      const update = {
        mode:      raw.mode,
        baudRate:  raw.baud_rate,
        parity:    raw.parity,
        modbusId:  raw.modbus_id,
        timeout:   raw.timeout,
        retries:   raw.retries === 1 || raw.retries === true,
        fc:        raw.fc,
        txPower:   raw.tx_power,
        lowPower:  raw.low_power === 1 || raw.low_power === true,
        aes:       raw.aes === 1 || raw.aes === true,
        output:    raw.output || null,
        updatedAt: new Date(raw.updated_at ?? Date.now()),
      };

      // Ne mettre à jour que si ce nœud appartient bien au site
      await Node.findOneAndUpdate(
        { _id: serverId, siteId },
        { $set: update },
        { new: false }
      );
    }

    // ── Traiter les suppressions de nœuds ─────────────────────
    for (const raw of (nodeChanges.deleted ?? [])) {
      const serverId = raw.server_id || raw.id;
      if (!serverId || serverId.length !== 24) continue;
      await Node.findOneAndUpdate(
        { _id: serverId, siteId },
        { $set: { active: false, updatedAt: new Date() } }
      );
    }

    // ── Traiter les logs créés localement ─────────────────────
    const logChanges = changes.logs ?? {};
    for (const raw of (logChanges.created ?? [])) {
      // Ne créer le log que s'il n'a pas encore de server_id MongoDB
      if (raw.server_id && raw.server_id.length === 24) continue;
      await Log.add(siteId, {
        tag:    raw.tag ?? 'SYS',
        type:   raw.type ?? 'info',
        msg:    raw.msg ?? '',
        nodeId: raw.node_id ?? undefined,
      });
    }

    await Log.add(siteId, {
      tag: 'SYS', type: 'info',
      msg: `Sync push reçu par ${req.user.fullName} — ${allNodeChanges.length} nœud(s)`,
    });

    res.json({ success: true });

  } catch (err) { next(err); }
};