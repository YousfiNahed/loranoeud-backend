/**
 * controllers/syncController.js  — BACKEND (Node.js)
 *
 * POST /api/sync/pull  — cloud → téléphone
 * POST /api/sync/push  — téléphone → cloud
 */

const Node = require('../models/Node');
const Log  = require('../models/Log');
const Site = require('../models/Site');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
//  Helpers : convertir MongoDB → format SQLite client
// ─────────────────────────────────────────────────────────────
function nodeToWatermelon(n) {
  return {
    id:                String(n._id),
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
    wifi_pass:         '',
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
    mapping_json:      JSON.stringify(n.mapping ?? []),
    sync_pending:      0,
    modified_at:       new Date(n.updatedAt ?? n.createdAt ?? Date.now()).getTime(),
    active:            n.active !== false ? 1 : 0,
    created_at:        new Date(n.createdAt ?? Date.now()).getTime(),
    updated_at:        new Date(n.updatedAt ?? Date.now()).getTime(),
  };
}

function logToWatermelon(l) {
  return {
    id:           String(l._id),
    server_id:    String(l._id),
    site_id:      l.siteId ?? '',
    tag:          l.tag ?? 'SYS',
    type:         l.type ?? 'info',
    msg:          l.msg ?? '',
    node_id:      l.nodeId ?? '',
    sync_pending: 0,
    created_at:   new Date(l.createdAt ?? Date.now()).getTime(),
  };
}

function siteToWatermelon(s) {
  return {
    id:             String(s._id),
    server_id:      String(s._id),
    site_id:        s.siteId ?? '',
    site_name:      s.siteName ?? '',
    aes_enabled:    s.aesEnabled ? 1 : 0,
    aes_key:        '',
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
//
//  Le client envoie :
//    - lastSyncAt        : timestamp du dernier pull réussi
//    - localVersions     : map { server_id → modified_at } pour les nœuds et users
//    - knownLogIds       : liste des server_id de logs déjà présents en local
//    - pendingLogFingerprints : liste { msg, created_at } des logs locaux
//                         en attente (sync_pending=1, pas encore de server_id)
//
//  Anti-doublon logs :
//    1. On exclut les logs dont le _id est dans knownLogIds (déjà synchronisés)
//    2. On exclut les logs dont le msg+createdAt correspond à un fingerprint
//       pending du client (log créé localement, pas encore pushé, mais un autre
//       téléphone l'a déjà pushé → on ne le renvoie pas pour éviter le doublon)
//
//  Anti-conflit nœuds/users :
//    On n'écrase pas une modification locale récente (seuil 30s).
// ─────────────────────────────────────────────────────────────
exports.pull = async (req, res, next) => {
  try {
    const siteId        = req.user.siteId;
    const lastSyncAt    = req.body.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date(0);
    const localVersions = req.body.localVersions ?? {};

    // IDs des logs que le client possède déjà → exclus par _id MongoDB
    const knownLogIds = Array.isArray(req.body.knownLogIds)
      ? req.body.knownLogIds
      : [];

    // Fingerprints des logs locaux en attente sur ce client
    // Format : [{ msg: string, created_at: number (ms) }]
    const pendingFingerprints = Array.isArray(req.body.pendingLogFingerprints)
      ? req.body.pendingLogFingerprints
      : [];

    // Timestamp serveur — référence unique pour tous les téléphones
    const now = Date.now();

    // Filtre MongoDB pour les logs : exclure ceux déjà connus par _id
    const logFilter = { siteId, createdAt: { $gte: lastSyncAt } };
    if (knownLogIds.length > 0) {
      logFilter._id = { $nin: knownLogIds };
    }

    const [nodes, logsRaw, sites, users] = await Promise.all([
      Node.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      Log.find(logFilter).sort({ createdAt: -1 }).limit(200),
      Site.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      User.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
    ]);

    // Filtre JS : exclure les logs dont le contenu correspond à un log
    // pending du client (même msg, créé à ±60s). Evite qu'un téléphone
    // reçoive un log qu'il a lui-même créé mais pas encore pushé.
    const logs = pendingFingerprints.length === 0
      ? logsRaw
      : logsRaw.filter(l => {
          const lMs = new Date(l.createdAt).getTime();
          return !pendingFingerprints.some(
            fp => fp.msg === l.msg && Math.abs(fp.created_at - lMs) < 60000
          );
        });

    // Anti-conflit nœuds : ne pas écraser une modif locale de moins de 30s
    const CONFLICT_THRESHOLD_MS = 30000;

    const filteredNodes = nodes.filter(n => {
      const localModifiedAt = localVersions[String(n._id)];
      if (!localModifiedAt) return true;
      const cloudUpdatedAt = new Date(n.updatedAt ?? n.createdAt).getTime();
      return cloudUpdatedAt > (localModifiedAt + CONFLICT_THRESHOLD_MS);
    });

    const filteredUsers = users.filter(u => {
      const localModifiedAt = localVersions['user_' + String(u._id)];
      if (!localModifiedAt) return true;
      const cloudUpdatedAt = new Date(u.updatedAt ?? u.createdAt).getTime();
      return cloudUpdatedAt > (localModifiedAt + CONFLICT_THRESHOLD_MS);
    });

    const changes = {
      nodes: filteredNodes.map(nodeToWatermelon),
      logs:  logs.map(logToWatermelon),
      sites: sites.map(siteToWatermelon),
      users: filteredUsers.map(userToWatermelon),
      timestamp: now,
    };

    res.json({ changes, timestamp: now });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/push
//
//  Reçoit les modifications locales du téléphone.
//  Traite les nœuds (create/update/delete) et les logs sans server_id.
//
//  Anti-doublon logs :
//    - Si server_id présent et valide → log déjà dans MongoDB, on skip
//    - Si server_id absent → déduplication par contenu (msg + ±60s)
// ─────────────────────────────────────────────────────────────
exports.push = async (req, res, next) => {
  try {
    const siteId     = req.user.siteId;
    const changes    = req.body.changes    ?? {};
    const resetCloud = req.body.resetCloud ?? false;

    if (resetCloud) {
      await Promise.all([
        Node.deleteMany({ siteId }),
        Log.deleteMany({ siteId }),
      ]);
      await Log.add(siteId, {
        tag: 'SYS', type: 'warn',
        msg: `Reset cloud effectue par ${req.user.fullName} — donnees du site effacees et reenregistrees depuis SQLite`,
      });
      console.log(`[syncController] Reset cloud pour le site ${siteId}`);
    }

    // ── Nœuds ─────────────────────────────────────────────────
    const nodeChanges    = changes.nodes ?? {};
    const allNodeChanges = [
      ...(nodeChanges.created ?? []),
      ...(nodeChanges.updated ?? []),
    ];

    for (const raw of allNodeChanges) {
      const serverId = raw.server_id || raw.id;
      if (!serverId || serverId.length !== 24) continue;

      await Node.findOneAndUpdate(
        { _id: serverId, siteId },
        {
          $set: {
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
            updatedAt: new Date(), // timestamp serveur — référence unique
          },
        },
        { new: false }
      );
    }

    for (const raw of (nodeChanges.deleted ?? [])) {
      const serverId = raw.server_id || raw.id;
      if (!serverId || serverId.length !== 24) continue;
      await Node.findOneAndUpdate(
        { _id: serverId, siteId },
        { $set: { active: false, updatedAt: new Date() } }
      );
    }

    // ── Logs ──────────────────────────────────────────────────
    const logChanges = changes.logs ?? {};
    for (const raw of (logChanges.created ?? [])) {

      // server_id présent et valide → déjà dans MongoDB, on skip
      if (raw.server_id && raw.server_id.length === 24) continue;

      // Pas de server_id → déduplication par contenu (msg + ±60s)
      if (raw.msg) {
        const createdAtMs = raw.created_at
          ? new Date(raw.created_at).getTime()
          : Date.now();
        const windowStart = new Date(createdAtMs - 60000);
        const windowEnd   = new Date(createdAtMs + 60000);

        const existing = await Log.findOne({
          siteId,
          msg:       raw.msg,
          createdAt: { $gte: windowStart, $lte: windowEnd },
        });

        if (existing) {
          console.log(`[syncController] Doublon push ignoré : "${raw.msg?.substring(0, 60)}"`);
          continue;
        }
      }

      await Log.add(siteId, {
        tag:    raw.tag    ?? 'SYS',
        type:   raw.type   ?? 'info',
        msg:    raw.msg    ?? '',
        nodeId: raw.node_id ?? undefined,
      });
    }

    // Log de trace (1 seul par push, pas de doublon possible ici)
    if (allNodeChanges.length > 0) {
      await Log.add(siteId, {
        tag: 'SYS', type: 'info',
        msg: `Sync push reçu par ${req.user.fullName} — ${allNodeChanges.length} nœud(s)`,
      });
    }

    res.json({ success: true });

  } catch (err) { next(err); }
};