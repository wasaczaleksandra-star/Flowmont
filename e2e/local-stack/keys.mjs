import { createHmac } from 'node:crypto';
const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const b = b64(p); return `${h}.${b}.${createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`; };
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
console.log(JSON.stringify({ anon: sign({ role: 'anon', iss: 'supabase', exp }), service: sign({ role: 'service_role', iss: 'supabase', exp }) }));
