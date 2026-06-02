// api/payment-confirm.js — 토스페이먼츠 결제 승인
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentKey, orderId, amount } = req.body;

  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({ error: '필수 파라미터 누락' });
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  const encoded = Buffer.from(secretKey + ':').toString('base64');

  try {
    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: data.message || '결제 승인 실패' });
    }

    // 결제 성공 — 플랜 정보 반환
    const plan = amount === 2900 ? 'basic' : 'premium';
    const month = new Date().getFullYear() + '_' + (new Date().getMonth() + 1);

    res.status(200).json({
      success: true,
      plan,
      month,
      orderId: data.orderId,
      amount: data.totalAmount,
    });

  } catch (err) {
    console.error('Payment confirm error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
}
