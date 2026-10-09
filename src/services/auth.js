// Authentication business rules: registration, login, logout and resolving a
// session token to the current user. Enforces validation and uniqueness, and
// issues opaque random tokens stored only as hashes.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { publicUser } from './serialize.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['rider', 'driver']);

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthService({ users, sessions, config, now = () => new Date() }) {
  function register({ email, name, password, role }) {
    email = String(email ?? '').trim().toLowerCase();
    name = String(name ?? '').trim();
    role = String(role ?? 'rider').trim();

    if (!EMAIL_RE.test(email)) throw badRequest('E-mail inválido.', 'invalid_email');
    if (name.length < 2) throw badRequest('Nome muito curto.', 'invalid_name');
    if (typeof password !== 'string' || password.length < 8) {
      throw badRequest('A senha deve ter ao menos 8 caracteres.', 'weak_password');
    }
    if (!ROLES.has(role)) throw badRequest('Perfil inválido (use rider ou driver).', 'invalid_role');

    if (users.findByEmail(email)) throw conflict('E-mail já cadastrado.', 'email_taken');

    const user = users.create({
      email,
      name,
      role,
      password: hashPassword(password),
      createdAt: now().toISOString(),
    });
    return publicUser(user);
  }

  function login({ email, password }) {
    email = String(email ?? '').trim().toLowerCase();
    const user = users.findByEmail(email);
    // Verify even when the user is missing to keep timing uniform.
    const ok = verifyPassword(String(password ?? ''), user?.password ?? 'scrypt$00$00');
    if (!user || !ok) throw unauthorized('E-mail ou senha incorretos.', 'invalid_credentials');

    const token = randomBytes(32).toString('base64url');
    const current = now();
    sessions.deleteExpired(current.toISOString());
    sessions.create({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(current.getTime() + config.sessionTtlMs).toISOString(),
      createdAt: current.toISOString(),
    });
    return { token, user: publicUser(user) };
  }

  function logout(token) {
    if (token) sessions.delete(hashToken(token));
  }

  // Returns the full user row (incl. role) for internal authorization checks.
  function authenticate(token) {
    if (!token) throw unauthorized();
    const session = sessions.findValid(hashToken(token), now().toISOString());
    if (!session) throw unauthorized('Sessão inválida ou expirada.', 'invalid_session');
    const user = users.findById(session.user_id);
    if (!user) throw unauthorized('Sessão inválida ou expirada.', 'invalid_session');
    return user;
  }

  return { register, login, logout, authenticate, _hashToken: hashToken, _timingSafeEqual: timingSafeEqual };
}
