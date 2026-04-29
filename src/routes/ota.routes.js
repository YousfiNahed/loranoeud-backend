const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const ctrl    = require('../controllers/otaController');
const { protect, requirePermission } = require('../middleware/auth');

// Multer : stocke le fichier .bin dans le dossier uploads/ota/
const upload = multer({
  dest: 'uploads/ota/',
  limits: { fileSize: 4 * 1024 * 1024 }, // max 4 Mo (firmware ESP32)
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.bin')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .bin sont acceptés.'));
    }
  },
});

router.use(protect);

// Lecture version disponible : tous les rôles
router.get('/version', ctrl.getVersion);

// Upload du .bin + lancement OTA : canLaunchOTA requis
// C'est la route appelée par OTAScreen (POST /api/ota/upload)
router.post(
  '/upload',
  requirePermission('canLaunchOTA'),
  upload.single('firmware'),
  ctrl.uploadOTA
);

// Polling du statut d'un job OTA en cours : tous les rôles connectés
// C'est la route appelée par OTAScreen (GET /api/ota/status/:jobId)
router.get('/status/:jobId', ctrl.getOTAStatus);

// Lancer OTA simple (sans fichier) : canLaunchOTA requis
router.post('/launch', requirePermission('canLaunchOTA'), ctrl.launchOTA);

module.exports = router;