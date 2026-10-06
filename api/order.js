// api/order.js — 결제 전에 서버가 주문(금액·상품)을 먼저 확정해서 저장
import crypto from 'crypto';
import { getUser, setJSON, PLANS } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'SESSION_EXPIRED' });

    const { plan } = req.body || {};
    const p = PLANS[plan];
    if (!p) return res.status(400).json({ error: '잘못된 이용권입니다' });

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
