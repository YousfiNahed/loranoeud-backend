// ── Gestionnaire d'erreurs global ────────────────────────────
const Node = require('../models/Node');

const errorHandler = async (err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Erreur de validation Mongoose
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: messages.join('. ') });
  }

  // Duplicate key MongoDB (index unique)
  // ✅ FIX : retourner le _id du nœud existant pour que le client
  // puisse résoudre le doublon et sauvegarder le server_id
  if (err.code === 11000) {
    const keyValue = err.keyValue ?? {};
    const field    = Object.keys(keyValue)[0] ?? '';

    // Doublon sur macAddress → chercher le nœud existant et retourner son _id
    if (field === 'macAddress' || (keyValue.siteId && keyValue.macAddress)) {
      try {
        const mac      = keyValue.macAddress;
        const siteId   = keyValue.siteId ?? req.user?.siteId;
        const existing = (siteId && mac)
          ? await Node.findOne({ siteId, macAddress: mac }).lean()
          : null;

        return res.status(409).json({
          message: existing
            ? `Cette carte existe déjà sous le nom "${existing.name}" (MAC : ${mac}).`
            : `Adresse MAC déjà utilisée (${mac}).`,
          node: existing ? { _id: existing._id, id: existing._id } : undefined,
        });
      } catch (lookupErr) {
        console.error('[errorHandler] lookup doublon MAC:', lookupErr.message);
      }
    }

    // Autre doublon (email, etc.)
    return res.status(409).json({ message: `${field} déjà utilisé.` });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Token invalide.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Session expirée. Veuillez vous reconnecter.' });
  }

  // Erreur générique
  res.status(err.statusCode || 500).json({
    message: err.message || 'Erreur interne du serveur.',
  });
};

module.exports = errorHandler;