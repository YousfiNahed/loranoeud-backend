const User = require('../models/User');
const Site = require('../models/Site');
const Log  = require('../models/Log');
const { signToken } = require('../middleware/auth');

// ────────────────────────────────────────────────────────────
//  POST /api/sites/verify
//  Vérifier qu'un siteId existe et est actif
// ────────────────────────────────────────────────────────────
exports.verifySite = async (req, res, next) => {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ message: 'siteId requis.' });

    const site = await Site.findOne({
      siteId: siteId.trim().toLowerCase(),
      active: true,
    });

    if (!site) {
      return res.status(404).json({ message: 'Site introuvable. Vérifiez l\'identifiant.' });
    }

    res.json({ message: 'Site trouvé.', siteName: site.siteName, siteId: site.siteId });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/auth/admin-password
//  Connexion Responsable : vérifier le mot de passe
//  Retourne directement le token final
// ────────────────────────────────────────────────────────────
exports.adminPassword = async (req, res, next) => {
  try {
    const { siteId, password } = req.body;

    if (!siteId || !password) {
      return res.status(400).json({ message: 'siteId et password requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const responsable = await User.findOne({
      siteId: siteId.trim().toLowerCase(),
      role:   'Responsable',
      active: true,
    });

    if (!responsable) {
      return res.status(401).json({ message: 'Compte Responsable introuvable pour ce site.' });
    }

    const isMatch = await responsable.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    // Mettre à jour lastLogin
    responsable.lastLogin = Date.now();
    await responsable.save();

    await Log.add(responsable.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Connexion Responsable : ${responsable.fullName}`,
    });

    const token = signToken(responsable._id);
    res.json({ message: 'Connexion réussie.', token, user: responsable.toSafeObject() });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/auth/pin-login
//  Connexion Technicien : email + PIN
// ────────────────────────────────────────────────────────────
exports.pinLogin = async (req, res, next) => {
  try {
    const { siteId, role, email, pin } = req.body;

    if (!siteId || !role || !email || !pin) {
      return res.status(400).json({ message: 'siteId, role, email et pin requis.' });
    }
    if (role !== 'Technicien') {
      return res.status(400).json({ message: 'Rôle invalide pour cette route. Utilisez /admin-password pour le Responsable.' });
    }
    if (String(pin).length !== 4 || isNaN(pin)) {
      return res.status(400).json({ message: 'Le code PIN doit contenir exactement 4 chiffres.' });
    }

    const user = await User.findOne({
      siteId: siteId.trim().toLowerCase(),
      email:  email.trim().toLowerCase(),
      role,
      active: true,
    });

    if (!user) {
      return res.status(401).json({ message: 'Email ou rôle incorrect.' });
    }
    if (!user.pin) {
      return res.status(401).json({ message: 'Aucun code PIN défini. Contactez votre responsable.' });
    }

    const isMatch = await user.comparePin(String(pin));
    if (!isMatch) {
      return res.status(401).json({ message: 'Code PIN incorrect.' });
    }

    user.lastLogin = Date.now();
    await user.save();

    await Log.add(user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Connexion Technicien : ${user.fullName}`,
    });

    const token = signToken(user._id);
    res.json({ message: 'Connexion réussie.', token, user: user.toSafeObject() });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/auth/change-password
//  Changer le mot de passe Responsable
// ────────────────────────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (req.user.role !== 'Responsable') {
      return res.status(403).json({ message: 'Seul le Responsable peut changer son mot de passe.' });
    }
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Ancien et nouveau mot de passe requis.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
    if (oldPassword === newPassword) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit être différent de l\'actuel.' });
    }

    const responsable = await User.findById(req.user._id);
    const isMatch     = await responsable.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    }

    responsable.password = newPassword;
    await responsable.save();

    await Log.add(responsable.siteId, {
      tag: 'SYS', type: 'ok',
      msg: 'Mot de passe Responsable modifié.',
    });

    res.json({ message: 'Mot de passe mis à jour avec succès.' });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  GET /api/users/profiles
//  Liste des profils pour l'écran de sélection (public)
// ────────────────────────────────────────────────────────────
exports.getProfiles = async (req, res, next) => {
  try {
    const siteId = req.query.siteId || req.headers['x-site-id'];
    if (!siteId) return res.status(400).json({ message: 'siteId requis.' });

    const site  = await Site.findOne({ siteId: siteId.toLowerCase() });
    const users = await User.find({ siteId: siteId.toLowerCase(), active: true })
      .select('fullName email role lastLogin')
      .sort({ role: 1 });

    const profiles = users.map(u => ({
      id:       u._id,
      username: u.fullName,
      fullName: u.fullName,
      email:    u.email,
      role:     u.role,
      lastSeen: u.lastLogin
        ? new Date(u.lastLogin).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : 'Jamais',
    }));

    res.json({ users: profiles, site: site?.siteName ?? siteId });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/auth/seed-site
//  Cree un site + responsable dans MongoDB depuis le seed mobile
//  Route publique — appelee une seule fois avant livraison
// ────────────────────────────────────────────────────────────
exports.seedSite = async (req, res, next) => {
  try {
    const {
      siteId, siteName,
      loraFrequency, loraSf, loraBw, loraCr,
      aesEnabled, responsable,
    } = req.body;

    if (!siteId || !siteName || !responsable?.email || !responsable?.password) {
      return res.status(400).json({
        message: 'siteId, siteName, responsable.email et responsable.password requis.'
      });
    }
    if (responsable.password.length < 6) {
      return res.status(400).json({ message: 'Mot de passe minimum 6 caracteres.' });
    }

    // Site deja existant → retourner les IDs + JWT valide
    const existingSite = await Site.findOne({ siteId: siteId.trim().toLowerCase() });
    if (existingSite) {
      const existingResp = await User.findOne({
        siteId: siteId.trim().toLowerCase(),
        role:   'Responsable',
        active: true,
      });
      if (existingResp) {
        const token = signToken(existingResp._id);
        return res.json({
          message:       'Site deja existant',
          siteServerId:  String(existingSite._id),
          responsableId: String(existingResp._id),
          token,
          alreadyExists: true,
        });
      }
    }

    // Creer le site
    const site = await Site.create({
      siteId:        siteId.trim().toLowerCase(),
      siteName:      siteName.trim(),
      loraFrequency: loraFrequency ?? '868 MHz',
      loraSf:        loraSf        ?? 'SF10',
      loraBw:        loraBw        ?? '125 kHz',
      loraCr:        loraCr        ?? '4/5',
      aesEnabled:    aesEnabled    ?? true,
    });

    // Creer le responsable avec mot de passe temporaire
    const resp = await User.create({
      siteId:   siteId.trim().toLowerCase(),
      fullName: responsable.fullName ?? 'Responsable',
      email:    responsable.email.trim().toLowerCase(),
      role:     'Responsable',
      password: responsable.password,
    });

    // Generer un vrai JWT valide immediatement
    const token = signToken(resp._id);

    await Log.add(siteId.trim().toLowerCase(), {
      tag: 'SYS', type: 'ok',
      msg: `Site initialise : ${siteName}. Responsable : ${responsable.email}.`,
    });

    console.log(`[seedSite] Site cree dans MongoDB : ${siteName} (${siteId})`);

    res.status(201).json({
      message:       'Site et responsable crees avec succes',
      siteServerId:  String(site._id),
      responsableId: String(resp._id),
      token,
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Ce site ou cet email existe deja.' });
    }
    next(err);
  }
};