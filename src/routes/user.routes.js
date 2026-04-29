const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/userController');
const { protect, responsableOnly } = require('../middleware/auth');

// Toutes les routes utilisateur nécessitent d'être connecté
router.use(protect);

// ── Responsable uniquement ───────────────────────────────────
router.get   ('/',     responsableOnly, ctrl.getUsers);
router.post  ('/new',  responsableOnly, ctrl.createUser);
router.put   ('/:id',  responsableOnly, ctrl.updateUser);
router.delete('/:id',  responsableOnly, ctrl.deleteUser);

module.exports = router;
