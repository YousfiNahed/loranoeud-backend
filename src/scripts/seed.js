/**
 * Script de seed — à exécuter une seule fois pour initialiser la base
 * Usage : node src/scripts/seed.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');
const Site     = require('../models/Site');
const Node     = require('../models/Node');
const Log      = require('../models/Log');

const SITE_ID   = process.env.SEED_SITE_ID   || 'loranoeud-site01';
const SITE_NAME = process.env.SEED_SITE_NAME  || 'Usine Nord';
const RESP_EMAIL    = process.env.SEED_RESP_EMAIL    || 'responsable@loranoeud.com';
const RESP_PASSWORD = process.env.SEED_RESP_PASSWORD;  // ✅ OBLIGATOIRE via .env
const TECH_EMAIL    = process.env.SEED_TECH_EMAIL    || 'technicien@loranoeud.com';
const TECH_PIN      = process.env.SEED_TECH_PIN;       // ✅ OBLIGATOIRE via .env

// ── Vérifier que les credentials sont définis ────────────────
if (!RESP_PASSWORD) {
  console.error('❌ ERREUR : SEED_RESP_PASSWORD non défini dans .env');
  console.error('   Ajoutez : SEED_RESP_PASSWORD=VotreMotDePasseSecurise!');
  process.exit(1);
}
if (!TECH_PIN || TECH_PIN.length !== 4 || isNaN(TECH_PIN)) {
  console.error('❌ ERREUR : SEED_TECH_PIN non défini ou invalide dans .env');
  console.error('   Ajoutez : SEED_TECH_PIN=1234  (4 chiffres)');
  process.exit(1);
}

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[SEED] Connecté à MongoDB');

    // ── Nettoyer les données existantes ──────────────────────
    await Promise.all([
      Site.deleteMany({}),
      User.deleteMany({}),
      Node.deleteMany({}),
      Log.deleteMany({}),
    ]);
    console.log('[SEED] Données existantes supprimées');

    // ── Créer le site ────────────────────────────────────────
    await Site.create({ siteId: SITE_ID, siteName: SITE_NAME });
    console.log(`[SEED] Site créé : ${SITE_NAME} (${SITE_ID})`);

    // ── Créer le Responsable ─────────────────────────────────
    await User.create({
      siteId:   SITE_ID,
      fullName: 'Responsable Système',
      email:    RESP_EMAIL,
      role:     'Responsable',
      password: RESP_PASSWORD,
    });
    console.log(`[SEED] Responsable créé : ${RESP_EMAIL} / mot de passe : ${RESP_PASSWORD}`);

    // ── Créer un Technicien de démonstration ─────────────────
    await User.create({
      siteId:   SITE_ID,
      fullName: 'Ahmed Mansour',
      email:    TECH_EMAIL,
      role:     'Technicien',
      pin:      TECH_PIN,
      permissions: {
        canManageNodes:    false,
        canConfigureNodes: false,
        canLaunchOTA:      true,
        canViewLogs:       true,
        canScanNetwork:    false,
      },
    });
    console.log(`[SEED] Technicien créé : ${TECH_EMAIL} / PIN : ${TECH_PIN}`);

    // ── Log initial système ───────────────────────────────────
    await Log.create({
      siteId: SITE_ID,
      tag: 'SYS',
      type: 'ok',
      msg: 'Système initialisé. Aucun nœud enregistré — ajoutez vos nœuds via l\'application.',
    });
    console.log('[SEED] Log initial créé');
    console.log('[SEED] Aucun nœud créé — base propre pour les tests réels');

    console.log('\n✅ Seed terminé avec succès !');
    console.log('─────────────────────────────────────────────');
    console.log(`Site ID     : ${SITE_ID}`);
    console.log(`Responsable : ${RESP_EMAIL}  |  mdp : ${RESP_PASSWORD}`);
    console.log(`Technicien  : ${TECH_EMAIL}  |  PIN : ${TECH_PIN}`);
    console.log('─────────────────────────────────────────────');

  } catch (err) {
    console.error('[SEED] Erreur :', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();