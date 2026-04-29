const User = require('../models/User');
const Log  = require('../models/Log');

// ────────────────────────────────────────────────────────────
//  GET /api/users
//  Liste tous les utilisateurs du site (Responsable only)
// ────────────────────────────────────────────────────────────
exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find({ siteId: req.user.siteId })
      .select('-password -pin')
      .sort({ role: 1, fullName: 1 });

    res.json({ users: users.map(u => u.toSafeObject()) });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  POST /api/users/new
//  Créer un Technicien (Responsable only)
// ────────────────────────────────────────────────────────────
exports.createUser = async (req, res, next) => {
  try {
    const { fullName, email, role, pin, permissions } = req.body;

    // Validations
    if (!fullName?.trim()) {
      return res.status(400).json({ message: 'Le nom complet est requis.' });
    }
    if (!email?.trim() || !email.includes('@')) {
      return res.status(400).json({ message: 'Email invalide.' });
    }
    if (role !== 'Technicien') {
      return res.status(400).json({ message: 'Seul le rôle Technicien peut être créé ici.' });
    }
    if (!pin || String(pin).length !== 4 || isNaN(pin)) {
      return res.status(400).json({ message: 'Code PIN à 4 chiffres requis.' });
    }

    const user = await User.create({
      siteId:      req.user.siteId,
      fullName:    fullName.trim(),
      email:       email.trim().toLowerCase(),
      role:        'Technicien',
      pin:         String(pin),
      permissions: permissions ?? {
        canManageNodes:    false,
        canConfigureNodes: false,
        canLaunchOTA:      true,
        canViewLogs:       true,
        canScanNetwork:    false,
      },
    });

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Nouveau Technicien créé : ${user.fullName} (${user.email})`,
    });

    res.status(201).json({ message: 'Utilisateur créé.', user: user.toSafeObject() });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/users/:id
//  Modifier un utilisateur (Responsable only)
// ────────────────────────────────────────────────────────────
exports.updateUser = async (req, res, next) => {
  try {
    const { fullName, email, pin, permissions } = req.body;

    const user = await User.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    // On ne peut pas modifier le Responsable via cette route
    if (user.role === 'Responsable') {
      return res.status(403).json({ message: 'Le compte Responsable ne peut pas être modifié ici.' });
    }

    if (fullName?.trim()) user.fullName = fullName.trim();
    if (email?.trim() && email.includes('@')) user.email = email.trim().toLowerCase();
    if (pin && String(pin).length === 4 && !isNaN(pin)) user.pin = String(pin);
    if (permissions) user.permissions = { ...user.permissions.toObject(), ...permissions };

    await user.save();

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Profil modifié : ${user.fullName}`,
    });

    res.json({ message: 'Profil mis à jour.', user: user.toSafeObject() });
  } catch (err) { next(err); }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/users/:id
//  Supprimer un utilisateur (Responsable only)
// ────────────────────────────────────────────────────────────
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, siteId: req.user.siteId });
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

    if (user.role === 'Responsable') {
      return res.status(403).json({ message: 'Le compte Responsable ne peut pas être supprimé.' });
    }

    await user.deleteOne();

    await Log.add(req.user.siteId, {
      tag: 'SYS', type: 'ok',
      msg: `Compte supprimé : ${user.fullName}`,
    });

    res.json({ message: 'Utilisateur supprimé.' });
  } catch (err) { next(err); }
};
