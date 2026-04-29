const Node = require('../models/Node');
const Log  = require('../models/Log');
const fs   = require('fs');

const LATEST_VERSION = 'v1.1.0';

// ── Stockage des jobs OTA en mémoire ─────────────────────────
// En production : utiliser Redis ou MongoDB pour la persistance
const otaJobs = {};

// ── Helper : envoyer le firmware à une carte via HTTP ─────────
async function pushFirmwareToNode(nodeIp, filePath, jobId, nodeId) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const res = await fetch(`http://${nodeIp}/update`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/octet-stream',
        'Content-Length': fileBuffer.length,
        'X-Auth':         process.env.NODE_API_TOKEN || 'loranet2025',
      },
      body: fileBuffer,
    });

    if (res.ok) {
      otaJobs[jobId].nodes[nodeId] = { progress: 100, status: 'done' };
    } else {
      otaJobs[jobId].nodes[nodeId] = { progress: 0, status: 'error', error: `HTTP ${res.status}` };
    }
  } catch (err) {
    otaJobs[jobId].nodes[nodeId] = { progress: 0, status: 'error', error: err.message };
  }

  // Vérifier si tous les nœuds sont terminés
  const allDone = Object.values(otaJobs[jobId].nodes)
    .every(n => n.status === 'done' || n.status === 'error');
  if (allDone) otaJobs[jobId].status = 'done';
}

// ────────────────────────────────────────────────────────────
//  POST /api/ota/upload
//  Reçoit le fichier .bin et lance l'OTA sur les nœuds choisis
//  Body : multipart/form-data avec "firmware" (.bin) + "nodeIds" (JSON)
// ────────────────────────────────────────────────────────────
exports.uploadOTA = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Fichier firmware (.bin) manquant.' });
    }

    const nodeIds = JSON.parse(req.body.nodeIds ?? '[]');
    const version = req.body.version ?? null;

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return res.status(400).json({ message: 'Sélectionnez au moins un nœud.' });
    }

    // Récupérer les nœuds du site avec une IP (online seulement)
    const nodes = await Node.find({
      _id:    { $in: nodeIds },
      siteId: req.user.siteId,
      status: { $ne: 'offline' },
      nodeId: { $ne: null },
    });

    if (nodes.length === 0) {
      return res.status(404).json({ message: 'Aucun nœud en ligne trouvé.' });
    }

    // Créer le job OTA
    const jobId = `ota_${Date.now()}`;
    const nodesState = {};
    nodes.forEach(n => {
      nodesState[String(n._id)] = { progress: 0, status: 'flashing' };
    });

    otaJobs[jobId] = {
      status:    'flashing',
      version,
      nodes:     nodesState,
      createdAt: new Date(),
    };

    // Lancer l'envoi du firmware en arrière-plan (non bloquant)
    nodes.forEach(node => {
      pushFirmwareToNode(node.nodeId, req.file.path, jobId, String(node._id))
        .catch(err => console.error(`[OTA] Erreur nœud ${node.name}:`, err.message));
    });

    await Log.add(req.user.siteId, {
      tag: 'OTA', type: 'info',
      msg: `OTA démarré sur ${nodes.length} nœud(s)${version ? ` · ${version}` : ''} par ${req.user.fullName}`,
    });

    res.json({
      message: `OTA lancé sur ${nodes.length} nœud(s).`,
      jobId,
      version,
      nodeCount: nodes.length,
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/ota/status/:jobId
//  Retourne l'état du job OTA (appelé en polling par le frontend)
// ────────────────────────────────────────────────────────────
exports.getOTAStatus = async (req, res, next) => {
  try {
    const job = otaJobs[req.params.jobId];
    if (!job) {
      return res.status(404).json({ message: 'Job OTA introuvable ou expiré.' });
    }

    // Formater pour le frontend
    const nodes = Object.entries(job.nodes).map(([id, state]) => ({
      id,
      progress: state.progress,
      status:   state.status,
      error:    state.error ?? null,
    }));

    res.json({
      jobId:  req.params.jobId,
      status: job.status,
      nodes,
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/ota/launch
//  Lancer une mise à jour OTA sur les nœuds sélectionnés
// ────────────────────────────────────────────────────────────
exports.launchOTA = async (req, res, next) => {
  try {
    const { nodeIds } = req.body;

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return res.status(400).json({ message: 'Sélectionnez au moins un nœud.' });
    }

    const nodes = await Node.find({
      _id:    { $in: nodeIds },
      siteId: req.user.siteId,
      status: { $ne: 'offline' },
    });

    if (nodes.length === 0) {
      return res.status(404).json({ message: 'Aucun nœud valide trouvé.' });
    }

    await Log.add(req.user.siteId, {
      tag: 'OTA', type: 'info',
      msg: `OTA lancé sur ${nodes.length} nœud(s) par ${req.user.fullName}`,
    });

    res.json({
      message: `OTA lancé sur ${nodes.length} nœud(s).`,
      version: LATEST_VERSION,
      nodeIds: nodes.map(n => n._id),
      names:   nodes.map(n => n.name),
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/ota/version
// ────────────────────────────────────────────────────────────
exports.getVersion = async (req, res, next) => {
  try {
    res.json({
      latestVersion: LATEST_VERSION,
      changelog: [
        'Correction du timeout Modbus sous charge élevée',
        'SF7–SF12 entièrement configurables',
        'Chiffrement AES-128 renforcé',
        'Amélioration du multi-hop LoRa',
      ],
    });
  } catch (err) { next(err); }
};