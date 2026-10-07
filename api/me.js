// api/me.js — 내 이용권과 남은 횟수 조회
import { getUser, getQuota, getUsed, getTotalUsed, clientIp, getSub, PLANS } from './_lib.js';

export default async function handler(req, res) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const user = getUser(req);
    if (authHeader && !user) {
      return res.status(401).json({ error: '로그인이 만료되었습니다', code: 'SESSION_EXPIRED' });
    }
    const quota = await getQuota({ email: user && user.email, ip: clientIp(req) });
    const used = await getUsed(quota);
    let sub = null;
    if (user) {
      const s = await getSub(user.email);
      if (s && s.status !== 'ended') {
        sub = {
          plan: s.plan, status: s.status, amount: PLANS[s.plan].amount,
          cardName: s.cardName, last4: s.last4, periodEnd: s.periodEnd,
          failCount: s.failCount || 0,
        };
      }
    }
    res.status(200).json({
      tier: quota.tier,           // guest | free | basic | premium | admin
      used,
      limit: quota.limit,         // null = 제한 없음 (관리자)
      period: quota.period || null, // 'day' = 하루 기준 (프리미엄)
      totalUsed: await getTotalUsed(quota), // 프리미엄: 이용권 전체 사용 횟수
      totalLimit: quota.totalLimit ?? null, // 프리미엄: 200
      expiresAt: quota.expiresAt || null,
      sub,                        // 정기구독 정보 (없으면 null)
    });
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}
