# LoraNœud — Backend API

## Structure

```
loraBackend/
├── src/
│   ├── config/
│   │   └── db.js                  ← Connexion MongoDB
│   ├── models/
│   │   ├── User.js                ← Responsable + Technicien
│   │   ├── Site.js                ← Sites industriels
│   │   ├── Node.js                ← Nœuds LoRa/Modbus
│   │   └── Log.js                 ← Journaux système
│   ├── middleware/
│   │   ├── auth.js                ← protect, responsableOnly, requirePermission
│   │   └── errorHandler.js        ← Gestionnaire d'erreurs global
│   ├── controllers/
│   │   ├── authController.js      ← Login, profils, changement MDP
│   │   ├── userController.js      ← CRUD utilisateurs
│   │   ├── nodeController.js      ← CRUD nœuds + live data
│   │   ├── logController.js       ← Journaux
│   │   ├── otaController.js       ← Mise à jour firmware
│   │   └── dashboardController.js ← Statistiques globales
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── node.routes.js
│   │   ├── log.routes.js
│   │   ├── ota.routes.js
│   │   └── dashboard.routes.js
│   ├── scripts/
│   │   └── seed.js                ← Données initiales
│   └── server.js                  ← Point d'entrée
├── .env.example
└── package.json
```

## Installation

```bash
npm install
cp .env.example .env
# Éditer .env avec vos valeurs
```

## Démarrage

```bash
# Développement (avec rechargement automatique)
npm run dev

# Production
npm start

# Initialiser la base de données (première fois)
npm run seed
```

## Endpoints API

### Auth (publiques)
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/sites/verify` | Vérifier l'existence d'un site |
| POST | `/api/auth/admin-password` | Connexion Responsable |
| POST | `/api/auth/pin-login` | Connexion Technicien |
| GET  | `/api/users/profiles?siteId=` | Liste des profils |

### Auth (protégées)
| Méthode | Route | Rôle requis |
|---|---|---|
| PUT | `/api/auth/change-password` | Responsable |

### Utilisateurs
| Méthode | Route | Rôle requis |
|---|---|---|
| GET    | `/api/users` | Responsable |
| POST   | `/api/users/new` | Responsable |
| PUT    | `/api/users/:id` | Responsable |
| DELETE | `/api/users/:id` | Responsable |

### Nœuds
| Méthode | Route | Permission requise |
|---|---|---|
| GET    | `/api/nodes` | Tous |
| GET    | `/api/nodes/:id` | Tous |
| GET    | `/api/nodes/:id/live` | Tous |
| POST   | `/api/nodes` | canManageNodes |
| PUT    | `/api/nodes/:id` | canManageNodes ou canConfigureNodes |
| DELETE | `/api/nodes/:id` | canManageNodes |
| PUT    | `/api/nodes/:id/mapping` | canConfigureNodes |

### Logs
| Méthode | Route | Permission |
|---|---|---|
| GET    | `/api/logs` | Tous |
| DELETE | `/api/logs` | Responsable |

### OTA
| Méthode | Route | Permission |
|---|---|---|
| GET  | `/api/ota/version` | Tous |
| POST | `/api/ota/launch` | canLaunchOTA |

### Dashboard
| Méthode | Route | Permission |
|---|---|---|
| GET | `/api/dashboard` | Tous |

## Rôles et permissions

### Responsable
- Accès total sans restriction
- Seul à pouvoir créer/modifier/supprimer des utilisateurs
- Seul à pouvoir changer son mot de passe

### Technicien (permissions configurables par le Responsable)
| Permission | Accès débloqué | Par défaut |
|---|---|---|
| `canManageNodes` | Ajouter/modifier/supprimer des nœuds | ❌ |
| `canConfigureNodes` | Configurer RS485/LoRa | ❌ |
| `canLaunchOTA` | Lancer une mise à jour firmware | ✅ |
| `canViewLogs` | Consulter les journaux | ✅ |
| `canScanNetwork` | Scanner le réseau | ❌ |
