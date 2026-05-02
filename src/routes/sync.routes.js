/**
 * routes/sync_routes.js — BACKEND
 *
 * ═══════════════════════════════════════════════════════
 *  ARCHITECTURE OFFLINE-FIRST — RÈGLE D'OR
 * ═══════════════════════════════════════════════════════
 *
 *  ✅ AUTORISÉ  : téléphone → cloud  (POST /push)
 *  ❌ INTERDIT  : cloud → téléphone  (/pull supprimé)
 *
 *  L'initialisation depuis le cloud se fait via les routes
 *  individuelles GET /api/nodes, GET /api/users, etc.
 *  avec INSERT OR IGNORE côté SQLite (une seule fois).
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/syncController');
const { protect } = require('../middleware/auth');

// Toutes les routes sync nécessitent d'être authentifié
router.use(protect);

// ❌ SUPPRIMÉ : POST /api/sync/pull
// Cette route permettait au cloud d'écraser SQLite — interdit par l'architecture offline-first.
// L'initialisation unique se fait via initializeFromCloudIfEmpty() dans syncService.js
// qui appelle GET /api/nodes, /api/users, /api/settings, /api/routers avec INSERT OR IGNORE.

// ✅ SEUL SENS AUTORISÉ : téléphone → cloud
// Reçoit les enregistrements avec sync_pending=1 et les applique dans MongoDB
router.post('/push', ctrl.push);

module.exports = router;