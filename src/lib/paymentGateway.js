// Simulated payment gateway. It is intentionally NOT a real integration: no
// external service, credentials or third-party SDK. It models the behaviours a
// resilient integration must handle (P004) — success, unavailability, timeout
// — and is idempotent on the client-supplied key so a retried request never
// charges twice. The real implementation and the test fakes share this
// interface, so the billing rules are exercised the same way.

import { createHash } from 'node:crypto';

export class GatewayUnavailableError extends Error {
  constructor(msg = 'Serviço de pagamento indisponível.') {
    super(msg);
    this.name = 'GatewayUnavailableError';
    this.retryable = true;
  }
}

export class GatewayTimeoutError extends Error {
  constructor(msg = 'Tempo excedido ao contatar o pagamento.') {
    super(msg);
    this.name = 'GatewayTimeoutError';
    this.retryable = true;
  }
}

// Default gateway used in production/dev: deterministic success, idempotent by
// key. A leak of this map would reveal nothing sensitive; it only dedups keys
// within a process run (our DB is the durable idempotency guard).
export function createDeterministicGateway() {
  const seen = new Map();
  return {
    async charge({ idempotencyKey, amountCents }) {
      if (!idempotencyKey) throw new Error('idempotencyKey obrigatório.');
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error('amountCents inválido.');
      }
      if (seen.has(idempotencyKey)) {
        return { ref: seen.get(idempotencyKey), deduped: true };
      }
      const ref = 'pay_' + createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16);
      seen.set(idempotencyKey, ref);
      return { ref, deduped: false };
    },
  };
}
