/**
 * routes/sync_routes.js — BACKEND
 *
 * Routes de synchronisation WatermelonDB ↔ MongoDB Atlas
 * Appelées automatiquement par le service de sync sur le téléphone.
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/syncController');
const { protect } = require('../middleware/auth');

// Toutes les routes sync nécessitent d'être authentifié
router.use(protect);

// POST /api/sync/pull → télécharger les changements du cloud vers le téléphone
router.post('/pull', ctrl.pull);

// POST /api/sync/push → envoyer les changements du téléphone vers le cloud
router.post('/push', ctrl.push);

module.exports = router;