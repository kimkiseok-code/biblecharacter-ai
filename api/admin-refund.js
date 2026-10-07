// api/admin-refund.js — (관리자 전용) 환불: 나이스페이 결제 취소 + 이용권 회수
// body: { orderId, reason, revokeOnly }
//   revokeOnly=true → 나이스페이 관리자 화면에서 이미 취소한 경우, 이용권만 회수
import { getUser, isAdmin, redis, getJSON, setJSON, getSub, saveSub, nicepay, newOrderId } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'SESSION_EXPIRED' });
    if (!isAdmin(user.email)) return res.status(403).json({ error: '관리자만 사용할 수 있습니다' });

    const { orderId, reason, revokeOnly, action, email: subEmail } = req.body || {};

    // 구독만 즉시 종료 (환불 없음, 이미 결제한 기간은 그대로 이용)
    if (action === 'endSub') {
      const s = await getSub(subEmail);
      if (!s || s.status === 'ended') return res.status(404).json({ error: '진행 중인 구독이 없습니다' });
      await endSubscription(subEmail, s, 'admin');
      return res.status(200).json({ ok: true });
    }

    const order = await getJSON(`order:${orderId}`);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
    if (order.status === 'cancelled') return res.status(409).json({ error: '이미 환불 처리된 주문입니다' });
    if (order.status !== 'paid' || !order.tid) return res.status(400).json({ error: '결제 완료된 주문이 아닙니다' });

    const why = String(reason || '고객 요청에 의한 환불').slice(0, 40);

    // 1. 나이스페이 결제 취소 (전액)
    if (!revokeOnly) {
      const basicToken = Buffer.from(`${process.env.NICEPAY_CLIENT_KEY}:${process.env.NICEPAY_SECRET_KEY}`).toString('base64');
      const r = await fetch(`https://api.nicepay.co.kr/v1/payments/${encodeURIComponent(order.tid)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicToken}` },
        body: JSON.stringify({ reason: why, orderId }),
      });
      const data = await r.json();
      if (data.resultCode !== '0000') {
        return res.status(502).json({
          error: `나이스페이 취소 실패: ${data.resultMsg || '알 수 없는 오류'} (${data.resultCode || r.status})`,
          hint: '나이스페이 관리자 화면에서 이미 취소했다면 "이용권만 회수"를 사용하세요',
        });
      }
    }

    // 2. 이용권 회수 (이 주문으로 받은 이용권일 때만)
    const plan = await getJSON(`plan:${order.email}`);
    let revoked = false;
    if (plan && plan.orderId === orderId) {
      await redis('DEL', `plan:${order.email}`);
      revoked = true;
    }

    // 3. 주문에 환불 기록
    await setJSON(`order:${orderId}`, {
      ...order,
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelReason: why,
      cancelledVia: revokeOnly ? 'manual' : 'nicepay-api',
    });

    // 4. 구독 결제를 환불하면 구독도 종료 (다음 달 자동 결제 중단)
    let subEnded = false;
    if (String(order.kind || '').startsWith('sub')) {
      const s = await getSub(order.email);
      if (s && s.status !== 'ended') { await endSubscription(order.email, s, 'refund'); subEnded = true; }
    }

    res.status(200).json({ ok: true, revoked, subEnded, cancelledAtNicepay: !revokeOnly });
  } catch (e) {
    console.error('admin-refund error:', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
}

async function endSubscription(email, s, reason) {
  try { await nicepay(`/v1/subscribe/${encodeURIComponent(s.bid)}/expire`, { orderId: newOrderId('BCAX') }); } catch (e) {}
  await saveSub(email, { ...s, status: 'ended', endedAt: Date.now(), endReason: reason });
}
