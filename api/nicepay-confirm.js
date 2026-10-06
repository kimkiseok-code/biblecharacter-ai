// api/nicepay-confirm.js — 나이스페이 결제 승인 + 이용권 부여
import { redis, getJSON, setJSON, addOneMonth } from './_lib.js';

function fail(res, msg) {
  return res.redirect(303, `/payment-fail.html?msg=${encodeURIComponent(msg || '결제에 실패했습니다')}`);
}

export default async function handler(req, res) {
  const params = req.method === 'POST' ? (req.body || {}) : req.query;
  const { authResultCode, authResultMsg, tid, orderId, amount } = params;

  // 1. 인증 단계에서 실패/취소
  if (authResultCode !== '0000') return fail(res, authResultMsg);

  try {
    // 2. 서버에 저장해 둔 주문과 대조 (금액 위변조 방지)
    const order = await getJSON(`order:${orderId}`);
    if (!order) return fail(res, '주문 정보를 찾을 수 없습니다');
    if (order.status === 'paid') return res.redirect(303, `/payment-success.html?plan=${order.plan}`);
    if (Number(amount) !== order.amount) return fail(res, '결제 금액이 주문 금액과 다릅니다');

    // 3. 같은 주문이 동시에 두 번 처리되지 않도록 잠금
    const locked = await redis('SET', `lock:order:${orderId}`, '1', 'NX', 'EX', '120');
    if (!locked) return fail(res, '이미 처리 중인 결제입니다. 잠시 후 확인해 주세요');

    // 4. 나이스페이 최종 승인 (금액은 서버에 저장된 값 사용)
    const basicToken = Buffer.from(`${process.env.NICEPAY_CLIENT_KEY}:${process.env.NICEPAY_SECRET_KEY}`).toString('base64');
    const confirmRes = await fetch(`https://api.nicepay.co.kr/v1/payments/${encodeURIComponent(tid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicToken}` },
      body: JSON.stringify({ amount: order.amount }),
    });
    const data = await confirmRes.json();

    if (data.resultCode !== '0000') {
      await redis('DEL', `lock:order:${orderId}`);
      return fail(res, data.resultMsg);
    }

    // 5. 이용권 부여 (구매 시점부터 1개월)
    const now = Date.now();
    await setJSON(`plan:${order.email}`, {
      plan: order.plan,
      orderId,
      tid,
      amount: order.amount,
      paidAt: now,
      expiresAt: addOneMonth(now),
    });
    await setJSON(`order:${orderId}`, { ...order, status: 'paid', tid, paidAt: now });
    // 결제 목록 (관리자 페이지·환불용). 주문 상세는 order:{orderId}에 있음
    await redis('LPUSH', 'payments:all', orderId);
    await redis('LPUSH', `payments:${order.email}`, orderId);

    return res.redirect(303, `/payment-success.html?plan=${order.plan}`);
  } catch (err) {
    console.error('nicepay-confirm error:', err);
    return fail(res, '서버 오류가 발생했습니다. 결제가 되었다면 고객센터로 문의해 주세요');
  }
}
