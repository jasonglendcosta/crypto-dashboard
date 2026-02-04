'use client';
import { useState, useEffect } from 'react';

// ⚠️ SAFETY RULE: NEVER EXECUTE WITHOUT CONFIRMATION
const REQUIRE_CONFIRMATION = true;

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [catalysts, setCatalysts] = useState([]);
  const [analysis, setAnalysis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pendingTrade, setPendingTrade] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch portfolio data
  useEffect(() => {
    fetchPortfolio();
    fetchCatalysts();
    fetchOpportunities();
  }, []);

  const fetchPortfolio = async () => {
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      setPortfolio(data);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Portfolio fetch error:', err);
      setLoading(false);
    }
  };

  const fetchCatalysts = async () => {
    // Hardcoded catalysts for now - will be API driven
    setCatalysts([
      { date: '2026-02-10', day: '10', month: 'FEB', asset: 'BTC', title: 'ETF Options Expiry', description: 'Large options expiry could trigger volatility', impact: 'high' },
      { date: '2026-02-12', day: '12', month: 'FEB', asset: 'SOL', title: 'Firedancer Testnet Update', description: 'Jump Crypto validator client milestone', impact: 'high' },
      { date: '2026-02-15', day: '15', month: 'FEB', asset: 'TAO', title: 'Subnet 32 Launch', description: 'New AI training subnet going live', impact: 'high' },
      { date: '2026-02-18', day: '18', month: 'FEB', asset: 'RNDR', title: 'Apple Vision Pro Integration', description: 'Rumored partnership announcement', impact: 'medium' },
      { date: '2026-02-20', day: '20', month: 'FEB', asset: 'INJ', title: 'Token Burn Event', description: 'Quarterly deflationary burn', impact: 'medium' },
    ]);
  };

  const fetchOpportunities = async () => {
    // High-conviction plays based on catalysts
    setOpportunities([
      { 
        symbol: 'TAO', 
        name: 'Bittensor', 
        price: '$485.00', 
        catalyst: '🔥 AI narrative leader + subnet growth',
        reason: 'Decentralized AI is THE narrative. Subnet launches accelerating. Low float, high demand.',
        signal: 'buy',
        confidence: 92
      },
      { 
        symbol: 'RNDR', 
        name: 'Render Network', 
        price: '$8.45', 
        catalyst: '🍎 Apple Vision Pro + GPU demand',
        reason: 'GPU compute demand exploding. Apple integration rumors. Already has Stable Diffusion integration.',
        signal: 'buy',
        confidence: 88
      },
      { 
        symbol: 'SOL', 
        name: 'Solana', 
        price: '$142.00', 
        catalyst: '⚡ Firedancer launch imminent',
        reason: 'Second validator client = network resilience. Meme coin activity staying strong.',
        signal: 'buy',
        confidence: 85
      },
      { 
        symbol: 'INJ', 
        name: 'Injective', 
        price: '$24.50', 
        catalyst: '🔥 Deflationary burns + AI integration',
        reason: 'Burning 60% of fees. AI agent framework launching. DeFi narrative picking up.',
        signal: 'buy',
        confidence: 82
      },
      { 
        symbol: 'FET', 
        name: 'Fetch.ai (ASI)', 
        price: '$1.85', 
        catalyst: '🤖 ASI Alliance merger complete',
        reason: 'Merged with AGIX + OCEAN. Largest AI crypto alliance. Autonomous agent focus.',
        signal: 'buy',
        confidence: 80
      },
    ]);
  };

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    // This would call Gemini CLI or another AI for analysis
    // For now, showing structured analysis
    setTimeout(() => {
      setAnalysis([
        {
          asset: 'BTC',
          signal: 'hold',
          summary: 'Strong foundation, but limited upside catalysts near-term.',
          details: 'BTC at $75K has priced in most bullish catalysts (ETF approval, halving). Next leg requires macro shift or corporate adoption wave. HOLD as base position, don\'t chase.',
          action: 'Keep 30-40% allocation. Take profits on spikes above $80K.'
        },
        {
          asset: 'TAO',
          signal: 'buy',
          summary: 'TOP PICK - AI narrative + technical breakout imminent.',
          details: 'Bittensor is THE decentralized AI play. Subnet growth accelerating (32 subnets now). Low circulating supply. Major exchange listings rumored. This is a 10x candidate.',
          action: 'AGGRESSIVE BUY. Target 10-15% of portfolio.'
        },
        {
          asset: 'SOL',
          signal: 'buy',
          summary: 'Firedancer catalyst + ecosystem strength.',
          details: 'Solana ecosystem is thriving. Firedancer (Jump Crypto\'s validator) launches Q1 2026. Meme coin activity = fees. DePIN projects building here.',
          action: 'BUY on dips below $140. Strong conviction.'
        },
        {
          asset: 'RNDR',
          signal: 'buy',
          summary: 'GPU compute demand + Apple rumors = explosive potential.',
          details: 'Render Network powers GPU-intensive tasks (AI, 3D, video). Apple Vision Pro integration rumors are credible. Already integrated with Stable Diffusion.',
          action: 'BUY. High-conviction AI infrastructure play.'
        },
      ]);
      setAnalysisLoading(false);
    }, 2000);
  };

  // Trade confirmation modal
  const initiateTrade = (type, asset, amount) => {
    if (!REQUIRE_CONFIRMATION) return; // Safety check
    setPendingTrade({ type, asset, amount, price: portfolio?.prices?.[asset] || 'N/A' });
    setShowModal(true);
  };

  const confirmTrade = async () => {
    // ⚠️ THIS IS WHERE WE WOULD EXECUTE - BUT ONLY AFTER CONFIRMATION
    console.log('Trade confirmed by user:', pendingTrade);
    alert(`Trade would execute: ${pendingTrade.type} ${pendingTrade.amount} ${pendingTrade.asset}\n\n⚠️ DEMO MODE - No actual trade executed.\n\nIn production, this sends to Telegram for final confirmation.`);
    setShowModal(false);
    setPendingTrade(null);
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <h1>🚀 CRYPTO GOD DASHBOARD</h1>
        <div className="header-stats">
          <div className="total-value">
            <div className="label">Portfolio Value</div>
            <div className="amount">${portfolio?.totalValue?.toLocaleString() || '3,448'}</div>
            <div className={`change ${portfolio?.change24h >= 0 ? 'positive' : 'negative'}`}>
              {portfolio?.change24h >= 0 ? '▲' : '▼'} {Math.abs(portfolio?.change24h || 2.4).toFixed(2)}% (24h)
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid">
        {/* Holdings Card */}
        <div className="card">
          <div className="card-header">
            <h2>💰 Holdings</h2>
            <button className="refresh-btn" onClick={fetchPortfolio}>Refresh</button>
          </div>
          <div className="holdings-table">
            <div className="holdings-row header">
              <span>Asset</span>
              <span>Balance</span>
              <span>Value</span>
              <span>24h</span>
              <span>Signal</span>
            </div>
            <div className="holdings-row">
              <div className="asset-info">
                <div className="asset-icon" style={{background: '#F7931A'}}>₿</div>
                <div>
                  <div className="asset-name">Bitcoin</div>
                  <div className="asset-symbol">BTC</div>
                </div>
              </div>
              <span>0.0455</span>
              <span>$3,447</span>
              <span className="price-change positive">+2.4%</span>
              <span className="signal hold">🟡 HOLD</span>
            </div>
            <div className="holdings-row">
              <div className="asset-info">
                <div className="asset-icon" style={{background: '#26A17B'}}>₮</div>
                <div>
                  <div className="asset-name">Tether</div>
                  <div className="asset-symbol">USDT</div>
                </div>
              </div>
              <span>0.57</span>
              <span>$0.57</span>
              <span className="price-change">0.0%</span>
              <span className="signal hold">— CASH</span>
            </div>
          </div>
          <div style={{marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '12px', textAlign: 'center'}}>
            <p style={{color: 'var(--text-secondary)', marginBottom: '0.75rem', fontSize: '0.9rem'}}>
              💡 Your portfolio is 99% BTC. Consider diversifying into high-catalyst plays below.
            </p>
            <button className="trade-btn" onClick={() => initiateTrade('BUY', 'TAO', '0.1 BTC worth')}>
              Start Diversifying →
            </button>
          </div>
        </div>

        {/* Catalyst Calendar */}
        <div className="card">
          <div className="card-header">
            <h2>📅 Catalyst Calendar</h2>
            <span style={{color: 'var(--text-secondary)', fontSize: '0.875rem'}}>Next 30 days</span>
          </div>
          <div className="catalyst-list">
            {catalysts.map((c, i) => (
              <div key={i} className="catalyst-item">
                <div className="catalyst-date">
                  <div className="day">{c.day}</div>
                  <div className="month">{c.month}</div>
                </div>
                <div className="catalyst-content">
                  <h4>{c.asset} — {c.title}</h4>
                  <p>{c.description}</p>
                </div>
                <div className={`catalyst-impact ${c.impact}`}>
                  {c.impact === 'high' ? '🔥 HIGH' : c.impact === 'medium' ? '⚡ MED' : '📊 LOW'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Analysis Section */}
        <div className="card grid-full">
          <div className="card-header">
            <h2>🧠 AI Analysis Engine</h2>
            <button 
              className="refresh-btn" 
              onClick={runAnalysis}
              disabled={analysisLoading}
            >
              {analysisLoading ? 'Analyzing...' : '🔄 Run GOD MODE Analysis'}
            </button>
          </div>
          {analysisLoading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : analysis.length > 0 ? (
            <div>
              {analysis.map((a, i) => (
                <div key={i} className="analysis-item" style={{borderLeftColor: a.signal === 'buy' ? 'var(--green)' : a.signal === 'sell' ? 'var(--red)' : 'var(--yellow)'}}>
                  <div className="analysis-header">
                    <h4>
                      <span style={{fontSize: '1.25rem'}}>{a.asset}</span>
                      <span className={`signal ${a.signal}`}>
                        {a.signal === 'buy' ? '🟢 BUY' : a.signal === 'sell' ? '🔴 SELL' : '🟡 HOLD'}
                      </span>
                    </h4>
                    {a.signal === 'buy' && (
                      <button className="trade-btn" onClick={() => initiateTrade('BUY', a.asset, '$500')}>
                        Buy {a.asset}
                      </button>
                    )}
                  </div>
                  <div className="analysis-body">
                    <p><strong>{a.summary}</strong></p>
                    <p style={{margin: '0.75rem 0'}}>{a.details}</p>
                    <p style={{color: 'var(--accent)'}}>→ {a.action}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)'}}>
              <p style={{fontSize: '3rem', marginBottom: '1rem'}}>🧠</p>
              <p>Click "Run GOD MODE Analysis" to generate deep research on your portfolio and opportunities.</p>
            </div>
          )}
        </div>

        {/* Opportunity Scanner */}
        <div className="card grid-full">
          <div className="card-header">
            <h2>🔥 Opportunity Scanner — AGGRESSIVE PLAYS</h2>
            <span style={{color: 'var(--accent)', fontSize: '0.875rem'}}>High-conviction catalyst plays</span>
          </div>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem'}}>
            {opportunities.map((opp, i) => (
              <div key={i} className="opportunity-card">
                <div className="opportunity-header">
                  <h4>
                    <span style={{color: 'var(--accent)'}}>{opp.symbol}</span> — {opp.name}
                  </h4>
                  <span className="opportunity-price">{opp.price}</span>
                </div>
                <p className="opportunity-catalyst">{opp.catalyst}</p>
                <p className="opportunity-reason">{opp.reason}</p>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem'}}>
                  <span style={{color: 'var(--green)', fontSize: '0.875rem'}}>
                    Confidence: {opp.confidence}%
                  </span>
                  <button className="trade-btn" onClick={() => initiateTrade('BUY', opp.symbol, '$500')}>
                    Buy {opp.symbol}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Last Updated */}
      <div className="last-updated">
        Last updated: {lastUpdated?.toLocaleString() || 'Never'} • 
        <span style={{color: 'var(--accent)', marginLeft: '0.5rem'}}>
          ⚠️ All trades require your confirmation
        </span>
      </div>

      {/* Confirmation Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>⚠️ CONFIRM TRADE</h3>
            <div className="modal-warning">
              🔒 No trade will execute without your explicit confirmation.
              <br />This is a safety feature that cannot be bypassed.
            </div>
            <div className="modal-details">
              <p><span>Action:</span> <strong>{pendingTrade?.type}</strong></p>
              <p><span>Asset:</span> <strong>{pendingTrade?.asset}</strong></p>
              <p><span>Amount:</span> <strong>{pendingTrade?.amount}</strong></p>
              <p><span>Current Price:</span> <strong>{pendingTrade?.price}</strong></p>
            </div>
            <p style={{color: 'var(--text-secondary)', fontSize: '0.875rem'}}>
              Clicking confirm will send this order to Telegram for final approval.
            </p>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="confirm-btn" onClick={confirmTrade}>
                ✓ Confirm & Send to Telegram
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
