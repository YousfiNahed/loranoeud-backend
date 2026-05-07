/**
 * nodeController.js — Architecture 100% offline
 *
 * La config est envoyée DIRECTEMENT par l'app à la carte (WiFi AP ou BLE).
 * Le backend sert uniquement à persister les données dans MongoDB
 * pour la synchronisation optionnelle.
 *
 * FIX : Le 409 retourne toujours { node: { _id } } pour que le client
 * puisse résoudre les doublons et mettre à jour son server_id dans SQLite.
 * Sans ce _id, le client restait bloqué en boucle infinie de retry.
 */

const mongoose  = require('mongoose');
const Node      = require('../models/Node');
const Log       = require('../models/Log');

// ── Helpers validation ────────────────────────────────────────
const MAC_REGEX     = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const VALID_OUTPUTS = ['Modbus RTU', 'Wi-Fi', 'Ethernet'];

const isValidMAC      = (v) => v && MAC_REGEX.test(v.trim());
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

// ────────────────────────────────────────────────────────────
//  GET /api/nodes  —  Liste tous les nœuds du site
//  Supporte ?mac=XX:XX:XX:XX:XX:XX pour chercher par MAC
// ────────────────────────────────────────────────────────────
exports.getNodes = async (req, res, next) => {
  try {
    // ✅ FIX : support du filtre ?mac= utilisé par le fallback doublon
    // dans nodeRepo.js quand le 409 ne contient pas de node._id
    const macFilter = req.query.mac
      ? { macAddress: req.query.mac.trim().toUpperCase() }
      : {};

    const nodes = await Node
      .find({ siteId: req.user.siteId, active: true, ...macFilter })
      .sort({ name: 1 });

    const formatted = nodes.map(n => ({
      id:              n._id,
      _id:             n._id,
      name:            n.name,
      macAddress:      n.macAddress,
      mode:            n.mode,
      subtitle:        `${n.macAddress ?? '—'} · ${n.latency ? n.latency + ' ms' : '—'}`,
      status:          n.status,
      rssi:            n.rssi,
      snr:             n.snr,
      latency:         n.latency,
      lastSeen:        n.lastSeen,
      frequency:       n.frequency,
      sf:              n.sf,
      bw:              n.bw,
      cr:              n.cr,
      txPower:         n.txPower,
      baudRate:        n.baudRate,
      parity:          n.parity,
      modbusId:        n.modbusId,
      timeout:         n.timeout,
      retries:         n.retries,
      aes:             n.aes,
      output:          n.mode === 'Master' ? (n.output ?? 'Modbus RTU') : null,
      wifiSsid:        n.mode === 'Master' && n.output === 'Wi-Fi' ? n.wifiSsid : null,
      wifiPass:        n.mode === 'Master' && n.output === 'Wi-Fi' ? n.wifiPass : null,
      parentRouterId:  n.parentRouterId,
      detectedVia:     n.detectedVia   ?? null,
      firmware:        n.firmware      ?? null,
      configAppliedAt: n.configAppliedAt ?? null,
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
    res.json({ node: { ...obj, id: node._id, _id: node._id } });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/nodes  —  Enregistrer un nouveau nœud
//
//  ✅ FIX : le 409 retourne TOUJOURS { node: { _id, id } }
//  pour que le client (nodeRepo.js) puisse résoudre le doublon
//  et mettre à jour server_id dans SQLite.
//  Sans ce _id, le client boucle indéfiniment en retry.
// ────────────────────────────────────────────────────────────
exports.createNode = async (req, res, next) => {
  try {
    const {
      name, mode, baudRate, parity, modbusId, timeout,
      frequency, sf, bw, cr, txPower, aes,
      detectedVia, firmware,
      output, wifiSsid, wifiPass,
    } = req.body;

    const mac = (req.body.macAddress ?? '').trim().toUpperCase() || null;

    if (!name?.trim())
      return res.status(400).json({ message: 'Le nom est requis.' });

    if (!mac)
      return res.status(400).json({ message: 'L\'adresse MAC est requise (identifiant unique de la carte).' });

    if (!isValidMAC(mac))
      return res.status(400).json({ message: 'Adresse MAC invalide. Format : XX:XX:XX:XX:XX:XX' });

    const resolvedMode = mode ?? 'Slave';
    const outputError  = validateOutputFields(resolvedMode, output, wifiSsid, wifiPass);
    if (outputError) return res.status(400).json({ message: outputError });

    // Vérification doublon par MAC
    // ✅ FIX : on retourne toujours { node: { _id, id } } dans le 409
    const dup = await Node.findOne({ siteId: req.user.siteId, macAddress: mac });
    if (dup) return res.status(409).json({
      message: `Cette carte existe déjà sous le nom "${dup.name}" (MAC : ${mac}).`,
      node: { _id: dup._id, id: dup._id },
    });

    const validIfaces     = ['bluetooth', 'wifi'];
    const safeDetectedVia = validIfaces.includes(detectedVia) ? detectedVia : null;

    const nodeData = {
      siteId:      req.user.siteId,
      name:        name.trim(),
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
      configPending: false,
      configAppliedAt: new Date(),
    };

    if (resolvedMode === 'Master') {
      nodeData.output = output ?? 'Modbus RTU';
      if (nodeData.output === 'Wi-Fi') {
        nodeData.wifiSsid = wifiSsid?.trim() || null;
        nodeData.wifiPass = wifiPass?.trim() || null;
      }
    }

    const node = new Node(nodeData);
    await node.save();

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Nœud enregistré : ${node.name} (MAC: ${mac}) par ${req.user.fullName}`,
    });

    const nodeObj = node.toObject();
    res.status(201).json({
      message: 'Nœud enregistré.',
      node: { ...nodeObj, id: node._id, _id: node._id },
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
      'name', 'mode', 'baudRate', 'parity', 'modbusId', 'timeout', 'retries',
      'frequency', 'sf', 'bw', 'cr', 'txPower', 'lowPower', 'aes',
      'output', 'wifiSsid', 'wifiPass',
      'parentRouterId', 'detectedVia', 'firmware',
    ];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) node[key] = req.body[key];
    });

    // Architecture 100% offline : la config est déjà envoyée à la carte par l'app
    node.configPending   = false;
    node.configAppliedAt = new Date();
    node.configError     = null;
    await node.save();

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Nœud modifié : ${node.name} (MAC: ${node.macAddress}) par ${req.user.fullName}`,
    });

    const nodeObj = node.toObject();
    res.json({
      message: 'Configuration sauvegardée.',
      node: { ...nodeObj, id: node._id, _id: node._id },
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