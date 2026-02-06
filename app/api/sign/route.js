/**
 * Signing API — returns HMAC signature for Binance requests
 * 
 * The actual Binance API calls happen from the CLIENT (Jason's browser in Dubai)
 * because Binance blocks all cloud/datacenter IPs.
 * 
 * This endpoint only provides: API key + signature for a given query string.
 * The secret never leaves the server.
 */

import { createHmac } from 'crypto';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { queryString } = await request.json();
    
    if (!queryString || typeof queryString !== 'string') {
      return Response.json({ error: 'Missing queryString' }, { status: 400 });
    }

    const secret = (process.env.BINANCE_SECRET || '').trim();
    const apiKey = (process.env.BINANCE_API_KEY || '').trim();
    
    if (!secret || !apiKey) {
      return Response.json({ error: 'Server not configured' }, { status: 500 });
    }

    const signature = createHmac('sha256', secret)
      .update(queryString)
      .digest('hex');

    return Response.json({ signature, apiKey });
  } catch (error) {
    return Response.json({ error: 'Signing failed', details: error.message }, { status: 500 });
  }
}
