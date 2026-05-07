// ── Gestionnaire d'erreurs global ────────────────────────────
//
// FIX : Quand MongoDB retourne une erreur 11000 (duplicate key)
// sur l'index { siteId, macAddress }, le handler original renvoyait :
//   HTTP 409 { message: "macAddress déjà utilisé." }
//
// Le client (nodeRepo.js) attendait un 409 avec { node: { _id } }
// pour récupérer le server_id du doublon et mettre à jour SQLite.
// Sans ce _id, le client ne pouvait pas résoudre le doublon :
//   - sync_pending restait à 1 sans server_id
//   - la boucle de retry repassait en POST → nouveau 409 → boucle infinie
//   - après MAX_ATTEMPTS, le nœud n'était jamais synchronisé
//
// SOLUTION : sur une erreur 11000 portant sur macAddress,
// on recherche le nœud existant dans MongoDB et on le retourne
// dans la réponse 409, exactement comme le fait createNode()
// pour sa propre vérification de doublon.

const Node = require('../models/Node');

const errorHandler = async (err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Erreur de validation Mongoose
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: messages.join('. ') });
  }

  // ✅ FIX — Duplicate key (index unique MongoDB)
  // Cas principal : doublon sur { siteId + macAddress }
  // On retourne le nœud existant avec son _id pour que le client
  // puisse résoudre le doublon et mettre à jour son server_id.
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? '';

    // Doublon sur macAddress → chercher le nœud existant et le retourner
    if (field === 'macAddress' || (err.keyValue?.siteId && err.keyValue?.macAddress)) {
      try {
        const mac      = err.keyValue.macAddress;
        const siteId   = err.keyValue.siteId ?? req.user?.siteId;
        const existing = siteId && mac
          ? await Node.findOne({ siteId, macAddress: mac })
          : null;

        return res.status(409).json({
          message: `Cette carte existe déjà${existing ? ` sous le nom "${existing.name}"` : ''} (MAC : ${mac ?? '?'}).`,
          node: existing ? { _id: existing._id, id: existing._id } : undefined,
        });
      } catch (lookupErr) {
        console.error('[errorHandler] Lookup doublon MAC échoué:', lookupErr.message);
        // Continuer vers la réponse générique 409
      }
    }

    // Doublon sur un autre champ (email, etc.)
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