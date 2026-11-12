const SYSTEM_PROMPT = `أنت المساعد البيئي الذكي الرسمي لحملة بيئتنا لوحتنا في جامعة إربد الأهلية بالأردن.

مهمتك مساعدة الطلبة والزوار في فهم أهداف الحملة، وتعزيز السلوك البيئي الإيجابي، وتقديم معلومات ونصائح عملية حول النظافة والاستدامة وإعادة التدوير والتطوع البيئي.

تحدث باللغة العربية بأسلوب ودود وبسيط، وافهم اللهجة الأردنية جيدًا.

اجعل إجاباتك مختصرة ومفيدة، واستخدم الرموز التعبيرية باعتدال.

إذا سألك المستخدم عن طريقة الإبلاغ، وجّهه إلى نموذج الإبلاغ الموجود في الموقع.

لا تخترع معلومات رسمية عن الجامعة أو الحملة، ولا تدّعِ أن هناك مبادرات أو فعاليات أو مواعيد غير موثقة.

إذا كان السؤال بعيدًا عن البيئة أو الحملة، وضّح بلطف أنك المساعد البيئي المتخصص في هذه المواضيع.`;

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'الطريقة غير مسموحة، يرجى استخدام POST.' })
    };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'بيانات غير صالحة.' })
      };
    }

    const { messages } = body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'حقل الرسائل مطلوب.' })
      };
    }

    const rawApiKey = (
      process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GROQ_API_KEY ||
      ''
    ).trim();

    if (!rawApiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'لم يتم العثور على مفتاح AI_API_KEY في إعدادات Netlify. يرجى إضافته من Site configuration > Environment variables.'
        })
      };
    }

    let endpoint = process.env.OPENAI_BASE_URL;
    let model = process.env.AI_MODEL;

    if (rawApiKey.startsWith('gsk_')) {
      if (!endpoint) endpoint = 'https://api.groq.com/openai/v1/chat/completions';
      if (!model) model = 'openai/gpt-oss-120b';
    } else {
      if (!endpoint) endpoint = 'https://api.openai.com/v1/chat/completions';
      if (!model) model = 'gpt-4o-mini';
    }

    const sanitizedMessages = messages
      .filter(m => m && typeof m === 'object' && m.content)
      .slice(-15)
      .map(m => ({
        role: String(m.role || 'user').toLowerCase(),
        content: String(m.content).slice(0, 1500)
      }));

    const payload = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...sanitizedMessages
      ],
      max_tokens: 800,
      temperature: 0.7
    };

    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${rawApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      console.error('AI API Error:', data);
      return {
        statusCode: aiResponse.status,
        headers,
        body: JSON.stringify({
          error: data?.error?.message || 'عذرًا، حدث خطأ أثناء الاتصال بمزود الذكاء الاصطناعي.'
        })
      };
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || 'عذرًا، لم أتمكن من الحصول على إجابة.';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'حدث خطأ في معالجة المحادثة على Netlify.'
      })
    };
  }
}
