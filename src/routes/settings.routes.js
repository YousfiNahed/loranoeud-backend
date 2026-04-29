/**
 * settings.routes.js
 *
 * Routes paramètres globaux du site.
 * Toutes les routes ici sont réservées au Responsable.
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/settingsController');
const { protect, responsableOnly } = require('../middleware/auth');

// Toutes les routes settings nécessitent d'être connecté ET d'être Responsable
router.use(protect);
router.use(responsableOnly);

// GET  /api/settings/encryption  → lire la config AES
router.get('/encryption', ctrl.getEncryption);

// PUT  /api/settings/encryption  → mettre à jour la config AES
router.put('/encryption', ctrl.updateEncryption);

module.exports = router;