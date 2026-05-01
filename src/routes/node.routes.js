const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/nodeController');
const { protect, requirePermission } = require('../middleware/auth');

// ── Route publique : la carte ESP32 annonce sa nouvelle IP ───
// IMPORTANT : doit être AVANT router.use(protect)
router.post('/announce', ctrl.announceNode);

// Toutes les autres routes nécessitent d'être connecté
router.use(protect);

// ── Lecture : tous les rôles ─────────────────────────────────
router.get('/',         ctrl.getNodes);
router.get('/:id',      ctrl.getNode);
router.get('/:id/live', ctrl.getLiveData);

// ── Création / Suppression : canManageNodes requis ───────────
router.post  ('/',    requirePermission('canManageNodes'), ctrl.createNode);
router.delete('/:id', requirePermission('canManageNodes'), ctrl.deleteNode);

// ── Modification : canManageNodes OU canConfigureNodes ───────
router.put('/:id', (req, res, next) => {
  const u = req.user;
  if (u.role === 'Responsable') return next();
  if (u.permissions?.canManageNodes || u.permissions?.canConfigureNodes) return next();
  return res.status(403).json({ message: 'Permission refusée. canManageNodes ou canConfigureNodes requis.' });
}, ctrl.updateNode);


module.exports = router;