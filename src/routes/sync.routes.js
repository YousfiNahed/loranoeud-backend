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

// ✅ PULL : cloud → téléphone (nouvelles données des autres utilisateurs)
// Anti-conflit intégré : le serveur compare updatedAt cloud vs modifiedAt local
// et n'écrase jamais une modification locale plus récente.
router.post('/pull', ctrl.pull);

// ✅ PUSH : téléphone → cloud (modifications locales en attente)
router.post('/push', ctrl.push);

module.exports = router;