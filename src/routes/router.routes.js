const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/Routercontroller');
const { protect, requirePermission } = require('../middleware/auth');

// Toutes les routes nécessitent d'être connecté
router.use(protect);

// ── Lecture : tous les rôles ─────────────────────────────────
router.get('/',             ctrl.getRouters);       // GET  /api/routers
router.get('/:id/discover', ctrl.discoverNodes);    // GET  /api/routers/:id/discover
router.get('/:id/nodes',    ctrl.getAssignedNodes); // GET  /api/routers/:id/nodes

// ── Assignation : canScanNetwork requis ──────────────────────
router.post('/:id/assign', requirePermission('canScanNetwork'), ctrl.assignNodes); // POST /api/routers/:id/assign

module.exports = router;