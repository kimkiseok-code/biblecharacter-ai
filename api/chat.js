export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { system, messages } = req.body;
    
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API 키가 설정되지 않았습니다' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: system,
        messages: messages
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || '알 수 없는 오류',
        detail: data 
      });
    }
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}
