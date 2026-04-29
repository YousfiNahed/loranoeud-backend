/**
 * services/nodePusher.js
 *
 * Ce fichier tourne côté BACKEND (Node.js).
 * Il envoie la configuration d'un nœud directement à la carte ESP32
 * via HTTP, sur le réseau local (LAN).
 *
 * LOGIQUE :
 *   - Le téléphone envoie la config au backend (PUT /api/nodes/:id)
 *   - Le backend sauvegarde en base
 *   - Le backend appelle cette fonction pour envoyer la config à la carte
 *   - La carte reçoit, sauvegarde en NVS, et redémarre
 *
 * Si la carte n'a pas d'IP (détectée uniquement via BLE, pas encore
 * connectée au WiFi) → configPending = true en base.
 * La config sera envoyée automatiquement quand la carte appellera
 * POST /api/nodes/announce après son premier démarrage WiFi.
 */

const NODE_API_TOKEN  = process.env.NODE_API_TOKEN  || 'loranet2025';
const PUSH_TIMEOUT_MS = parseInt(process.env.NODE_PUSH_TIMEOUT_MS || '5000', 10);

// ─────────────────────────────────────────────────────────────
// Construit le JSON dans le format attendu par le firmware
// (fonction appliquerConfigJson dans firmware_esp32_v3.2.ino)
// ─────────────────────────────────────────────────────────────
function buildPayload(node) {
  const payload = {
    mode:      node.mode,
    baudRate:  String(node.baudRate  ?? '9600'),
    parity:    node.parity   ?? 'None',
    modbusId:  String(node.modbusId ?? '1'),
    timeout:   String(node.timeout  ?? '5000'),
    retries:   node.retries !== false,
    aes:       node.aes !== false,
    lowPower:  node.lowPower === true,
    frequency: node.frequency ?? '868 MHz',
    sf:        node.sf        ?? 'SF9',
    bw:        node.bw        ?? '125 kHz',
    cr:        node.cr        ?? '4/5',
    txPower:   String(node.txPower ?? '17'),
  };

  // Champs Master uniquement
  if (node.mode === 'Master') {
    payload.output = node.output ?? 'Modbus RTU';
    if (payload.output === 'Wi-Fi') {
      payload.wifiSsid = node.wifiSsid ?? '';
      payload.wifiPass = node.wifiPass ?? '';
    }
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────
// Pousse la config vers la carte ESP32 par HTTP
// node : document Mongoose complet
// Retourne { success: bool, message: string }
// ─────────────────────────────────────────────────────────────
async function pushConfigToNode(node) {
  const ip = (node.nodeId || '').trim();

  // Pas d'IP connue → carte pas encore sur le WiFi
  if (!ip) {
    node.configPending = true;
    node.configError   = 'IP inconnue — en attente de connexion WiFi';
    await node.save();
    return {
      success: false,
      pending: true,
      message: 'Carte sans IP pour l\'instant. Config envoyée dès sa connexion WiFi.',
    };
  }

  const url     = `http://${ip}/config`;
  const payload = buildPayload(node);

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth':       NODE_API_TOKEN,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    let body = null;
    try { body = await res.json(); } catch (_) {}

    if (res.ok && body?.ok !== false) {
      // Succès : mettre à jour la BDD
      node.configPending   = false;
      node.configError     = null;
      node.configAppliedAt = new Date();
      await node.save();

      return {
        success:  true,
        pending:  false,
        message:  body?.msg ?? 'Config envoyée. La carte redémarre.',
        response: body,
      };
    }

    // La carte a répondu mais avec une erreur (401, 400...)
    const errMsg = body?.msg ?? `Erreur HTTP ${res.status}`;
    node.configPending = true;
    node.configError   = errMsg;
    await node.save();
    return { success: false, pending: true, message: errMsg };

  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError'
      ? `Carte injoignable (timeout ${PUSH_TIMEOUT_MS}ms) — IP : ${ip}`
      : `Erreur réseau : ${err.message}`;

    node.configPending = true;
    node.configError   = reason;
    await node.save();
    return { success: false, pending: true, message: reason };
  }
}

// ─────────────────────────────────────────────────────────────
// Appelé depuis announceNode quand une carte se reconnecte
// au WiFi : si elle avait une config en attente, on la pousse.
// ─────────────────────────────────────────────────────────────
async function retryPendingConfig(node) {
  if (!node.configPending) return null;
  console.log(`[nodePusher] Config en attente pour ${node.name} → push maintenant`);
  return pushConfigToNode(node);
}

module.exports = { pushConfigToNode, retryPendingConfig };