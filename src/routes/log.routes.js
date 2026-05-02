const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/logController');
const { protect, responsableOnly } = require('../middleware/auth');

router.use(protect);

// Lecture : tous les rôles
router.get('/', ctrl.getLogs);

// ✅ Création : tous les rôles (push offline-first depuis l'app)
router.post('/', ctrl.createLog);

// Vider les logs : Responsable uniquement
router.delete('/', responsableOnly, ctrl.clearLogs);

module.exports = router;