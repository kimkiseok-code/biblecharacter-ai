// api/me.js — 내 이용권과 남은 횟수 조회
import { getUser, getQuota, getUsed, clientIp } from './_lib.js';

export default async function handler(req, res) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const user = getUser(req);
    if (authHeader && !user) {
      return res.status(401).json({ error: '로그인이 만료되었습니다', code: 'SESSION_EXPIRED' });
    }
    const quota = await getQuota({ email: user && user.email, ip: clientIp(req) });
    const used = await getUsed(quota);
    res.status(200).json({
      tier: quota.tier,           // guest | free | basic | premium | admin
      used,
      limit: quota.limit,         // null = 무제한
      expiresAt: quota.expiresAt || null,
    });
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}
