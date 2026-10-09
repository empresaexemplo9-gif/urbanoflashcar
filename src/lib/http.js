// A tiny dependency-free HTTP router built on node:http. It supports path
// parameters (":id"), JSON body parsing with a size limit, static file serving
// and centralised error handling. This is the only module that touches raw
// req/res, so route handlers stay pure and testable.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { AppError } from './errors.js';

const MAX_BODY_BYTES = 1024 * 256; // 256 KB is plenty for this API.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export class Router {
  constructor() {
    this.routes = [];
    this.staticDir = null;
  }

  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:[^/]+/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  serveStatic(dir) { this.staticDir = dir; return this; }

  handler() {
    return async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        for (const route of this.routes) {
          if (route.method !== req.method) continue;
          const match = route.regex.exec(path);
          if (!match) continue;

          const params = {};
          route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));
          const body = await readBody(req);
          const ctx = { req, res, params, query: url.searchParams, body };
          const result = await route.handler(ctx);
          if (!res.writableEnded) {
            const r = normalizeResult(result);
            sendJson(res, r.status, r.body);
          }
          return;
        }

        if (req.method === 'GET' && this.staticDir) {
          const served = await tryServeStatic(this.staticDir, path, res);
          if (served) return;
        }

        sendJson(res, 404, { error: { code: 'not_found', message: 'Rota não encontrada.' } });
      } catch (err) {
        handleError(res, err);
      }
    };
  }
}

// Explicit response descriptor so a body that happens to contain a "status"
// field is never mistaken for an HTTP status code.
export function json(status, body) {
  return { __response: true, status, body };
}

function normalizeResult(result) {
  if (result && result.__response === true) {
    return { status: result.status ?? 200, body: result.body ?? {} };
  }
  return { status: 200, body: result ?? {} };
}

export function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function handleError(res, err) {
  if (res.writableEnded) return;
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    return;
  }
  // Unexpected: log server-side, never leak internals to the client.
  console.error('[unhandled]', err);
  sendJson(res, 500, { error: { code: 'internal_error', message: 'Erro interno.' } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError(413, 'payload_too_large', 'Corpo da requisição muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AppError(400, 'invalid_json', 'JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

async function tryServeStatic(dir, path, res) {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(dir, rel);
  if (!file.startsWith(normalize(dir))) return false; // path traversal guard
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}
