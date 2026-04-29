const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/logController');
const { protect, responsableOnly } = require('../middleware/auth');

router.use(protect);

// Lecture : tous (canViewLogs est vrai par défaut pour tous)
router.get('/', ctrl.getLogs);

// Vider les logs : Responsable uniquement
router.delete('/', responsableOnly, ctrl.clearLogs);

module.exports = router;
