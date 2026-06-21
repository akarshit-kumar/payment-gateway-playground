import React, { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';


// ==========================================
// INLINE SVGS FOR ICONS
// ==========================================
const CartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);

const IdempotencyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const LockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
  </svg>
);

const BankIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="22" height="18" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const WebhookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
  </svg>
);

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
);

function CheckoutForm({ amount, isSubmitting, setIsSubmitting, useIdempotency, customIdempotencyKey, generateNewKey, setTxResult, setCurrentTxId, setPipelineState, fetchState }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || isSubmitting) return;

    setIsSubmitting(true);
    setTxResult(null);

    // Initial visual setup for pipeline
    setPipelineState({
      connectorWidth: 0,
      nodes: {
        checkout: 'active',
        idempotency: 'idle',
        hold: 'idle',
        bank: 'idle',
        settlement: 'idle',
        webhook: 'idle'
      }
    });

    // 1. Checkout Phase
    await new Promise(r => setTimeout(r, 450));
    setPipelineState(prev => ({
      connectorWidth: 20,
      nodes: { ...prev.nodes, checkout: 'completed', idempotency: 'active' }
    }));

    // 2. Idempotency Key validation check
    await new Promise(r => setTimeout(r, 450));
    const ik = useIdempotency ? customIdempotencyKey : null;

    setPipelineState(prev => ({
      connectorWidth: 40,
      nodes: { ...prev.nodes, idempotency: ik ? 'completed' : 'warning', hold: 'active' }
    }));

    // 3. Create PaymentIntent on server
    await new Promise(r => setTimeout(r, 450));
    setPipelineState(prev => ({
      connectorWidth: 60,
      nodes: { ...prev.nodes, hold: 'completed', bank: 'active' }
    }));

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (ik) {
        headers['x-idempotency-key'] = ik;
      }

      const response = await fetch(`${API_URL}/api/gateway/create-payment-intent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ amount: parseFloat(amount) })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create PaymentIntent');
      }

      if (data.transactionId) {
        setCurrentTxId(data.transactionId);
      }

      // 4. Confirm Card Payment via Stripe SDK
      const cardElement = elements.getElement(CardElement);
      const confirmResult = await stripe.confirmCardPayment(data.clientSecret, {
        payment_method: {
          card: cardElement
        }
      });

      if (confirmResult.error) {
        // Payment failed or was declined by card brand/issuer
        setPipelineState(prev => ({
          connectorWidth: 60,
          nodes: { ...prev.nodes, bank: 'failed', settlement: 'warning' }
        }));
        setTxResult({
          success: false,
          error: true,
          message: confirmResult.error.message,
          code: confirmResult.error.code
        });
      } else {
        // Stripe successfully processed
        const paymentIntent = confirmResult.paymentIntent;
        if (paymentIntent.status === 'succeeded') {
          setPipelineState(prev => ({
            connectorWidth: 80,
            nodes: { ...prev.nodes, bank: 'completed', settlement: 'active' }
          }));
          
          await new Promise(r => setTimeout(r, 500));
          setPipelineState(prev => ({
            connectorWidth: 100,
            nodes: { ...prev.nodes, settlement: 'completed', webhook: 'active' }
          }));
          
          await new Promise(r => setTimeout(r, 500));
          setPipelineState(prev => ({
            ...prev,
            nodes: { ...prev.nodes, webhook: 'completed' }
          }));

          setTxResult({
            success: true,
            message: `Charged $${parseFloat(amount).toFixed(2)} successfully via Stripe! (ID: ${paymentIntent.id})`,
            data: paymentIntent
          });

          if (useIdempotency) generateNewKey();
        } else {
          setTxResult({
            success: false,
            message: `Payment status: ${paymentIntent.status}`,
            code: 'INCOMPLETE'
          });
        }
      }
    } catch (err) {
      setPipelineState(prev => ({
        connectorWidth: 60,
        nodes: { ...prev.nodes, bank: 'failed', settlement: 'warning' }
      }));
      setTxResult({
        success: false,
        error: true,
        message: err.message || 'Payment execution failed.',
        code: 'STRIPE_ERROR'
      });
    } finally {
      setIsSubmitting(false);
      fetchState(); // Immediately update account balances
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <label>Secure Card Payment (Stripe Elements)</label>
        <div className="stripe-card-element-wrapper">
          <CardElement options={{
            style: {
              base: {
                color: '#ffffff',
                fontFamily: '"Outfit", "Inter", sans-serif',
                fontSize: '15px',
                fontSmoothing: 'antialiased',
                '::placeholder': {
                  color: 'rgba(255, 255, 255, 0.4)'
                }
              },
              invalid: {
                color: '#ff3366',
                iconColor: '#ff3366'
              }
            }
          }} />
        </div>
      </div>
      
      <button type="submit" className="btn-primary" disabled={isSubmitting || !stripe}>
        {isSubmitting ? 'Confirming Payment...' : `Pay $${parseFloat(amount || 0).toFixed(2)}`}
      </button>
    </form>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [backendState, setBackendState] = useState({
    accounts: { customer: 1000, merchant: 0, gateway_fees: 0, bank_reserve: 1000000 },
    ledger: [],
    transactions: {},
    idempotencyStore: {},
    merchantWebhookSettings: { status: 'up', url: '' },
    webhookLogs: [],
    webhookQueue: [],
    bankSettings: { latency: 1000, errorMode: 'success' },
    bankRecords: [],
    logs: []
  });

  // Form inputs
  const [amount, setAmount] = useState('100.00');
  const [cardHolder, setCardHolder] = useState('Alex Merchant');
  const [cardNumber, setCardNumber] = useState('4111 1111 1111 1111');
  const [useIdempotency, setUseIdempotency] = useState(true);
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState('');
  
  // Stripe Integration States
  const [gatewayMode, setGatewayMode] = useState('simulated'); // 'simulated' or 'stripe'
  const [settings, setSettings] = useState({
    stripePublishableKey: '',
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    isStripeEnabled: false
  });
  
  const [publishableKeyInput, setPublishableKeyInput] = useState('');
  const [secretKeyInput, setSecretKeyInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  
  const [stripePromise, setStripePromise] = useState(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setPublishableKeyInput(data.stripePublishableKey || '');
      }
    } catch (err) {
      console.error('Failed to fetch Stripe settings:', err);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings.stripePublishableKey) {
      setStripePromise(loadStripe(settings.stripePublishableKey));
      setGatewayMode('stripe');
    } else {
      setStripePromise(null);
      setGatewayMode('simulated');
    }
  }, [settings.stripePublishableKey, settings.isStripeEnabled]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishableKey: publishableKeyInput,
          secretKey: secretKeyInput,
          webhookSecret: webhookSecretInput
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          stripePublishableKey: data.stripePublishableKey,
          stripeSecretKey: secretKeyInput ? 'sk_test_••••' : settings.stripeSecretKey,
          stripeWebhookSecret: webhookSecretInput ? 'whsec_••••' : settings.stripeWebhookSecret,
          isStripeEnabled: data.isStripeEnabled
        });
        alert('Stripe settings updated and initialized successfully!');
        setActiveTab('dashboard');
      } else {
        alert('Failed to update Stripe settings.');
      }
    } catch (err) {
      alert('Network error updating Stripe settings.');
    }
  };
  
  // Frontend Visual pipeline status
  const [pipelineState, setPipelineState] = useState({
    connectorWidth: 0,
    nodes: {
      checkout: 'idle',       // 'idle', 'active', 'completed', 'failed'
      idempotency: 'idle',
      hold: 'idle',
      bank: 'idle',
      settlement: 'idle',
      webhook: 'idle'
    }
  });

  const [txResult, setTxResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const terminalRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [currentTxId, setCurrentTxId] = useState(null);

  // Generate a new idempotency key
  const generateNewKey = () => {
    const key = `key-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    setCustomIdempotencyKey(key);
  };

  useEffect(() => {
    if (!customIdempotencyKey) {
      generateNewKey();
    }
  }, []);

  // Fetch current backend state
  const fetchState = async () => {
    try {
      const res = await fetch(`${API_URL}/api/state`);
      if (res.ok) {
        const data = await res.json();
        setBackendState(data);
      }
    } catch (err) {
      console.error('Failed to fetch state from Express server:', err);
    }
  };

  // Poll state every 500ms
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 500);
    return () => clearInterval(interval);
  }, []);

  // Scroll logs terminal to bottom when new logs arrive (only if autoScroll is enabled)
  useEffect(() => {
    if (terminalRef.current && autoScroll) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [backendState.logs, autoScroll]);

  // Synchronize visualizer nodes with actual transaction state in the backend database
  useEffect(() => {
    if (!currentTxId) return;
    
    const tx = backendState.transactions[currentTxId];
    if (!tx) return;
    
    if (tx.status === 'succeeded') {
      setPipelineState({
        connectorWidth: 100,
        nodes: {
          checkout: 'completed',
          idempotency: useIdempotency ? 'completed' : 'warning',
          hold: 'completed',
          bank: 'completed',
          settlement: 'completed',
          webhook: 'completed'
        }
      });
    } else if (tx.status === 'failed') {
      setPipelineState({
        connectorWidth: 80,
        nodes: {
          checkout: 'completed',
          idempotency: useIdempotency ? 'completed' : 'warning',
          hold: 'completed',
          bank: 'failed',
          settlement: 'completed',
          webhook: 'completed'
        }
      });
    } else if (tx.status === 'pending_reconciliation') {
      setPipelineState({
        connectorWidth: 60,
        nodes: {
          checkout: 'completed',
          idempotency: useIdempotency ? 'completed' : 'warning',
          hold: 'completed',
          bank: 'warning',
          settlement: 'warning',
          webhook: 'idle'
        }
      });
    }
  }, [backendState.transactions, currentTxId, useIdempotency]);

  // Track user scroll position in terminal
  const handleTerminalScroll = (e) => {
    const container = e.target;
    // Check if the user is scrolled near the bottom (within 20px)
    const isAtBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 20;
    setAutoScroll(isAtBottom);
  };

  // Handle transaction submit
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setAutoScroll(true);
    setIsSubmitting(true);
    setTxResult(null);

    // Initial state setup for pipeline
    setPipelineState({
      connectorWidth: 0,
      nodes: {
        checkout: 'active',
        idempotency: 'idle',
        hold: 'idle',
        bank: 'idle',
        settlement: 'idle',
        webhook: 'idle'
      }
    });

    // 1. Checkout Phase
    await new Promise(r => setTimeout(r, 400));
    setPipelineState(prev => ({
      connectorWidth: 20,
      nodes: { ...prev.nodes, checkout: 'completed', idempotency: 'active' }
    }));

    // 2. Idempotency Key validation check
    await new Promise(r => setTimeout(r, 400));
    const ik = useIdempotency ? customIdempotencyKey : null;

    setPipelineState(prev => ({
      connectorWidth: 40,
      nodes: { ...prev.nodes, idempotency: ik ? 'completed' : 'warning', hold: 'active' }
    }));

    // 3. Ledger Lock/Hold funds stage
    await new Promise(r => setTimeout(r, 400));
    setPipelineState(prev => ({
      connectorWidth: 60,
      nodes: { ...prev.nodes, hold: 'completed', bank: 'active' }
    }));

    // 4. Call Bank endpoint
    const startCallTime = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (ik) {
        headers['x-idempotency-key'] = ik;
      }

      const response = await fetch(`${API_URL}/api/gateway/charge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: parseFloat(amount),
          cardInfo: { cardNumber, cardHolder }
        })
      });

      const data = await response.json();
      const status = response.status;

      if (data.transactionId) {
        setCurrentTxId(data.transactionId);
      }

      // Make sure we keep the animation realistic by reflecting actual response timing
      const elapsedTime = Date.now() - startCallTime;
      const bankSettingsLatency = backendState.bankSettings.latency;
      if (elapsedTime < bankSettingsLatency) {
        await new Promise(r => setTimeout(r, bankSettingsLatency - elapsedTime));
      }

      // Check results
      if (status === 200) {
        // Successful payment
        setPipelineState(prev => ({
          connectorWidth: 80,
          nodes: { ...prev.nodes, bank: 'completed', settlement: 'active' }
        }));
        await new Promise(r => setTimeout(r, 500));
        setPipelineState(prev => ({
          connectorWidth: 100,
          nodes: { ...prev.nodes, settlement: 'completed', webhook: 'active' }
        }));
        await new Promise(r => setTimeout(r, 500));
        setPipelineState(prev => ({
          ...prev,
          nodes: { ...prev.nodes, webhook: 'completed' }
        }));
        setTxResult({ success: true, message: `Charged $${amount} successfully! Auth: ${data.authCode}`, data });
        
        // Generate new key for next time, unless they unchecked it
        if (useIdempotency) generateNewKey();
      } else if (status === 409) {
        // Idempotency Conflict (Duplicate request currently processing)
        setPipelineState(prev => ({
          connectorWidth: 30,
          nodes: {
            checkout: 'completed',
            idempotency: 'failed',
            hold: 'idle',
            bank: 'idle',
            settlement: 'idle',
            webhook: 'idle'
          }
        }));
        setTxResult({
          success: false,
          error: true,
          message: `Blocked duplicate concurrent request for key: ${ik}`,
          code: 'CONCURRENT_REQUEST'
        });
      } else if (status === 402 || (status === 400 && data.code === 'NSF')) {
        // Declined due to NSF (Insufficient funds)
        setPipelineState(prev => ({
          connectorWidth: 60,
          nodes: { ...prev.nodes, bank: 'failed', settlement: 'warning' } // Release Hold
        }));
        await new Promise(r => setTimeout(r, 600));
        setPipelineState(prev => ({
          connectorWidth: 80,
          nodes: { ...prev.nodes, settlement: 'completed', webhook: 'completed' } // Webhook notified of failed state
        }));
        setTxResult({ success: false, message: `Declined by issuer: Insufficient Funds.`, data });
      } else if (status === 504) {
        // Bank Timeout (Gateway Indeterminate Status)
        setPipelineState(prev => ({
          connectorWidth: 60,
          nodes: { ...prev.nodes, bank: 'warning', settlement: 'warning' }
        }));
        setTxResult({
          success: false,
          warning: true,
          message: 'Processor connection timed out! Funds remain held. A reconciliation job is required.',
          code: 'GATEWAY_TIMEOUT'
        });
      } else {
        // Generic Error
        setPipelineState(prev => ({
          connectorWidth: 60,
          nodes: { ...prev.nodes, bank: 'failed', settlement: 'warning' }
        }));
        setTxResult({
          success: false,
          error: true,
          message: data.error || 'Payment execution failed.',
          code: data.code
        });
      }
    } catch (err) {
      // Net failure
      setPipelineState(prev => ({
        connectorWidth: 60,
        nodes: { ...prev.nodes, bank: 'failed', settlement: 'warning' }
      }));
      setTxResult({
        success: false,
        error: true,
        message: 'Network connection failure between Client and Payment Gateway.',
        code: 'NETWORK_ERROR'
      });
    } finally {
      setIsSubmitting(false);
      fetchState(); // Immediately update account balances
    }
  };

  // Run manual reconciliation
  const runReconciliation = async () => {
    try {
      const res = await fetch(`${API_URL}/api/gateway/reconcile`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Reconciliation complete! Resolved ${data.reconciledCount} indeterminate transactions.`);
        fetchState();
      }
    } catch (err) {
      alert('Failed to connect to gateway reconciliation service.');
    }
  };

  // Reset simulator state
  const resetSimulator = async () => {
    if (window.confirm('Are you sure you want to clear all history, ledger journals, and reset accounts to $1,000.00?')) {
      try {
        const res = await fetch(`${API_URL}/api/state/reset`, {
          method: 'POST'
        });
        if (res.ok) {
          fetchState();
          generateNewKey();
          setTxResult(null);
          setCurrentTxId(null);
          setPipelineState({
            connectorWidth: 0,
            nodes: {
              checkout: 'idle',
              idempotency: 'idle',
              hold: 'idle',
              bank: 'idle',
              settlement: 'idle',
              webhook: 'idle'
            }
          });
        }
      } catch (err) {
        alert('Failed to reset backend state.');
      }
    }
  };

  // Update Bank settings on changes
  const updateBankSettings = async (mode, val) => {
    try {
      const body = {};
      if (mode === 'latency') body.latency = val;
      if (mode === 'errorMode') body.errorMode = val;

      await fetch(`${API_URL}/api/bank/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  // Update Merchant settings on changes
  const updateMerchantSettings = async (webhookStatus) => {
    try {
      await fetch(`${API_URL}/api/merchant/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: webhookStatus })
      });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      <header>
        <div className="title-area">
          <h1>Payment Gateway System Design Playground</h1>
          <p>Learn core architectural patterns: Idempotency, Double-entry Bookkeeping, Timeouts &amp; Webhook Retries</p>
        </div>
        <div className="nav-tabs">
          <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>Playground</button>
          <button className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>Ledger Journal</button>
          <button className={`tab-btn ${activeTab === 'webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('webhooks')}>Webhooks ({backendState.webhookLogs.length})</button>
          <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Stripe Settings</button>
          <button className={`tab-btn ${activeTab === 'learn' ? 'active' : ''}`} onClick={() => setActiveTab('learn')}>System Design Guide</button>
        </div>
        <button className="btn-reset" onClick={resetSimulator}>Reset State</button>
      </header>

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <div className="dashboard-grid">
          
          {/* LEFT COLUMN: Controls & Checkout */}
          <div className="left-col">
            {/* Checkout simulation */}
            <div className="glass-panel">
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Checkout Simulator</h3>
              <div className="form-group">
                <label>Amount (USD)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="form-input" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Gateway Provider</label>
                <select 
                  className="form-select" 
                  value={gatewayMode} 
                  onChange={(e) => {
                    if (e.target.value === 'stripe' && !settings.isStripeEnabled) {
                      alert('Stripe is not configured. Please enter API keys in the Stripe Settings tab.');
                      return;
                    }
                    setGatewayMode(e.target.value);
                  }}
                  disabled={isSubmitting}
                >
                  <option value="simulated">Simulated Sandbox (Offline)</option>
                  <option value="stripe">Stripe Integration (Real Test Mode)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                <label className="form-checkbox">
                  <input 
                    type="checkbox" 
                    checked={useIdempotency} 
                    onChange={(e) => setUseIdempotency(e.target.checked)}
                    disabled={isSubmitting}
                  />
                  Use Idempotency Key
                </label>
              </div>

              {useIdempotency && (
                <div className="form-group">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Idempotency Key
                    <button 
                      type="button" 
                      onClick={generateNewKey} 
                      style={{ background: 'none', border: 'none', color: 'hsl(var(--accent-cyan))', fontSize: '0.75rem', cursor: 'pointer' }}
                      disabled={isSubmitting}
                    >
                      Regenerate
                    </button>
                  </label>
                  <input 
                    type="text" 
                    className="form-input mono-font" 
                    value={customIdempotencyKey} 
                    onChange={(e) => setCustomIdempotencyKey(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              )}

              {gatewayMode === 'stripe' && stripePromise ? (
                <Elements stripe={stripePromise} key={settings.stripePublishableKey}>
                  <CheckoutForm 
                    amount={amount}
                    isSubmitting={isSubmitting}
                    setIsSubmitting={setIsSubmitting}
                    useIdempotency={useIdempotency}
                    customIdempotencyKey={customIdempotencyKey}
                    generateNewKey={generateNewKey}
                    setTxResult={setTxResult}
                    setCurrentTxId={setCurrentTxId}
                    setPipelineState={setPipelineState}
                    fetchState={fetchState}
                  />
                </Elements>
              ) : (
                <form onSubmit={handlePaymentSubmit}>
                  <div className="form-group">
                    <label>Cardholder Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={cardHolder} 
                      onChange={(e) => setCardHolder(e.target.value)} 
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="form-group">
                    <label>Card Number</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={cardNumber} 
                      onChange={(e) => setCardNumber(e.target.value)} 
                      disabled={isSubmitting}
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Processing Payment...' : `Pay $${parseFloat(amount || 0).toFixed(2)}`}
                  </button>
                </form>
              )}

              {txResult && (
                <div style={{ 
                  marginTop: '1.25rem', 
                  padding: '1rem', 
                  borderRadius: '8px', 
                  backgroundColor: txResult.success ? 'rgba(0, 230, 118, 0.08)' : txResult.warning ? 'rgba(255, 159, 0, 0.08)' : 'rgba(255, 51, 102, 0.08)',
                  border: `1px solid ${txResult.success ? 'rgba(0, 230, 118, 0.2)' : txResult.warning ? 'rgba(255, 159, 0, 0.2)' : 'rgba(255, 51, 102, 0.2)'}`,
                  color: txResult.success ? '#00e676' : txResult.warning ? '#ff9f00' : '#ff3366',
                  fontSize: '0.85rem'
                }}>
                  <strong>{txResult.success ? 'SUCCESS' : txResult.warning ? 'INDETERMINATE' : 'FAILED'}:</strong> {txResult.message}
                  {txResult.code && <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>Code: {txResult.code}</div>}
                </div>
              )}
            </div>

            {/* Simulator Controls */}
            <div className="glass-panel">
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Bank &amp; Merchant Simulator</h3>
              <div className="simulator-controls">
                
                <div className="control-card">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Acquiring Bank Simulator Settings</span>
                  <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                    <label style={{ fontSize: '0.75rem' }}>Bank API Error Mode</label>
                    <select 
                      className="form-select"
                      value={backendState.bankSettings.errorMode}
                      onChange={(e) => updateBankSettings('errorMode', e.target.value)}
                    >
                      <option value="success">Success (Approved)</option>
                      <option value="timeout">Timeout (Gateway 504 - Indeterminate)</option>
                      <option value="nsf">Declined (NSF - Insufficient Funds)</option>
                      <option value="rate_limit">Rate Limit Exceeded (HTTP 429)</option>
                      <option value="network_error">Network Connection Drop</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.75rem' }}>Bank Latency: {backendState.bankSettings.latency}ms</label>
                    <input 
                      type="range" 
                      min="100" 
                      max="3000" 
                      step="100" 
                      className="form-input" 
                      style={{ padding: 0, height: '6px' }}
                      value={backendState.bankSettings.latency}
                      onChange={(e) => updateBankSettings('latency', e.target.value)}
                    />
                  </div>
                </div>

                <div className="control-card">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Merchant Callback Site Status</span>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Determines if the merchant is online to receive Webhooks.</p>
                  <div className="toggle-group">
                    <button 
                      className={`toggle-btn ${backendState.merchantWebhookSettings.status === 'up' ? 'active' : ''}`}
                      onClick={() => updateMerchantSettings('up')}
                    >
                      ONLINE (HTTP 200)
                    </button>
                    <button 
                      className={`toggle-btn ${backendState.merchantWebhookSettings.status === 'down' ? 'active down' : ''}`}
                      onClick={() => updateMerchantSettings('down')}
                    >
                      CRASHED (HTTP 500)
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* MIDDLE COLUMN: Visualization & Terminal Logs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Visual Flow diagram */}
            <div className="glass-panel" style={{ minHeight: '340px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
                <h3>Transaction Pipeline Visualizer</h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status: {isSubmitting ? 'Processing request' : 'Idle'}</span>
              </div>

              <div className="pipeline-visualizer">
                <div className="pipeline-connector">
                  <div className="pipeline-connector-progress" style={{ width: `${pipelineState.connectorWidth}%` }} />
                </div>
                
                <div className="pipeline-nodes">
                  <div className={`pipeline-node ${pipelineState.nodes.checkout}`}>
                    <div className="node-circle"><CartIcon /></div>
                    <span className="node-label">Checkout</span>
                  </div>

                  <div className={`pipeline-node ${pipelineState.nodes.idempotency}`}>
                    <div className="node-circle"><IdempotencyIcon /></div>
                    <span className="node-label">Idempotency Check</span>
                  </div>

                  <div className={`pipeline-node ${pipelineState.nodes.hold}`}>
                    <div className="node-circle"><LockIcon /></div>
                    <span className="node-label">Ledger Hold</span>
                  </div>

                  <div className={`pipeline-node ${pipelineState.nodes.bank}`}>
                    <div className="node-circle"><BankIcon /></div>
                    <span className="node-label">Bank Auth</span>
                  </div>

                  <div className={`pipeline-node ${pipelineState.nodes.settlement}`}>
                    <div className="node-circle"><CheckIcon /></div>
                    <span className="node-label">Settle / Refund</span>
                  </div>

                  <div className={`pipeline-node ${pipelineState.nodes.webhook}`}>
                    <div className="node-circle"><WebhookIcon /></div>
                    <span className="node-label">Merchant Callback</span>
                  </div>
                </div>

                {/* Indeterminate Warning Panel */}
                {pipelineState.nodes.bank === 'warning' && (
                  <div className="guide-alert" style={{ width: '100%', marginTop: '2.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ flexShrink: 0 }}><InfoIcon /></div>
                    <div>
                      <h4 style={{ color: 'hsl(var(--accent-yellow))' }}>System in Indeterminate State!</h4>
                      <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                        The bank connection timed out. Customer funds are still held in escrow. 
                        <strong> Run the Reconciliation job</strong> to verify bank records and resolve the transaction.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Log terminal wrapper */}
            <div style={{ position: 'relative' }}>
              <div className="terminal-log" ref={terminalRef} onScroll={handleTerminalScroll}>
                <div className="terminal-header">
                  <span>GATEWAY SYSTEM TRACE OUTPUT</span>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button 
                      type="button"
                      onClick={() => setAutoScroll(!autoScroll)}
                      style={{ 
                        background: 'rgba(255,255,255,0.05)', 
                        border: `1px solid ${autoScroll ? 'rgba(0, 247, 255, 0.3)' : 'rgba(255,255,255,0.1)'}`, 
                        color: autoScroll ? 'hsl(var(--accent-cyan))' : 'var(--text-secondary)',
                        fontSize: '0.7rem', 
                        padding: '0.15rem 0.5rem', 
                        borderRadius: '4px', 
                        cursor: 'pointer',
                        transition: 'var(--transition-smooth)'
                      }}
                    >
                      Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
                    </button>
                    <span>LIVE FEED</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {backendState.logs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '2rem' }}>
                      No system operations logged. Submit a transaction or reset state to begin.
                    </div>
                  ) : (
                    backendState.logs.slice().reverse().map((log) => (
                      <div key={log.id} className={`log-entry ${log.source}`}>
                        <span className="timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className="source">[{log.source}]</span>
                        <span className="message">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Floating Scroll to Bottom Button */}
              {!autoScroll && backendState.logs.length > 0 && (
                <button
                  type="button"
                  className="btn-scroll-bottom"
                  onClick={() => {
                    setAutoScroll(true);
                    if (terminalRef.current) {
                      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
                    }
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.2rem' }}>
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                  </svg>
                  Scroll to Bottom
                </button>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Ledger Accounts & Webhook Queue & Reconciliation */}
          <div className="right-col">
            
            {/* Balances */}
            <div className="glass-panel">
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Ledger Account Balances</h3>
              <div className="balances-grid">
                <div className="balance-card customer">
                  <span className="label">Customer Card</span>
                  <span className="amount">${backendState.accounts.customer.toFixed(2)}</span>
                </div>
                <div className="balance-card merchant">
                  <span className="label">Merchant Settlement</span>
                  <span className="amount">${backendState.accounts.merchant.toFixed(2)}</span>
                </div>
                <div className="balance-card fees">
                  <span className="label">Gateway Revenue</span>
                  <span className="amount">${backendState.accounts.gateway_fees.toFixed(2)}</span>
                </div>
                <div className="balance-card reserve">
                  <span className="label">Bank Reserve</span>
                  <span className="amount">${(backendState.accounts.bank_reserve / 1000).toFixed(0)}K</span>
                </div>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem', textAlign: 'center' }}>
                Monetary Mass: <strong>${(backendState.accounts.customer + backendState.accounts.merchant + backendState.accounts.gateway_fees + backendState.accounts.bank_reserve).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
              </p>
            </div>

            {/* Reconciliation */}
            <div className="glass-panel">
              <h3 style={{ marginBottom: '0.5rem' }}>Out-of-Band Reconciliation</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Simulates a daily cron job that polls bank statement registries to resolve unresolved holds and correct balances.
              </p>
              <button 
                type="button" 
                className="btn-primary" 
                style={{ background: 'linear-gradient(135deg, #9d4edd 0%, #6366f1 100%)', boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)' }}
                onClick={runReconciliation}
                disabled={isSubmitting}
              >
                Trigger Reconciliation Engine
              </button>
            </div>

            {/* Webhook Queue */}
            <div className="glass-panel">
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Webhook Retries ({backendState.webhookQueue.length})</h3>
              <div className="webhook-queue-container">
                {backendState.webhookQueue.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                    Webhook queue is empty.
                  </div>
                ) : (
                  backendState.webhookQueue.map(item => (
                    <div key={item.id} className="queue-card">
                      <div className="header">
                        <span style={{ fontWeight: 600 }}>ID: {item.id.slice(0, 8)}</span>
                        <span className={`badge-status ${item.status}`}>{item.status.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Tx: {item.transactionId.slice(0, 8)} | Attempt #{item.attempt}/5
                      </div>
                      {item.status === 'backing_off' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                          <span style={{ fontSize: '0.7rem', color: 'hsl(var(--accent-yellow))' }}>Next attempt: {new Date(item.nextRetryTime).toLocaleTimeString()}</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* LEDGER JOURNAL TAB */}
      {activeTab === 'ledger' && (
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem' }}>
            <h2>Double-Entry Ledger Log (Immutable Record)</h2>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Total journal transactions: {backendState.ledger.length}</span>
          </div>
          
          <div className="ledger-table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Journal Entry ID</th>
                  <th>Debit (-)</th>
                  <th>Credit (+)</th>
                  <th>Amount</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {backendState.ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono-font" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td className="mono-font" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{entry.id}</td>
                    <td><span className={`badge-acc ${entry.debitAccount}`}>{entry.debitAccount}</span></td>
                    <td><span className={`badge-acc ${entry.creditAccount}`}>{entry.creditAccount}</span></td>
                    <td className="mono-font" style={{ fontWeight: 600 }}>${entry.amount.toFixed(2)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WEBHOOK MONITOR TAB */}
      {activeTab === 'webhooks' && (
        <div className="glass-panel">
          <div style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <h2>Webhook Delivery Logs</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Shows historic webhook attempts dispatched by the gateway</p>
          </div>

          <div className="ledger-table-container">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Webhook ID</th>
                  <th>Transaction ID</th>
                  <th>Attempt</th>
                  <th>Delivery Status</th>
                  <th>Response Content</th>
                </tr>
              </thead>
              <tbody>
                {backendState.webhookLogs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No webhook history logged yet.</td>
                  </tr>
                ) : (
                  backendState.webhookLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="mono-font" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="mono-font" style={{ fontSize: '0.8rem' }}>{log.webhookId.slice(0, 18)}...</td>
                      <td className="mono-font" style={{ fontSize: '0.8rem' }}>{log.transactionId.slice(0, 18)}...</td>
                      <td style={{ textAlign: 'center' }}>#{log.attempt}</td>
                      <td>
                        <span style={{ 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px', 
                          fontSize: '0.8rem', 
                          fontWeight: 600,
                          backgroundColor: log.success ? 'rgba(0, 230, 118, 0.1)' : 'rgba(255, 51, 102, 0.1)',
                          color: log.success ? '#00e676' : '#ff3366'
                        }}>
                          {log.success ? `SUCCESS (200)` : `FAILED (${log.status})`}
                        </span>
                      </td>
                      <td className="mono-font" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{JSON.stringify(log.response)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STRIPE SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="glass-panel" style={{ maxWidth: '650px', margin: '1.5rem auto', padding: '2rem' }}>
          <h2 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'hsl(var(--accent-cyan))' }}>Stripe API Integration Settings</span>
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: '1.5' }}>
            Configure your Stripe developer credentials. Saving these keys will write them to a local <code>.env</code> file in the backend server directory, initializing a live Stripe connection.
          </p>

          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Stripe Publishable Key (Test Mode)</label>
              <input 
                type="text" 
                className="form-input mono-font" 
                placeholder="pk_test_..." 
                value={publishableKeyInput} 
                onChange={(e) => setPublishableKeyInput(e.target.value)}
                required
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Used by React Stripe Elements to tokenize card details securely on the client.
              </span>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Stripe Secret Key (Test Mode)</label>
              <input 
                type="password" 
                className="form-input mono-font" 
                placeholder={settings.stripeSecretKey ? "••••••••••••••••" : "sk_test_..."}
                value={secretKeyInput} 
                onChange={(e) => setSecretKeyInput(e.target.value)}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Used by Express to create PaymentIntents. {settings.isStripeEnabled ? <strong style={{ color: '#00e676' }}>✓ Currently configured</strong> : <strong style={{ color: '#ff3366' }}>✗ Not configured</strong>}
              </span>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Stripe Webhook Signing Secret (Optional)</label>
              <input 
                type="password" 
                className="form-input mono-font" 
                placeholder={settings.stripeWebhookSecret ? "••••••••••••••••" : "whsec_..."}
                value={webhookSecretInput} 
                onChange={(e) => setWebhookSecretInput(e.target.value)}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                Used to verify signature headers sent by Stripe on incoming webhook requests.
              </span>
            </div>
            
            <button type="submit" className="btn-primary" style={{ marginTop: '0.75rem', alignSelf: 'flex-start' }}>
              Save Settings &amp; Connect
            </button>
          </form>
          
          <div style={{ marginTop: '2rem', padding: '1.25rem', borderRadius: '8px', border: '1px dashed var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
            <h4 style={{ color: 'hsl(var(--accent-cyan))', marginBottom: '0.5rem', fontWeight: 600 }}>Stripe Local Testing Workflow</h4>
            <ol style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem', lineHeight: '1.5' }}>
              <li>
                Sign in to the <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" style={{ color: 'hsl(var(--accent-cyan))', textDecoration: 'underline' }}>Stripe Dashboard</a> and toggle **Developer Test Mode**.
              </li>
              <li>
                Retrieve your **Publishable key** and **Secret key** from the **API keys** tab, and enter them above.
              </li>
              <li>
                Install the <a href="https://stripe.com/docs/stripe-cli" target="_blank" rel="noopener noreferrer" style={{ color: 'hsl(var(--accent-cyan))', textDecoration: 'underline' }}>Stripe CLI</a> to test webhooks locally.
              </li>
              <li>
                Authenticate the CLI and run this command to start forwarding events to your local server:
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.75rem', overflowX: 'auto', margin: '0.5rem 0' }}>
                  stripe listen --forward-to localhost:3000/api/webhook
                </pre>
              </li>
              <li>
                Copy the printed **webhook signing secret** (starting with `whsec_`) and paste it in the webhook secret field above to verify webhook integrity!
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* EDUCATIONAL DESIGN TAB */}
      {activeTab === 'learn' && (
        <div className="glass-panel">
          <div className="guide-content">
            
            <div className="guide-section">
              <h2>1. Idempotency Keys</h2>
              <p>
                In client-server programming, duplicate requests are inevitable. A user might click a "submit payment" button twice, 
                or a mobile network might disconnect right after sending a charge. Without protection, this results in the user being charged multiple times.
              </p>
              <div className="guide-alert">
                <strong>Try this in the playground:</strong> Turn on "Use Idempotency Key". Make a transaction. Try making the same transaction 
                again immediately with the same key. The system will detect the duplicate key in its store and return the cached success response 
                instantly without debiting the customer's ledger account again.
              </div>
              <p>
                Our server handles this with a lookup table that maps keys to processed responses. If a request is received while the previous request 
                is still "processing", it throws a <strong>409 Conflict</strong> to prevent concurrent processing race conditions.
              </p>
            </div>

            <div className="guide-section">
              <h2>2. Double-Entry Ledgers</h2>
              <p>
                In accounting systems, money is never modified in place (e.g. <code>balance = balance - 100</code>). Modifying balances directly has 
                significant disadvantages: there's no audit trail, it is prone to floating-point drift, and database locks lead to major concurrency bottleneck issues.
              </p>
              <p>
                We address this by logging every transfer as a balanced Journal Entry: a positive credit and a negative debit. 
                The sum of credits and debits always balances out to zero. We construct account balances dynamically by running a SUM over the journal entries:
              </p>
              <pre className="guide-code">
{`function getAccountBalance(accountName) {
  let balance = 0;
  for (const entry of state.ledger) {
    if (entry.creditAccount === accountName) balance += entry.amount;
    if (entry.debitAccount === accountName) balance -= entry.amount;
  }
  return balance;
}`}
              </pre>
            </div>

            <div className="guide-section">
              <h2>3. Timeouts &amp; Reconciliation</h2>
              <p>
                If a connection between the payment gateway and the acquiring bank fails mid-call, the transaction outcome is 
                <strong>indeterminate</strong>. The gateway does not know if the credit card was charged by Visa or not.
              </p>
              <div className="guide-alert">
                <strong>Try this in the playground:</strong> Set "Bank API Error Mode" to "Timeout". Submit a payment. The pipeline will halt at "Bank Auth" and 
                warn you that the gateway has timed out. The money remains locked in escrow. 
                Click <strong>"Trigger Reconciliation Engine"</strong> to run the background reconciler, which will locate the late approval in the bank register 
                and settle the funds.
              </div>
              <p>
                A reconciliation engine is a background service that matches internal gateway states against daily ledger registries from the banking network, 
                repairing errors and correcting balances automatically.
              </p>
            </div>

            <div className="guide-section">
              <h2>4. Webhook Retries with Exponential Backoff</h2>
              <p>
                Webhooks deliver real-time transaction updates from the gateway to the merchant's server. Because merchant servers can suffer 
                downtime, gateways must retry delivery with an increasing delay.
              </p>
              <p>
                Our implementation uses **Exponential Backoff**: the delay between retries doubles for each attempt (2s, 4s, 8s, 16s...) to give the merchant 
                server time to recover and prevent overload.
              </p>
              <div className="guide-alert">
                <strong>Try this in the playground:</strong> Set the Merchant Callback Site Status to "Crashed (HTTP 500)". Submit a successful transaction. 
                You will see the webhook fail. Check the "Webhook Retries" panel on the right: the webhook will enter a queue, and you can watch it count down 
                and retry with backing off delays!
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default App;
