// api/_lib.js — 서버 공통 모듈 (파일명이 _ 로 시작해서 외부 주소로 노출되지 않음)
// 1) 위조 불가능한 로그인 세션 토큰  2) Redis 저장소  3) 이용권/사용량 계산
import crypto from 'crypto';

// ───────── 설정값 ─────────
export const PLANS = {
  basic:   { amount: 2900, limit: 50,   name: 'BibleCharacter.AI 베이직 1개월 이용권' },
  premium: { amount: 4900, limit: null, name: 'BibleCharacter.AI 프리미엄 1개월 이용권' }, // null = 무제한
};
export const FREE_MONTHLY_LIMIT = 3;   // 로그인 무료 회원: 매달 3회
export const GUEST_MONTHLY_LIMIT = 3;  // 비로그인: IP당 매달 3회
const SESSION_DAYS = 30;               // 로그인 유지 기간

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'onsign@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function isAdmin(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

// ───────── 세션 토큰 (HMAC 서명) ─────────
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET 환경변수가 없거나 너무 짧습니다 (32자 이상)');
  return s;
}

export function signSession(user) {
  const payload = {
    email: String(user.email).toLowerCase(),
    name: user.name || '',
    picture: user.picture || '',
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// 서명이 맞고 만료되지 않았으면 사용자 정보, 아니면 null
export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!payload.email || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 요청 헤더 "Authorization: Bearer <세션>" 에서 사용자 꺼내기
export function getUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return verifySession(token);
}

// ───────── Redis (Upstash REST API, 별도 패키지 불필요) ─────────
function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis 환경변수(KV_REST_API_URL / KV_REST_API_TOKEN)가 없습니다');
  return { url: url.replace(/\/$/, ''), token };
}

export async function redis(...command) {
  const { url, token } = redisConfig();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (data.error) throw new Error('Redis 오류: ' + data.error);
  return data.result;
}

export async function getJSON(key) {
  const v = await redis('GET', key);
  return v ? JSON.parse(v) : null;
}

export async function setJSON(key, value, ttlSeconds) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttlSeconds) args.push('EX', String(ttlSeconds));
  return redis(...args);
}

// ───────── 날짜 (한국시간 기준) ─────────
export function kstMonthKey(ts = Date.now()) {
  const d = new Date(ts + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

// 구매 시점부터 1개월 뒤 (예: 10월 7일 → 11월 7일, 1월 31일 → 2월 말일)
export function addOneMonth(ts) {
  const d = new Date(ts);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

// ───────── 이용권 / 사용량 ─────────
// 지금 이 사람에게 적용되는 한도와 사용량 카운터 키를 돌려줌
export async function getQuota({ email, ip }) {
  if (email && isAdmin(email)) {
    return { tier: 'admin', limit: null, key: null };
  }
  if (email) {
    const ent = await getJSON(`plan:${email}`);
    if (ent && ent.expiresAt > Date.now() && PLANS[ent.plan]) {
      return {
        tier: ent.plan,
        limit: PLANS[ent.plan].limit,
        key: `usage:paid:${email}:${ent.orderId}`,
        expiresAt: ent.expiresAt,
        ttl: Math.ceil((ent.expiresAt - Date.now()) / 1000) + 86400,
      };
    }
    return {
      tier: 'free',
      limit: FREE_MONTHLY_LIMIT,
      key: `usage:free:${email}:${kstMonthKey()}`,
      ttl: 40 * 86400,
    };
  }
  return {
    tier: 'guest',
    limit: GUEST_MONTHLY_LIMIT,
    key: `usage:guest:${ip || 'unknown'}:${kstMonthKey()}`,
    ttl: 40 * 86400,
  };
}

export async function getUsed(quota) {
  if (!quota.key) return 0;
  return parseInt((await redis('GET', quota.key)) || '0', 10);
}

// 1회 차감 시도. 한도 초과면 false (차감 안 됨)
export async function tryConsume(quota) {
  if (!quota.key) return { ok: true, used: 0 };
  const used = await redis('INCR', quota.key);
  if (used === 1 && quota.ttl) await redis('EXPIRE', quota.key, String(quota.ttl));
  if (quota.limit !== null && used > quota.limit) {
    await redis('DECR', quota.key);
    return { ok: false, used: used - 1 };
  }
  return { ok: true, used };
}

// API 오류 등으로 대화가 실패하면 차감한 1회를 되돌림
export async function refund(quota) {
  if (quota.key) await redis('DECR', quota.key);
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'] || '';
  return (xf.split(',')[0] || req.headers['x-real-ip'] || '').trim();
}
