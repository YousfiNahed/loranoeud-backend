const express = require('express');
const router  = express.Router();
const auth    = require('../controllers/authController');
const { protect, responsableOnly } = require('../middleware/auth');

// ── Routes publiques ─────────────────────────────────────────
router.post('/sites/verify',       auth.verifySite);
router.post('/auth/seed-site',     auth.seedSite);
router.post('/auth/admin-password', auth.adminPassword);
router.post('/auth/pin-login',      auth.pinLogin);
router.get ('/users/profiles',      auth.getProfiles);

// ── Routes protégées ─────────────────────────────────────────
router.put('/auth/change-password', protect, responsableOnly, auth.changePassword);

module.exports = router;