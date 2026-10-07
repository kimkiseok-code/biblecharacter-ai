// api/order.js — 결제 전에 서버가 주문(금액·상품)을 먼저 확정해서 저장
import crypto from 'crypto';
import { getUser, setJSON, PLANS, getSub } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'SESSION_EXPIRED' });

    const { plan } = req.body || {};
    const p = PLANS[plan];
    if (!p) return res.status(400).json({ error: '잘못된 이용권입니다' });

    // 구독 중(해지 예약 포함, 기간 남음)에는 한 달 이용권 구매 막기 (이중 결제 방지)
    const sub = await getSub(user.email);
    if (sub && (sub.status === 'active' || sub.status === 'cancelled') && sub.periodEnd > Date.now()) {
      return res.status(409).json({ error: '정기구독 이용 중에는 한 달 이용권을 구매할 수 없어요. 구독 관리에서 확인해 주세요', code: 'ALREADY_SUBSCRIBED' });
    }

    const orderId = 'BCA_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex');
    await setJSON(`order:${orderId}`, {
      email: user.email,
      plan,
      amount: p.amount,
      status: 'pending',
      createdAt: Date.now(),
    }, 24 * 60 * 60); // 하루 안에 결제하지 않으면 자동 삭제

    res.status(200).json({
      orderId,
      amount: p.amount,
      goodsName: p.name,
      clientId: process.env.NICEPAY_CLIENT_KEY,
    });
  } catch (e) {
    console.error('order error:', e);
    res.status(500).json({ error: '주문 생성 중 오류가 발생했습니다' });
  }
}
