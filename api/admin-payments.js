// api/admin-payments.js — (관리자 전용) 최근 결제 목록 + 각 결제의 사용 횟수
import { getUser, isAdmin, redis, getJSON } from './_lib.js';

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
        used,
        active: !!(plan && plan.orderId === orderId && plan.expiresAt > Date.now()),
        expiresAt: plan && plan.orderId === orderId ? plan.expiresAt : null,
      });
    }
    res.status(200).json({ payments: list });
  } catch (e) {
    console.error('admin-payments error:', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}
