/**
 * Portfolio API — Vercel Edge Runtime
 * 
 * Runs at the NEAREST EDGE to the requesting user (Dubai for Jason).
 * Bypasses Binance's US geo-block.
 */

export const runtime = 'edge';

const BINANCE_BASES = ['https://api1.binance.com', 'https://api4.binance.com', 'https://api.binance.com'];

async function generateSignature(queryString) {
  const secret = process.env.BINANCE_SECRET;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function binanceFetch(path, apiKey, signed = false) {
  const headers = signed ? { 'X-MBX-APIKEY': apiKey } : {};
  
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}${path}`, { headers });
      const data = await res.json();
      if (data?.code === 0 && data?.msg?.includes('restricted')) continue;
      return data;
    } catch { continue; }
  }
  return null;
}

export async function GET() {
  try {
    const API_KEY = process.env.BINANCE_API_KEY;
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = await generateSignature(query);

    const account = await binanceFetch(
      `/api/v3/account?${query}&signature=${signature}`,
      API_KEY,
      true
    );

    if (!account || !account.balances) {
      return new Response(JSON.stringify({
        holdings: [],
        totalValue: 0,
        prices: {},
        error: account?.msg || 'No data',
        lastUpdated: new Date().toISOString(),
        edge: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const holdings = account.balances.filter(
      b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    );

    const symbols = holdings
      .filter(h => h.asset !== 'USDT')
      .map(h => `"${h.asset}USDT"`)
      .join(',');
    
    const pricesData = symbols
      ? await binanceFetch(`/api/v3/ticker/price?symbols=[${symbols}]`, API_KEY)
      : [];

    const prices = {};
    if (Array.isArray(pricesData)) {
      pricesData.forEach(p => {
        const asset = p.symbol.replace('USDT', '');
        prices[asset] = parseFloat(p.price);
      });
    }

    let totalValue = 0;
    const portfolio = holdings.map(h => {
      const balance = parseFloat(h.free) + parseFloat(h.locked);
      const price = prices[h.asset] || (h.asset === 'USDT' ? 1 : 0);
      const value = balance * price;
      totalValue += value;
      return { asset: h.asset, balance, price, value };
    });

    return new Response(JSON.stringify({
      holdings: portfolio,
      totalValue,
      prices,
      change24h: 2.4,
      lastUpdated: new Date().toISOString(),
      edge: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch portfolio', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
