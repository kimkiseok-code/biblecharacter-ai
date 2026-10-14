// api/admin-payments.js — (관리자 전용) 최근 결제 목록 + 각 결제의 사용 횟수
import { getUser, isAdmin, redis, redisPipeline, getJSON, getFreeToday, FREE_DAILY_CAP, getSub, PLANS, kstDayKey } from './_lib.js';

// Upstash HGETALL 결과 [필드, 값, 필드, 값…] → { 필드: 숫자 }
function toObj(flat) {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) o[flat[i]] = Number(flat[i + 1]) || 0;
  else if (flat && typeof flat === 'object') for (const k in flat) o[k] = Number(flat[k]) || 0;
  return o;
}

// 출처별 통계: 최근 30일(하루 단위) + 전체 누적
async function loadStats() {
  const days = [];
  for (let i = 0; i < 30; i++) days.push(kstDayKey(Date.now() - i * 86400000));
  const rows = await redisPipeline([...days.map(d => ['HGETALL', `stats:${d}`]), ['HGETALL', 'stats:all']]);
  return { days: days.map((d, i) => ({ day: d, data: toObj(rows[i]) })), all: toObj(rows[days.length]) };
}

export default async function handler(req, res) {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'SESSION_EXPIRED' });
    if (!isAdmin(user.email)) return res.status(403).json({ error: '관리자만 볼 수 있습니다' });

    const ids = (await redis('LRANGE', 'payments:all', '0', '99')) || [];
    const list = [];
    for (const orderId of ids) {
      const o = await getJSON(`order:${orderId}`);
      if (!o) continue;
      const used = parseInt((await redis('GET', `usage:paid:${o.email}:${orderId}`)) || '0', 10);
      const plan = await getJSON(`plan:${o.email}`);
      list.push({
        orderId,
        email: o.email,
        plan: o.plan,
        amount: o.amount,
        status: o.status,          // paid | cancelled
        paidAt: o.paidAt || null,
        cancelledAt: o.cancelledAt || null,
        cancelReason: o.cancelReason || '',
        kind: o.kind || 'one-time',
        used,
        active: !!(plan && plan.orderId === orderId && plan.expiresAt > Date.now()),
        expiresAt: plan && plan.orderId === orderId ? plan.expiresAt : null,
      });
    }
    // 정기구독자 목록
    const subEmails = (await redis('SMEMBERS', 'subs:index')) || [];
    const subs = [];
    for (const email of subEmails) {
      const s = await getSub(email);
      if (!s) continue;
      subs.push({
        email, plan: s.plan, amount: PLANS[s.plan].amount, status: s.status,
        cardName: s.cardName, last4: s.last4, startedAt: s.startedAt, periodEnd: s.periodEnd,
        renewCount: s.renewCount, failCount: s.failCount || 0, lastError: s.lastError || '',
      });
    }
    subs.sort((a, b) => a.periodEnd - b.periodEnd);
    const lastRun = await getJSON('cron:lastRun');

    let stats = null;
    try { stats = await loadStats(); } catch (e) { console.error('stats error:', e); }

    res.status(200).json({ payments: list, subs, lastRun, freeToday: await getFreeToday(), freeCap: FREE_DAILY_CAP, stats });
  } catch (e) {
    console.error('admin-payments error:', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}
