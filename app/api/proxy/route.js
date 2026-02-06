/**
 * Binance Proxy API — runs on Vercel Node.js (sin1 region)
 * 
 * Solves: Browser CORS blocks X-MBX-APIKEY on Binance preflight.
 * Solution: Browser → our proxy → Binance (server-to-server, no CORS issue)
 * 
 * Also signs requests so API secret never touches the browser.
 */

import { createHmac } from 'crypto';

export const runtime = 'nodejs';
export const preferredRegion = ['sin1', 'hnd1', 'bom1', 'syd1']; // Singapore, Tokyo, Mumbai, Sydney (non-US)

export async function POST(request) {
  try {
    const { path, params = {} } = await request.json();
    
    if (!path) {
      return Response.json({ error: 'Missing path' }, { status: 400 });
    }

    const apiKey = (process.env.BINANCE_API_KEY || '').trim();
    const secret = (process.env.BINANCE_SECRET || '').trim();
    const signed = !!params._signed;
    delete params._signed;

    // Add timestamp for signed requests
    if (signed) {
      params.timestamp = String(Date.now());
    }

    const qs = new URLSearchParams(params).toString();
    
    let url = `https://api.binance.com${path}`;
    if (signed) {
      const signature = createHmac('sha256', secret).update(qs).digest('hex');
      url += `?${qs}&signature=${signature}`;
    } else if (qs) {
      url += `?${qs}`;
    }

    const headers = signed ? { 'X-MBX-APIKEY': apiKey } : {};
    
    const binanceRes = await fetch(url, { headers });
    const data = await binanceRes.json();

    // Log errors for debugging
    if (data?.code !== undefined && data?.msg) {
      console.error(`[PROXY ${path}]`, data.code, data.msg);
    }

    return Response.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'X-Proxy-Region': process.env.VERCEL_REGION || 'unknown',
      },
    });
  } catch (error) {
    return Response.json(
      { error: 'Proxy failed', details: error.message },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
