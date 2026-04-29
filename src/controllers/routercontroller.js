const Node = require('../models/Node');
const Log  = require('../models/Log');

// ────────────────────────────────────────────────────────────
//  GET /api/routers
//  Liste tous les nœuds en mode Routeur du site
// ────────────────────────────────────────────────────────────
exports.getRouters = async (req, res, next) => {
  try {
    // ✅ Fix : ne pas filtrer sur active:true car les anciens documents
    //    peuvent avoir active:undefined (pas défini). On accepte tout sauf false.
    const routers = await Node.find({
      siteId: req.user.siteId,
      mode:   'Routeur',
      active: { $ne: false },   // ← accepte true ET undefined
    }).sort({ name: 1 });

    const formatted = routers.map(n => ({
      id:       n._id,
      name:     n.name,
      nodeId:   n.nodeId,
      subtitle: `${n.nodeId} · Routeur`,
      status:   n.status,
      rssi:     n.rssi ?? null,
    }));

    res.json({ routers: formatted });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/routers/:id/discover
//  Retourne tous les nœuds non-Routeur du site
//  avec un flag assignedToThisRouter pour pré-cocher les bons
// ────────────────────────────────────────────────────────────
exports.discoverNodes = async (req, res, next) => {
  try {
    const routerDoc = await Node.findOne({
      _id:    req.params.id,
      siteId: req.user.siteId,
      mode:   'Routeur',
    });
    if (!routerDoc) {
      return res.status(404).json({ message: 'Routeur introuvable.' });
    }

    // ✅ Fix : ne pas filtrer sur active:true pour les mêmes raisons
    const allNodes = await Node.find({
      siteId: req.user.siteId,
      mode:   { $ne: 'Routeur' },
      active: { $ne: false },
    }).sort({ name: 1 });

    const formatted = allNodes.map(n => ({
      id:       n._id,
      name:     n.name,
      subtitle: `${n.nodeId} · ${n.mode}`,
      mode:     n.mode,
      status:   n.status,
      rssi:     n.rssi ?? null,
      // ✅ Fix : comparaison robuste (gère null, undefined, ObjectId)
      assignedToThisRouter:
        n.parentRouterId != null &&
        String(n.parentRouterId) === String(routerDoc._id),
    }));

    res.json({ nodes: formatted, routerName: routerDoc.name });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/routers/:id/assign
//  Sauvegarde en BD les nœuds sélectionnés comme reliés
//  à ce routeur. Les nœuds désélectionnés sont détachés.
//  Body : { nodeIds: ['mongoId1', 'mongoId2', ...] }
// ────────────────────────────────────────────────────────────
exports.assignNodes = async (req, res, next) => {
  try {
    const { nodeIds } = req.body;

    if (!Array.isArray(nodeIds)) {
      return res.status(400).json({ message: 'nodeIds doit être un tableau.' });
    }

    const routerDoc = await Node.findOne({
      _id:    req.params.id,
      siteId: req.user.siteId,
      mode:   'Routeur',
    });
    if (!routerDoc) {
      return res.status(404).json({ message: 'Routeur introuvable.' });
    }

    // 1️⃣ Détacher les nœuds qui étaient liés mais ne sont plus sélectionnés
    await Node.updateMany(
      {
        siteId:         req.user.siteId,
        parentRouterId: routerDoc._id,
        _id:            { $nin: nodeIds },
      },
      { $set: { parentRouterId: null, updatedAt: new Date() } }
    );

    // 2️⃣ Attacher les nœuds sélectionnés à ce routeur
    if (nodeIds.length > 0) {
      await Node.updateMany(
        { _id: { $in: nodeIds }, siteId: req.user.siteId },
        { $set: { parentRouterId: routerDoc._id, updatedAt: new Date() } }
      );
    }

    // 3️⃣ Log de l'opération
    await Log.add(req.user.siteId, {
      tag:    'SYS',
      type:   'ok',
      msg:    `${nodeIds.length} nœud(s) assigné(s) au routeur ${routerDoc.name} par ${req.user.fullName}`,
      nodeId: String(routerDoc._id),
    });

    // 4️⃣ Retourner les nœuds finalement rattachés
    const assignedNodes = await Node.find({
      siteId:         req.user.siteId,
      parentRouterId: routerDoc._id,
    }).select('name nodeId mode status rssi latency');

    res.json({
      message:       `${nodeIds.length} nœud(s) assigné(s) au routeur ${routerDoc.name}.`,
      routerId:      routerDoc._id,
      routerName:    routerDoc.name,
      assignedNodes: assignedNodes.map(n => ({
        id:       n._id,
        name:     n.name,
        nodeId:   n.nodeId,
        subtitle: `${n.nodeId} · ${n.mode}`,
        mode:     n.mode,
        status:   n.status,
        rssi:     n.rssi   ?? null,
        latency:  n.latency ?? null,
      })),
    });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/routers/:id/nodes
//  Retourne les nœuds actuellement rattachés à ce routeur
// ────────────────────────────────────────────────────────────
exports.getAssignedNodes = async (req, res, next) => {
  try {
    const routerDoc = await Node.findOne({
      _id:    req.params.id,
      siteId: req.user.siteId,
      mode:   'Routeur',
    });
    if (!routerDoc) {
      return res.status(404).json({ message: 'Routeur introuvable.' });
    }

    // ✅ Fix : ne pas filtrer sur active:true
    const nodes = await Node.find({
      siteId:         req.user.siteId,
      parentRouterId: routerDoc._id,
      active:         { $ne: false },
    }).sort({ name: 1 });

    res.json({
      routerId:   routerDoc._id,
      routerName: routerDoc.name,
      nodes:      nodes.map(n => ({
        id:       n._id,
        name:     n.name,
        nodeId:   n.nodeId,
        subtitle: `${n.nodeId} · ${n.mode}`,
        mode:     n.mode,
        status:   n.status,
        rssi:     n.rssi    ?? null,
        latency:  n.latency ?? null,
      })),
    });
  } catch (err) { next(err); }
};