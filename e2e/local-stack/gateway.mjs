// Local Supabase-compatible gateway for end-to-end tests (NOT part of the product).
// /auth/v1 -> GoTrue, /rest/v1 -> PostgREST, /storage/v1 -> minimal emulation that authorises
// through the real storage.objects RLS policies, /functions/v1/process-outbox -> real processor.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { processOutbox } from '../../supabase/functions/_shared/processor.ts';
import { adaptersFromEnv } from '../../supabase/functions/_shared/providers.ts';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const keys = JSON.parse(fs.readFileSync(new URL('./keys.json', import.meta.url)));
const FILES = path.join(path.dirname(new URL(import.meta.url).pathname), 'files');
fs.mkdirSync(FILES, { recursive: true });
const pool = new pg.Pool({ connectionString: 'postgresql://postgres@127.0.0.1:54329/flowmont_e2e' });

function verify(token) {
  const [h, b, s] = (token ?? '').split('.');
  if (!s) return null;
  const expected = createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (expected !== s) return null;
  return JSON.parse(Buffer.from(b, 'base64url').toString());
}

async function asUser(claims, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${claims.role === 'service_role' ? 'service_role' : 'authenticated'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

function forward(req, res, port, stripPrefix) {
  const target = req.url.slice(stripPrefix.length) || '/';
  const p = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' });
    r.pipe(res);
  });
  p.on('error', (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(p);
}

function body(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}

const db = createClient('http://127.0.0.1:54321', keys.service, { auth: { persistSession: false } });

async function storage(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace('/storage/v1', '');
  if (req.method === 'GET' && p.startsWith('/object/sign/')) {
    const name = decodeURIComponent(p.slice('/object/sign/job-files/'.length));
    const tok = verify(url.searchParams.get('token'));
    if (!tok || tok.name !== name || tok.exp < Date.now() / 1000) return json(res, 400, { error: 'InvalidSignature' });
    const file = path.join(FILES, encodeURIComponent(name));
    if (!fs.existsSync(file)) return json(res, 404, { error: 'not_found' });
    const meta = JSON.parse(fs.readFileSync(`${file}.json`));
    res.writeHead(200, { 'content-type': meta.type, 'access-control-allow-origin': '*' });
    return fs.createReadStream(file).pipe(res);
  }
  const claims = verify((req.headers.authorization ?? '').replace('Bearer ', ''));
  if (!claims) return json(res, 401, { message: 'Unauthorized' });
  if (req.method === 'POST' && p.startsWith('/object/sign/')) {
    const name = decodeURIComponent(p.slice('/object/sign/job-files/'.length));
    const { expiresIn } = JSON.parse((await body(req)).toString() || '{}');
    const rows = await asUser(claims, `select name from storage.objects where bucket_id = 'job-files' and name = $1`, [name]);
    if (!rows.length) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const h = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const b = Buffer.from(JSON.stringify({ name, exp: Math.floor(Date.now() / 1000) + (expiresIn ?? 60) })).toString('base64url');
    const token = `${h}.${b}.${createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
    return json(res, 200, { signedURL: `/object/sign/job-files/${name}?token=${token}` });
  }
  if (req.method === 'POST' && p.startsWith('/object/job-files/')) {
    const name = decodeURIComponent(p.slice('/object/job-files/'.length));
    let data = await body(req);
    let type = req.headers['content-type'] ?? 'application/octet-stream';
    if (type.startsWith('multipart/form-data')) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': type }, body: data }).formData();
      const file = [...form.values()].find((v) => typeof v === 'object');
      type = file.type || 'application/octet-stream';
      data = Buffer.from(await file.arrayBuffer());
    }
    if (data.length > 20 * 1024 * 1024) return json(res, 413, { message: 'Payload too large' });
    try {
      await asUser(claims, `insert into storage.objects (bucket_id, name, owner_id) values ('job-files', $1, $2)`, [name, claims.sub]);
    } catch (e) {
      return json(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    }
    const file = path.join(FILES, encodeURIComponent(name));
    fs.writeFileSync(file, data);
    fs.writeFileSync(`${file}.json`, JSON.stringify({ type }));
    return json(res, 200, { Key: `job-files/${name}`, Id: name });
  }
  if (req.method === 'DELETE' && p === '/object/job-files') {
    const { prefixes } = JSON.parse((await body(req)).toString());
    const rows = await asUser(claims, `delete from storage.objects where bucket_id = 'job-files' and name = any($1) returning name`, [prefixes]);
    return json(res, 200, rows);
  }
  json(res, 404, { message: 'not emulated' });
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      });
      return res.end();
    }
    try {
      if (req.url.startsWith('/auth/v1')) return forward(req, res, 9999, '/auth/v1');
      if (req.url.startsWith('/rest/v1')) return forward(req, res, 3000, '/rest/v1');
      if (req.url.startsWith('/storage/v1')) return await storage(req, res);
      if (req.url.startsWith('/functions/v1/process-outbox')) {
        await body(req);
        const store = {
          claim: async (limit) => {
            const { data, error } = await db.rpc('claim_outbox', { p_limit: limit });
            if (error) throw new Error(error.message);
            return data;
          },
          finish: async (id, r) => {
            const { error } = await db.rpc('finish_outbox', {
              p_id: id,
              p_result: r.kind,
              p_provider: r.provider,
              p_provider_message_id: r.kind === 'sent' ? r.providerMessageId : null,
              p_error: r.kind === 'failed' ? r.error : null,
            });
            if (error) throw new Error(error.message);
          },
        };
        return json(res, 200, await processOutbox(store, adaptersFromEnv({}), 25));
      }
      if (req.url.startsWith('/functions/v1/billing')) {
        await body(req);
        return json(res, 503, { configured: false, error: 'Płatności online nie są jeszcze skonfigurowane.' });
      }
      json(res, 404, { message: 'not found' });
    } catch (e) {
      json(res, 500, { message: String(e) });
    }
  })
  .listen(54321, '127.0.0.1', () => console.log('gateway on 54321'));
