export default async function handler(req, res) {
  const { authResultCode, authResultMsg, tid, orderId, amount } = req.method === 'POST' ? req.body : req.query;

  // 결제 실패
  if(authResultCode !== '0000') {
    return res.redirect(`/payment-fail.html?msg=${encodeURIComponent(authResultMsg)}`);
  }

  // 나이스페이 최종 승인 요청 (실결제)
  const clientKey = process.env.NICEPAY_CLIENT_KEY;
  const secretKey = process.env.NICEPAY_SECRET_KEY;
  const basicToken = Buffer.from(`${clientKey}:${secretKey}`).toString('base64');

  try {
    const confirmRes = await fetch(`https://api.nicepay.co.kr/v1/payments/${tid}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicToken}`
      },
      body: JSON.stringify({ amount: Number(amount) })
    });

    const data = await confirmRes.json();

    if(data.resultCode === '0000') {
      return res.redirect('/payment-success.html');
    } else {
      return res.redirect(`/payment-fail.html?msg=${encodeURIComponent(data.resultMsg)}`);
    }
  } catch(err) {
    return res.redirect('/payment-fail.html?msg=서버오류');
  }
}
