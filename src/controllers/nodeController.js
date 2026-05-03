/**
 * nodeController.js — VERSION FINALE
 *
 * LOGIQUE DE CONFIGURATION :
 *
 * 1. L'app envoie PUT /api/nodes/:id au backend (téléphone sur Internet)
 * 2. Le backend sauvegarde la config en base
 * 3. Le backend tente d'envoyer la config à la carte via POST http://<ip>/config
 *    - Si la carte répond OK  → configPending = false, carte redémarre
 *    - Si la carte est hors ligne → configPending = true, sera renvoyée
 *      automatiquement quand la carte appellera POST /api/nodes/announce
 * 4. Le backend répond à l'app avec le résultat
 *
 * LOGIQUE LIVE DATA (GET /api/nodes/:id/live) :
 *   → Interroge GET http://<ip>/stats sur le firmware (vraies valeurs)
 *   → Met à jour rssi / snr / latency en base
 *   → Si la carte est hors ligne, retourne les dernières valeurs connues
 *
 * Le téléphone n'a JAMAIS besoin de se connecter directement à la carte.
 */

const mongoose  = require('mongoose');
const http      = require('http');
const Node      = require('../models/Node');
const Log       = require('../models/Log');
const { pushConfigToNode, retryPendingConfig } = require('../services/nodePusher');

// ── Helpers validation ────────────────────────────────────────
const IP_REGEX       = /^(\d{1,3}\.){3}\d{1,3}$/;
const MAC_REGEX      = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const VALID_OUTPUTS  = ['Modbus RTU', 'Wi-Fi', 'Ethernet'];

const isValidIP  = (v) => {
  const s = v?.trim() ?? '';
  if (!IP_REGEX.test(s)) return false;
  return s.split('.').every(p => { const n = parseInt(p, 10); return n >= 0 && n <= 255; });
};
const isValidMAC = (v) => v && MAC_REGEX.test(v.trim());
const isValidObjectId = (id) =>
  id && mongoose.Types.ObjectId.isValid(id) &&
  String(new mongoose.Types.ObjectId(id)) === String(id);

const validateOutputFields = (mode, output, wifiSsid, wifiPass) => {
  if (mode !== 'Master') return null;
  if (output && !VALID_OUTPUTS.includes(output))
    return 'Type de sortie invalide. Valeurs acceptées : Modbus RTU, Wi-Fi, Ethernet.';
  if (output === 'Wi-Fi') {
    if (!wifiSsid?.trim()) return 'Le SSID du réseau Wi-Fi est requis.';
    if (!wifiPass?.trim()) return 'Le mot de passe Wi-Fi est requis.';
  }
  return null;
};

// ── Fetch GET http://<ip>/stats avec timeout ──────────────────
// Retourne { rssi, snr, latency, uptime, freeHeap, ... } ou null si injoignable
const STATS_TIMEOUT_MS = 3000;

function fetchFirmwareStats(ip) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, STATS_TIMEOUT_MS);
    const req = http.get(`http://${ip}/stats`, { timeout: STATS_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => { clearTimeout(timer); resolve(null); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ────────────────────────────────────────────────────────────
//  GET /api/nodes  —  Liste tous les nœuds du site
// ────────────────────────────────────────────────────────────
exports.getNodes = async (req, res, next) => {
  try {
    const nodes = await Node.find({ siteId: req.user.siteId, active: true }).sort({ name: 1 });

    const formatted = nodes.map(n => ({
      id:             n._id,
      _id:            n._id,
      name:           n.name,
      nodeId:         n.nodeId,
      ip:             n.nodeId,
      ipAddr:         n.nodeId,
      macAddress:     n.macAddress,
      mode:           n.mode,
      subtitle:       `${n.nodeId ?? n.macAddress ?? '—'} · ${n.latency ? n.latency + ' ms' : '—'}`,
      status:         n.status,
      rssi:           n.rssi,
      snr:            n.snr,
      latency:        n.latency,
      lastSeen:       n.lastSeen,
      frequency:      n.frequency,
      sf:             n.sf,
      bw:             n.bw,
      cr:             n.cr,
      txPower:        n.txPower,
      baudRate:       n.baudRate,
      parity:         n.parity,
      modbusId:       n.modbusId,
      timeout:        n.timeout,
      retries:        n.retries,
      fc:             n.fc,       // ✅ AJOUT — Function Code Modbus
      aes:            n.aes,
      output:         n.mode === 'Master' ? (n.output ?? 'Modbus RTU') : null,
      wifiSsid:       n.mode === 'Master' && n.output === 'Wi-Fi' ? n.wifiSsid : null,
      wifiPass:       n.mode === 'Master' && n.output === 'Wi-Fi' ? n.wifiPass : null,
      parentRouterId: n.parentRouterId,
      detectedVia:    n.detectedVia ?? null,
      firmware:       n.firmware    ?? null,
      configPending:  n.configPending  ?? false,
      configAppliedAt: n.configAppliedAt ?? null,
      configError:    n.configError ?? null,
    }));

    res.json({ nodes: formatted });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/nodes/:id  —  Détail d'un nœud
// ────────────────────────────────────────────────────────────
exports.getNode = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'ID de nœud invalide.' });

    const node = await Node.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!node) return res.status(404).json({ message: 'Nœud introuvable.' });

    const obj = node.toObject();
    res.json({
      node: {
        ...obj,
        id:     node._id,
        _id:    node._id,
        ip:     node.nodeId,
        ipAddr: node.nodeId,
      },
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/nodes  —  Enregistrer un nouveau nœud
// ────────────────────────────────────────────────────────────
exports.createNode = async (req, res, next) => {
  try {
    const {
      name, mode, baudRate, parity, modbusId, timeout,
      frequency, sf, bw, cr, txPower, aes,
      detectedVia, firmware,
      output, wifiSsid, wifiPass,
    } = req.body;

    const ip  = (req.body.nodeId ?? req.body.ipAddr ?? '').trim() || null;
    const mac = (req.body.macAddress ?? '').trim().toUpperCase()  || null;

    if (!name?.trim())
      return res.status(400).json({ message: 'Le nom est requis.' });

    if (!ip && !mac)
      return res.status(400).json({
        message: 'Au moins une adresse est requise : IP (Wi-Fi) ou MAC (Bluetooth).',
      });

    if (ip && !isValidIP(ip))
      return res.status(400).json({ message: 'Adresse IP invalide. Format : 192.168.X.X' });

    if (mac && !isValidMAC(mac))
      return res.status(400).json({ message: 'Adresse MAC invalide. Format : XX:XX:XX:XX:XX:XX' });

    const resolvedMode = mode ?? 'Slave';
    const outputError  = validateOutputFields(resolvedMode, output, wifiSsid, wifiPass);
    if (outputError) return res.status(400).json({ message: outputError });

    if (mac) {
      const dup = await Node.findOne({ siteId: req.user.siteId, macAddress: mac });
      if (dup) return res.status(409).json({
        message: `Cette carte existe déjà sous le nom "${dup.name}" (MAC : ${mac}).`,
      });
    }
    if (ip) {
      const dup = await Node.findOne({ siteId: req.user.siteId, nodeId: ip });
      if (dup) return res.status(409).json({
        message: `Un nœud avec l'IP ${ip} existe déjà (${dup.name}).`,
      });
    }

    const validIfaces     = ['bluetooth', 'wifi'];
    const safeDetectedVia = validIfaces.includes(detectedVia) ? detectedVia : null;

    const nodeData = {
      siteId:      req.user.siteId,
      name:        name.trim(),
      nodeId:      ip,
      macAddress:  mac,
      mode:        resolvedMode,
      baudRate:    baudRate  ?? '9600',
      parity:      parity    ?? 'None',
      modbusId:    modbusId  ?? '1',
      timeout:     timeout   ?? 1000,
      frequency:   frequency ?? '868 MHz',
      sf:          sf        ?? 'SF10',
      bw:          bw        ?? '125 kHz',
      cr:          cr        ?? '4/5',
      txPower:     txPower   ?? 17,
      aes:         aes !== false,
      detectedVia: safeDetectedVia,
      firmware:    firmware?.trim() || null,
      configPending: true,
      configError:   null,
    };

    if (resolvedMode === 'Master') {
      nodeData.output = output ?? 'Modbus RTU';
      if (nodeData.output === 'Wi-Fi') {
        nodeData.wifiSsid = wifiSsid?.trim() || null;
        nodeData.wifiPass = wifiPass?.trim() || null;
      }
    }

    const node = await Node.create(nodeData);

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Nœud ajouté : ${node.name} — ${[ip ? `IP ${ip}` : null, mac ? `MAC ${mac}` : null].filter(Boolean).join(' · ')} par ${req.user.fullName}`,
    });

    const pushResult = await pushConfigToNode(node);

    const nodeObj = node.toObject();
    res.status(201).json({
      message: pushResult.success
        ? 'Nœud enregistré et config envoyée à la carte.'
        : 'Nœud enregistré. La carte recevra la config dès sa connexion au réseau.',
      node: {
        ...nodeObj,
        id:     node._id,
        _id:    node._id,
        ip:     node.nodeId,
        ipAddr: node.nodeId,
      },
      push: pushResult,
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/nodes/:id  —  Modifier la config d'un nœud
// ────────────────────────────────────────────────────────────
exports.updateNode = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'ID de nœud invalide.' });

    const node = await Node.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!node) return res.status(404).json({ message: 'Nœud introuvable.' });

    if (req.body.nodeId || req.body.ipAddr) {
      const newIP = (req.body.nodeId ?? req.body.ipAddr).trim();
      if (!isValidIP(newIP))
        return res.status(400).json({ message: 'Adresse IP invalide. Format : 192.168.X.X' });
      if (newIP !== node.nodeId) {
        const dup = await Node.findOne({ siteId: req.user.siteId, nodeId: newIP });
        if (dup) return res.status(409).json({
          message: `L'IP ${newIP} est déjà utilisée par ${dup.name}.`,
        });
        node.nodeId = newIP;
      }
    }

    if (req.body.macAddress) {
      const newMAC = req.body.macAddress.trim().toUpperCase();
      if (!isValidMAC(newMAC))
        return res.status(400).json({ message: 'Adresse MAC invalide.' });
      node.macAddress = newMAC;
    }

    const finalMode = req.body.mode ?? node.mode;
    if (finalMode === 'Master') {
      const outputError = validateOutputFields(
        finalMode,
        req.body.output   ?? node.output,
        req.body.wifiSsid ?? node.wifiSsid,
        req.body.wifiPass ?? node.wifiPass,
      );
      if (outputError) return res.status(400).json({ message: outputError });
    }

    const allowed = [
      'name', 'mode', 'baudRate', 'parity', 'modbusId', 'timeout', 'retries', 'fc',
      'frequency', 'sf', 'bw', 'cr', 'txPower', 'lowPower', 'aes',
      'output', 'wifiSsid', 'wifiPass',
      'parentRouterId', 'detectedVia', 'firmware',
    ]; // ✅ Ajout : retries, fc, lowPower — étaient absents
    allowed.forEach(key => {
      if (req.body[key] !== undefined) node[key] = req.body[key];
    });

    node.configPending = true;
    node.configError   = null;
    await node.save();

    const pushResult = await pushConfigToNode(node);

    await Log.add(req.user.siteId, {
      tag: 'SYS',
      type: pushResult.success ? 'ok' : 'warn',
      msg: `Nœud modifié : ${node.name} — push ${pushResult.success ? 'OK' : 'en attente'} — par ${req.user.fullName}`,
    });

    const nodeObj = node.toObject();
    res.json({
      message: pushResult.success
        ? 'Configuration sauvegardée et envoyée à la carte. Elle redémarre.'
        : pushResult.pending
          ? 'Configuration sauvegardée. La carte est hors ligne, elle recevra la config dès sa reconnexion.'
          : 'Configuration sauvegardée. Vérifiez la connexion avec la carte.',
      node: {
        ...nodeObj,
        id:     node._id,
        _id:    node._id,
        ip:     node.nodeId,
        ipAddr: node.nodeId,
      },
      push: pushResult,
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/nodes/:id
// ────────────────────────────────────────────────────────────
exports.deleteNode = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'ID de nœud invalide.' });

    const node = await Node.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!node) return res.status(404).json({ message: 'Nœud introuvable.' });

    await node.deleteOne();
    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Nœud supprimé : ${node.name} par ${req.user.fullName}`,
    });
    res.json({ message: 'Nœud supprimé.' });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/nodes/announce  —  Route PUBLIQUE (pas de token)
//  La carte appelle cette route au démarrage pour signaler son IP.
//  Body : { mac: "XX:XX:XX:XX:XX:XX", ip: "192.168.1.75" }
// ────────────────────────────────────────────────────────────
exports.announceNode = async (req, res, next) => {
  try {
    const mac = (req.body.mac ?? '').trim().toUpperCase();
    const ip  = (req.body.ip  ?? '').trim();

    if (!mac || !MAC_REGEX.test(mac))
      return res.status(400).json({ message: 'MAC invalide ou manquante.' });
    if (!ip || !isValidIP(ip))
      return res.status(400).json({ message: 'IP invalide ou manquante.' });

    const node = await Node.findOne({ macAddress: mac });
    if (!node) {
      return res.status(404).json({ message: 'Carte non enregistrée.' });
    }

    const oldIP = node.nodeId;

    node.nodeId   = ip;
    node.status   = 'online';
    node.lastSeen = new Date();
    await node.save();

    if (oldIP !== ip) {
      await Log.add(node.siteId, {
        tag: 'SYS', type: 'info',
        msg: `Carte ${node.name} : nouvelle IP ${ip}${oldIP ? ` (ancienne : ${oldIP})` : ''}`,
      });
    }

    if (node.configPending) {
      retryPendingConfig(node).catch(err =>
        console.error('[announce] Erreur push config:', err)
      );
    }

    res.json({
      message: 'IP mise à jour.',
      configPending: node.configPending,
      node: { id: node._id, name: node.name, ip: node.nodeId },
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/nodes/:id/live
//
//  Interroge GET http://<ip>/stats sur le firmware ESP32.
//  Le firmware retourne les vraies valeurs LoRa :
//    { rssi, snr, latency, uptime, freeHeap, loraOk, loraTotal, ok }
//
//  Si la carte est joignable  → valeurs temps réel sauvegardées en base
//  Si la carte est hors ligne → dernières valeurs connues (base) + fromCache:true
// ────────────────────────────────────────────────────────────
exports.getLiveData = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'ID de nœud invalide.' });

    const node = await Node.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!node) return res.status(404).json({ message: 'Nœud introuvable.' });

    const ip = node.nodeId;
    let liveStats  = null;
    let fromCache  = false;
    let firmwareOnline = false;

    // ── Interroger le firmware si on a une IP ─────────────────
    if (ip && isValidIP(ip)) {
      liveStats = await fetchFirmwareStats(ip);
    }

    if (liveStats && liveStats.ok !== false) {
      // ── Valeurs réelles depuis la carte ──────────────────────
      firmwareOnline = true;

      const rssi    = typeof liveStats.rssi    === 'number' ? liveStats.rssi    : null;
      const snr     = typeof liveStats.snr     === 'number' ? liveStats.snr     : null;
      const latency = typeof liveStats.latency === 'number' ? liveStats.latency : null;

      // Sauvegarder en base pour la prochaine fois (cache)
      const updates = { lastSeen: new Date(), status: 'online' };
      if (rssi    !== null) updates.rssi    = rssi;
      if (snr     !== null) updates.snr     = snr;
      if (latency !== null) updates.latency = latency;

      await Node.updateOne({ _id: node._id }, updates);

      return res.json({
        id:       node._id,
        _id:      node._id,
        ip,
        name:     node.name,
        status:   'online',
        fromCache: false,
        firmwareOnline: true,
        // Valeurs LoRa réelles
        rssi,
        snr,
        latency,
        // Infos supplémentaires du firmware
        uptime:    liveStats.uptime    ?? null,
        freeHeap:  liveStats.freeHeap  ?? null,
        loraOk:    liveStats.loraOk    ?? null,
        loraTotal: liveStats.loraTotal ?? null,
        mode:      liveStats.mode      ?? node.mode,
        firmware:  liveStats.firmware  ?? node.firmware,
        lastSeen:  new Date(),

      });

    } else {
      // ── Carte hors ligne : retourner le cache BDD ─────────────
      fromCache = true;
      firmwareOnline = false;

      // Si la carte était online et ne répond plus → passer offline
      if (node.status === 'online') {
        await Node.updateOne({ _id: node._id }, { status: 'offline' });
      }

      return res.json({
        id:       node._id,
        _id:      node._id,
        ip,
        name:     node.name,
        status:   'offline',
        fromCache: true,
        firmwareOnline: false,
        // Dernières valeurs connues
        rssi:     node.rssi     ?? null,
        snr:      node.snr      ?? null,
        latency:  node.latency  ?? null,
        uptime:   null,
        freeHeap: null,
        loraOk:   null,
        loraTotal: null,
        mode:     node.mode,
        firmware: node.firmware,
        lastSeen: node.lastSeen,

      });
    }

  } catch (err) { next(err); }
};