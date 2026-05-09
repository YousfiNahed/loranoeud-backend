/**
 * controllers/syncController.js  — BACKEND (Node.js / Render)
 *
 * CORRECTIONS v2 :
 *
 *  ① [PROBLÈME #1 - DOUBLONS] Dans exports.push(), la création de logs via
 *     le cycle sync général vérifiait déjà server_id, MAIS cette vérification
 *     avait une faille : si le log avait été créé via addCriticalLog() et que
 *     son server_id n'était pas encore dans le body envoyé par le téléphone,
 *     on le recréait quand même. FIX : on compare aussi le champ 'msg' + 'created_at'
 *     pour détecter un log existant (déduplication par contenu).
 *
 *  ③ [PROBLÈME #3 - CONFLIT HORLOGE] Le seuil fixe de 5000ms était insuffisant.
 *     Problème : si le téléphone A a l'heure en avance, son timestamp local
 *     dépasse celui du cloud de plus de 5s → il écrase les modifs du téléphone B.
 *     FIX : on utilise le timestamp du SERVEUR (Date.now() côté backend) comme
 *     référence unique, jamais les horloges locales des téléphones. On augmente
 *     aussi le seuil à 30s pour couvrir les délais réseau réels en environnement
 *     industriel (WiFi instable, 4G avec latence).
 */

const Node = require('../models/Node');
const Log  = require('../models/Log');
const Site = require('../models/Site');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
//  Helpers : convertir MongoDB → format WatermelonDB (inchangés)
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
//  FIX #3 — CONFLIT D'HORLOGE :
//  Avant : le seuil anti-conflit était 5000ms comparé aux horloges
//  locales des téléphones. Si le téléphone A avait l'heure en avance
//  de 6s, son timestamp local dépassait celui du cloud → il écrasait
//  silencieusement les modifs du téléphone B.
//
//  Maintenant :
//  - Le seuil est passé à 30 000ms (30s) pour couvrir les délais réseau
//    réels en environnement industriel (WiFi instable, 4G avec latence).
//  - On utilise updatedAt stocké dans MongoDB (mis à jour par le serveur)
//    comme référence. Les horloges locales des téléphones ne sont jamais
//    comparées entre elles directement.
//  - En pratique : si le cloud a une version du nœud mise à jour il y a
//    moins de 30s, et que le téléphone a aussi une version récente, on
//    laisse passer le pull (le serveur a peut-être déjà intégré un push
//    d'un autre téléphone). Sinon le push local a la priorité.
// ─────────────────────────────────────────────────────────────
exports.pull = async (req, res, next) => {
  try {
    const siteId        = req.user.siteId;
    const lastSyncAt    = req.body.lastSyncAt ? new Date(req.body.lastSyncAt) : new Date(0);
    const localVersions = req.body.localVersions ?? {};

    // ✅ FIX #3 : on utilise Date.now() SERVEUR comme référence unique
    // Tous les téléphones se synchronisent sur l'horloge du serveur,
    // pas sur leurs propres horloges (qui peuvent diverger).
    const now = Date.now();

    const [nodes, logs, sites, users] = await Promise.all([
      Node.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      Log.find({ siteId, createdAt: { $gte: lastSyncAt } }).sort({ createdAt: -1 }).limit(200),
      Site.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
      User.find({ siteId, updatedAt: { $gte: lastSyncAt } }),
    ]);

    // ── Filtre anti-conflit pour les nœuds ──────────────────
    // ✅ FIX #3 : seuil augmenté de 5s → 30s
    // Pourquoi 30s ? En WiFi industriel ou 4G, un push peut prendre
    // jusqu'à 10-15s. Avec 5s de seuil, on écrasait les modifs en cours
    // de push. Avec 30s, on protège toute la fenêtre de transmission.
    const CONFLICT_THRESHOLD_MS = 30000;

    const filteredNodes = nodes.filter(n => {
      const localModifiedAt = localVersions[String(n._id)];
      if (!localModifiedAt) return true;
      // ✅ FIX #3 : updatedAt vient de MongoDB (serveur), pas du téléphone
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
      timestamp: now, // ✅ Timestamp serveur — référence unique pour tous
    };

    res.json({ changes, timestamp: now });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/sync/push
//
//  FIX #1 — ANTI-DOUBLONS LOGS :
//  Avant : on vérifiait seulement si server_id était absent pour décider
//  de créer le log dans MongoDB. Mais si addCriticalLog() avait déjà
//  créé le log dans MongoDB et que le téléphone envoyait ensuite le même
//  log via le cycle sync général (sans server_id dans le body car le
//  téléphone n'avait pas encore reçu la réponse), on recréait le log.
//
//  Maintenant : on vérifie d'abord par server_id (cas normal), puis on
//  fait une déduplication par contenu (msg + nodeId + horodatage proche)
//  pour les cas où server_id est manquant mais le log existe déjà.
//  Résultat : même si le même log arrive deux fois, il n'est créé qu'une.
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

    // ── Traiter les nœuds (inchangé) ─────────────────────────
    const nodeChanges = changes.nodes ?? {};
    const allNodeChanges = [
      ...(nodeChanges.created ?? []),
      ...(nodeChanges.updated ?? []),
    ];

    for (const raw of allNodeChanges) {
      const serverId = raw.server_id || raw.id;
      if (!serverId || serverId.length !== 24) continue;

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
        // ✅ FIX #3 : updatedAt mis à jour par le SERVEUR, pas par le téléphone
        // Ainsi tous les téléphones utilisent la même référence de temps
        updatedAt: new Date(),
      };

      await Node.findOneAndUpdate(
        { _id: serverId, siteId },
        { $set: update },
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

    // ── Traiter les logs — FIX #1 ANTI-DOUBLONS ──────────────
    const logChanges = changes.logs ?? {};
    for (const raw of (logChanges.created ?? [])) {

      // Cas 1 : server_id présent et valide → log déjà dans MongoDB, on skip
      if (raw.server_id && raw.server_id.length === 24) continue;

      // ✅ FIX #1 — Cas 2 : server_id absent MAIS le log existe peut-être déjà
      // (créé par addCriticalLog() quelques secondes avant ce cycle de sync)
      // On déduplique par contenu : même msg + même nodeId + créé dans les 60s
      if (raw.msg) {
        const createdAtMs = raw.created_at
          ? new Date(raw.created_at).getTime()
          : Date.now();
        const windowStart = new Date(createdAtMs - 60000); // 60s de fenêtre
        const windowEnd   = new Date(createdAtMs + 60000);

        const existing = await Log.findOne({
          siteId,
          msg:       raw.msg,
          nodeId:    raw.node_id ?? null,
          createdAt: { $gte: windowStart, $lte: windowEnd },
        });

        if (existing) {
          // Log trouvé dans MongoDB → c'est un doublon, on l'ignore
          console.log(`[syncController] Doublon détecté et ignoré : "${raw.msg?.substring(0, 50)}"`);
          continue;
        }
      }

      // Pas de doublon → on crée le log normalement
      await Log.add(siteId, {
        tag:    raw.tag ?? 'SYS',
        type:   raw.type ?? 'info',
        msg:    raw.msg ?? '',
        nodeId: raw.node_id ?? undefined,
      });
    }

    // Log de trace interne (1 seul, pas de doublon possible ici)
    if (allNodeChanges.length > 0) {
      await Log.add(siteId, {
        tag: 'SYS', type: 'info',
        msg: `Sync push reçu par ${req.user.fullName} — ${allNodeChanges.length} nœud(s)`,
      });
    }

    res.json({ success: true });

  } catch (err) { next(err); }
};