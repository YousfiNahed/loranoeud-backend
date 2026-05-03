/**
 * controllers/syncController.js  — BACKEND (Node.js / Render)
 *
 * Ces deux routes sont appelées par WatermelonDB sur le téléphone
 * pour synchroniser SQLite local ↔ MongoDB Atlas.
 *
 * POST /api/sync/pull
 *   → Reçoit { lastSyncAt: timestamp }
 *   → Retourne tout ce qui a changé depuis ce timestamp
 *
 * POST /api/sync/push
 *   → Reçoit { changes: { nodes, logs, sites, users } }
 *   → Applique les changements dans MongoDB
 *   → Retourne { success: true }
 */

const Node = require('../models/Node');
const Log  = require('../models/Log');
const Site = require('../models/Site');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
//  Helper : convertir un document MongoDB → format WatermelonDB
// ─────────────────────────────────────────────────────────────
function nodeToWatermelon(n) {
  return {
    id:                String(n._id),  // WatermelonDB utilise 'id' comme clé primaire
    server_id:         String(n._id),
    site_id:           n.siteId ?? '',
    name:              n.name ?? '',
    mac_address:       n.macAddress ?? '',
    node_ip:           n.nodeId ?? '',
    mode:              n.mode ?? 'Slave',
    baud_rate:         n.baudRate ?? '9600',
    parity:            n.parity ?? 'None',
    modbus_id:         n.modbusId ?? '1',
    timeout:           n.timeout ?? 1000,
    retries:           n.retries !== false ? 1 : 0,
    fc:                n.fc ?? 'FC03',
    frequency:         n.frequency ?? '868 MHz',
    sf:                n.sf ?? 'SF10',
    bw:                n.bw ?? '125 kHz',
    cr:                n.cr ?? '4/5',
    tx_power:          n.txPower ?? 17,
    low_power:         n.lowPower ? 1 : 0,
    aes:               n.aes !== false ? 1 : 0,
    output:            n.output ?? '',
    wifi_ssid:         n.wifiSsid ?? '',
    wifi_pass:         '',  // sécurité : on n'envoie pas le mot de passe WiFi
    parent_router_id:  n.parentRouterId ? String(n.parentRouterId) : '',
    detected_via:      n.detectedVia ?? '',
    firmware:          n.firmware ?? '',
    config_pending:    n.configPending ? 1 : 0,
    config_applied_at: n.configAppliedAt ? new Date(n.configAppliedAt).getTime() : 0,
    config_error:      n.configError ?? '',
    status:            n.status ?? 'offline',
    rssi:              n.rssi ?? 0,
    snr:               n.snr ?? 0,
    latency:           n.latency ?? 0,
    last_seen:         n.lastSeen ? new Date(n.lastSeen).getTime() : 0,
    // mapping_json supprimé — rôle SCADA
    sync_pending:      0,
    modified_at:       new Date(n.updatedAt ?? n.createdAt ?? Date.now()).getTime(),
    active:            n.active !== false ? 1 : 0,
    created_at:        new Date(n.createdAt ?? Date.now()).getTime(),
    updated_at:        new Date(n.updatedAt ?? Date.now()).getTime(),
  };
}

function logToWatermelon(l) {
  return {
    id:          String(l._id),
    server_id:   String(l._id),
    site_id:     l.siteId ?? '',
    tag:         l.tag ?? 'SYS',
    type:        l.type ?? 'info',
    msg:         l.msg ?? '',
    node_id:     l.nodeId ?? '',
    sync_pending: 0,
    created_at:  new Date(l.createdAt ?? Date.now()).getTime(),
  };
}

function siteToWatermelon(s) {
  return {
    id:             String(s._id),
    server_id:      String(s._id),
    site_id:        s.siteId ?? '',
    site_name:      s.siteName ?? '',
    aes_enabled:    s.aesEnabled ? 1 : 0,
    aes_key:        '',  // sécurité : ne pas envoyer la clé AES sur le téléphone
    lora_frequency: s.loraFrequency ?? '868 MHz',
    lora_sf:        s.loraSf ?? 'SF10',
    lora_bw:        s.loraBw ?? '125 kHz',
    lora_cr:        s.loraCr ?? '4/5',
    active:         s.active !== false ? 1 : 0,
    sync_pending:   0,
    created_at:     new Date(s.createdAt ?? Date.now()).getTime(),
    updated_at:     new Date(s.updatedAt ?? Date.now()).getTime(),
  };
}

function userToWatermelon(u) {
  return {
    id:               String(u._id),
    server_id:        String(u._id),
    site_id:          u.siteId ?? '',
    full_name:        u.fullName ?? '',
    email:            u.email ?? '',
    role:             u.role ?? 'Technicien',
    permissions_json: JSON.stringify(u.permissions ?? {}),
    active:           u.active !== false ? 1 : 0,
    last_login:       u.lastLogin ? new Date(u.lastLogin).getTime() : 0,
    created_at:       new Date(u.createdAt ?? Date.now()).getTime(),
    updated_at:       new Date(u.updatedAt ?? Date.now()).getTime(),
  };
}

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/pull
//  Retourne tout ce qui a changé depuis lastSyncAt
// ─────────────────────────────────────────────────────────────
exports.pull = async (req, res, next) => {
  try {
    const siteId     = req.user.siteId;
    const lastSyncAt = req.body.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date(0);
    const now        = Date.now();

    // Récupérer tout ce qui a changé depuis le dernier sync
    const [nodes, logs, sites, users] = await Promise.all([
      Node.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      Log.find({ siteId, createdAt: { $gte: lastSyncAt } }).sort({ createdAt: -1 }).limit(200),
      Site.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      User.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
    ]);

    // Construire la réponse au format WatermelonDB
    const changes = {
      nodes: {
        created: nodes.filter(n => new Date(n.createdAt) >= lastSyncAt).map(nodeToWatermelon),
        updated: nodes.filter(n => new Date(n.createdAt) < lastSyncAt).map(nodeToWatermelon),
        deleted: [],  // les suppressions sont gérées par le champ active = false
      },
      logs: {
        created: logs.map(logToWatermelon),
        updated: [],
        deleted: [],
      },
      sites: {
        created: sites.filter(s => new Date(s.createdAt) >= lastSyncAt).map(siteToWatermelon),
        updated: sites.filter(s => new Date(s.createdAt) < lastSyncAt).map(siteToWatermelon),
        deleted: [],
      },
      users: {
        created: users.filter(u => new Date(u.createdAt) >= lastSyncAt).map(userToWatermelon),
        updated: users.filter(u => new Date(u.createdAt) < lastSyncAt).map(userToWatermelon),
        deleted: [],
      },
    };

    res.json({ changes, timestamp: now });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/push
//  Reçoit les changements locaux et les applique dans MongoDB
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