export async function handler() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      status: 'ok',
      name: 'المساعد البيئي 🌱',
      campaign: 'بيئتنا لوحتنا',
      university: 'جامعة إربد الأهلية',
      provider: 'Netlify Functions'
    })
  };
}
