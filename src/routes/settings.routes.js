/**
 * settings.routes.js
 *
 * OFFLINE-FIRST :
 *   GET  → tous les rôles authentifiés (l'app a besoin des settings pour initialiser SQLite)
 *   PUT  → Responsable uniquement (seul le Responsable peut modifier)
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/settingsController');
const { protect, responsableOnly } = require('../middleware/auth');

router.use(protect);

// GET : tous les rôles — nécessaire pour initialiser SQLite au premier login
router.get('/encryption',   ctrl.getEncryption);
router.get('/lora-network', ctrl.getLoraNetwork);

// PUT : Responsable uniquement
router.put('/encryption',   responsableOnly, ctrl.updateEncryption);
router.put('/lora-network', responsableOnly, ctrl.updateLoraNetwork);

module.exports = router;