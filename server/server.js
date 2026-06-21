import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Initialize Stripe if secret key is present in env
let stripeInstance = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
}


// ==========================================
// IN-MEMORY DATABASE & STATE
// ==========================================

let state = {
  // Account ledger balances
  accounts: {
    customer: 1000.00,
    merchant: 0.00,
    gateway_fees: 0.00,
    bank_reserve: 999000.00 // Total bank capitalization of $1,000,000.00 minus initial customer provision
  },
  
  // Detailed ledger entries (Double-entry format)
  ledger: [
    // Initial funding entries
    {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      debitAccount: 'bank_reserve', // Source
      creditAccount: 'customer',   // Destination
      amount: 1000.00,
      description: 'Initial customer account provisioning'
    }
  ],
  
  // Transaction catalog (with states: pending, succeeded, failed)
  transactions: {},
  
  // Idempotency cache: key -> { status, body, timestamp }
  idempotencyStore: {},
  
  // Webhook settings & dispatch queues
  merchantWebhookSettings: {
    status: 'up', // 'up' or 'down' (to simulate merchant site outages)
    url: 'http://localhost:3000/api/merchant/webhook'
  },
  
  // Logs of all webhooks sent
  webhookLogs: [],
  
  // Current active webhook retry queue (for visualization)
  webhookQueue: [],
  
  // Acquiring Bank Simulator Settings
  bankSettings: {
    latency: 1000, // in ms
    errorMode: 'success', // 'success', 'timeout', 'nsf' (insufficient funds), 'network_error', 'rate_limit'
  },

  // Bank records (what the bank thinks happened, for reconciliation)
  bankRecords: [],
  
  // System logs
  logs: []
};

// Log helper
function logSystemEvent(source, message, details = {}) {
  const logEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    source, // 'GATEWAY', 'BANK', 'MERCHANT', 'LEDGER', 'WEBHOOK'
    message,
    details
  };
  state.logs.unshift(logEntry);
  console.log(`[${logEntry.source}] ${logEntry.message}`);
}

// Keep track of active setTimeout instances separately
// to prevent storing circular Timeout objects in the serializable state
const activeTimers = {};

// Reset state
function resetState() {
  state.accounts = {
    customer: 1000.00,
    merchant: 0.00,
    gateway_fees: 0.00,
    bank_reserve: 999000.00
  };
  state.ledger = [
    {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      debitAccount: 'bank_reserve',
      creditAccount: 'customer',
      amount: 1000.00,
      description: 'Initial customer account provisioning'
    }
  ];
  state.transactions = {};
  state.idempotencyStore = {};
  state.merchantWebhookSettings.status = 'up';
  state.webhookLogs = [];
  // Cancel any active timeouts
  Object.keys(activeTimers).forEach(id => {
    clearTimeout(activeTimers[id]);
    delete activeTimers[id];
  });
  state.webhookQueue = [];
  state.bankSettings = {
    latency: 1000,
    errorMode: 'success'
  };
  state.bankRecords = [];
  state.logs = [];
  logSystemEvent('SYSTEM', 'State reset complete.');
}

// ==========================================
// DOUBLE-ENTRY BOOKKEEPING ENGINE
// ==========================================
// Ledger balance helper
function getAccountBalance(accountName) {
  // Balance = Initial balance + Total Credits (money in) - Total Debits (money out)
  const initialBalances = {
    customer: 0.00,
    merchant: 0.00,
    gateway_fees: 0.00,
    bank_reserve: 1000000.00
  };
  
  let balance = initialBalances[accountName] || 0.00;
  for (const entry of state.ledger) {
    if (entry.creditAccount === accountName) {
      balance += entry.amount;
    }
    if (entry.debitAccount === accountName) {
      balance -= entry.amount;
    }
  }
  return balance;
}

// Write ledger entry with safety check
function writeLedgerEntry(debitAccount, creditAccount, amount, description) {
  if (amount <= 0) {
    throw new Error('Ledger entry amount must be positive');
  }
  
  // Verify debit account has sufficient balance (except bank_reserve which is infinite)
  if (debitAccount !== 'bank_reserve') {
    const balance = getAccountBalance(debitAccount);
    if (balance < amount) {
      throw new Error(`Insufficient funds in ${debitAccount} for transfer of $${amount.toFixed(2)} (Available: $${balance.toFixed(2)})`);
    }
  }
  
  const entry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    debitAccount,
    creditAccount,
    amount: parseFloat(amount.toFixed(2)),
    description
  };
  
  state.ledger.push(entry);
  
  // Update cached accounts object for quick view
  state.accounts[debitAccount] = getAccountBalance(debitAccount);
  state.accounts[creditAccount] = getAccountBalance(creditAccount);
  
  logSystemEvent('LEDGER', `Ledger entry created: $${amount.toFixed(2)} from ${debitAccount} to ${creditAccount}`, { entry });
  return entry;
}

// ==========================================
// ACQUIRING BANK SIMULATOR
// ==========================================
function simulateBankCall(transactionId, amount) {
  return new Promise((resolve, reject) => {
    const { latency, errorMode } = state.bankSettings;
    
    logSystemEvent('BANK', `Processing bank call for transaction ${transactionId} (Mode: ${errorMode})`, { amount });
    
    setTimeout(() => {
      // Simulate network socket drop
      if (errorMode === 'network_error') {
        logSystemEvent('BANK', `Simulated socket drop / connection reset for transaction ${transactionId}`);
        return reject({ code: 'ECONNRESET', message: 'Connection reset by peer' });
      }
      
      // Simulate bank rate limit (HTTP 429)
      if (errorMode === 'rate_limit') {
        logSystemEvent('BANK', `Rate limit exceeded on acquiring API for transaction ${transactionId}`);
        return resolve({ status: 429, data: { error: 'Rate limit exceeded', code: 'BANK_RATE_LIMIT' } });
      }
      
      // Simulate insufficient funds (NSF)
      if (errorMode === 'nsf') {
        logSystemEvent('BANK', `Authorization declined: Insufficient funds for transaction ${transactionId}`);
        // Log to bank's internal record
        state.bankRecords.push({ transactionId, amount, status: 'DECLINED', code: 'NSF', timestamp: new Date().toISOString() });
        return resolve({ status: 200, data: { status: 'DECLINED', code: 'NSF', authCode: null } });
      }
      
      // Simulate bank timeout
      if (errorMode === 'timeout') {
        // Here, the server waits longer than the gateway's internal client timeout.
        // We will resolve it *eventually* (simulating that the bank actually processed it behind the scenes!).
        // This is a crucial edge case: the merchant gets a timeout error, but the customer was charged!
        logSystemEvent('BANK', `Bank processing delayed (timeout scenario) for transaction ${transactionId}. Bank will process it, but Gateway client will time out first.`);
        
        // Simulating the bank completed it *after* the gateway client disconnected (we simulate gateway timeout at 2000ms, bank completes at 4000ms)
        setTimeout(() => {
          // Check if this record is already logged to prevent duplicates if retried
          if (!state.bankRecords.find(r => r.transactionId === transactionId)) {
            state.bankRecords.push({ transactionId, amount, status: 'SUCCESS', code: 'APPROVED', authCode: `AUTH-${uuidv4().slice(0,8).toUpperCase()}`, timestamp: new Date().toISOString() });
            logSystemEvent('BANK', `Bank late processing succeeded for transaction ${transactionId} (Settled in Bank Ledger)`);
          }
        }, 3000);
        
        // We reject the current promise simulating a gateway client read-timeout
        return reject({ code: 'ETIMEDOUT', message: 'Connection timed out reading from acquiring network' });
      }
      
      // Success case
      const authCode = `AUTH-${uuidv4().slice(0,8).toUpperCase()}`;
      state.bankRecords.push({ transactionId, amount, status: 'SUCCESS', code: 'APPROVED', authCode, timestamp: new Date().toISOString() });
      logSystemEvent('BANK', `Authorization approved for transaction ${transactionId}`, { authCode });
      resolve({ status: 200, data: { status: 'APPROVED', code: 'APPROVED', authCode } });
      
    }, latency);
  });
}

// ==========================================
// ASYNCHRONOUS WEBHOOK QUEUE WITH EXPONENTIAL BACKOFF
// ==========================================
function enqueueWebhook(transactionId, transactionStatus) {
  const webhookId = uuidv4();
  const webhookPayload = {
    id: webhookId,
    event: 'payment.updated',
    timestamp: new Date().toISOString(),
    data: {
      transactionId,
      status: transactionStatus,
      amount: state.transactions[transactionId]?.amount,
      currency: 'USD'
    }
  };
  
  const queueItem = {
    id: webhookId,
    transactionId,
    payload: webhookPayload,
    attempt: 0,
    nextRetryTime: new Date().toISOString(),
    status: 'pending',
    logs: []
  };
  
  state.webhookQueue.push(queueItem);
  logSystemEvent('WEBHOOK', `Queued webhook event for transaction ${transactionId}`, { webhookId });
  
  dispatchWebhook(queueItem);
}

function dispatchWebhook(queueItem) {
  queueItem.attempt += 1;
  const attemptIndex = queueItem.attempt;
  
  logSystemEvent('WEBHOOK', `Sending webhook attempt #${attemptIndex} for transaction ${queueItem.transactionId}...`);
  
  // Call simulated merchant webhook receiver endpoint
  // We do it inline to simulate a network call
  setTimeout(() => {
    const isMerchantUp = state.merchantWebhookSettings.status === 'up';
    const responseStatus = isMerchantUp ? 200 : 500;
    const responseBody = isMerchantUp ? { received: true } : { error: 'Merchant server down' };
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      attempt: attemptIndex,
      status: responseStatus,
      response: responseBody
    };
    
    queueItem.logs.push(logEntry);
    
    // Log globally
    state.webhookLogs.unshift({
      id: uuidv4(),
      webhookId: queueItem.id,
      transactionId: queueItem.transactionId,
      timestamp: logEntry.timestamp,
      attempt: attemptIndex,
      success: isMerchantUp,
      status: responseStatus,
      response: responseBody
    });
    
    if (isMerchantUp) {
      logSystemEvent('WEBHOOK', `Webhook delivered successfully on attempt #${attemptIndex} for transaction ${queueItem.transactionId}`);
      queueItem.status = 'delivered';
      // Remove from active queue
      state.webhookQueue = state.webhookQueue.filter(item => item.id !== queueItem.id);
    } else {
      logSystemEvent('WEBHOOK', `Webhook delivery failed on attempt #${attemptIndex} (Status ${responseStatus}) for transaction ${queueItem.transactionId}`);
      
      if (attemptIndex >= 5) {
        logSystemEvent('WEBHOOK', `Webhook failed permanently after max retries (5) for transaction ${queueItem.transactionId}`);
        queueItem.status = 'failed_permanently';
        state.webhookQueue = state.webhookQueue.filter(item => item.id !== queueItem.id);
      } else {
        // Calculate backoff: 2^attempt * 2000 ms (e.g., 4s, 8s, 16s, 32s)
        const delayMs = Math.pow(2, attemptIndex) * 2000;
        const nextTime = new Date(Date.now() + delayMs);
        queueItem.nextRetryTime = nextTime.toISOString();
        queueItem.status = 'backing_off';
        
        logSystemEvent('WEBHOOK', `Webhook scheduled to retry in ${delayMs / 1000}s (at ${queueItem.nextRetryTime})`);
        
        activeTimers[queueItem.id] = setTimeout(() => {
          delete activeTimers[queueItem.id];
          dispatchWebhook(queueItem);
        }, delayMs);
      }
    }
  }, 300); // Small network trip time simulation
}

// ==========================================
// CORE PAYMENT GATEWAY CONTROLLER
// ==========================================
async function processPayment(req, res, idempotencyKey) {
  const { amount, cardInfo } = req.body;
  const transactionId = uuidv4();
  
  logSystemEvent('GATEWAY', `Starting payment process. Transaction ID: ${transactionId}, Amount: $${amount.toFixed(2)}`, { idempotencyKey });
  
  // 1. Validate inputs
  if (!amount || amount <= 0) {
    const errorBody = { error: 'Invalid amount', code: 'INVALID_AMOUNT' };
    if (idempotencyKey) state.idempotencyStore[idempotencyKey] = { status: 400, body: errorBody, timestamp: new Date().toISOString() };
    return res.status(400).json(errorBody);
  }
  
  // 2. Initialize Transaction in State
  state.transactions[transactionId] = {
    id: transactionId,
    amount,
    status: 'pending',
    idempotencyKey,
    timestamp: new Date().toISOString(),
    bankResponse: null
  };
  
  // 3. Create Ledger Hold Entry (Move from customer to gateway escrow)
  // This locks the funds while processing so the customer cannot double-spend
  try {
    writeLedgerEntry('customer', 'bank_reserve', amount, `Hold funds for payment tx: ${transactionId}`);
  } catch (err) {
    logSystemEvent('GATEWAY', `Payment failed at ledger stage: ${err.message}`);
    state.transactions[transactionId].status = 'failed';
    state.transactions[transactionId].bankResponse = { error: err.message, code: 'INSUFFICIENT_FUNDS' };
    
    const errorBody = { success: false, transactionId, error: err.message, code: 'INSUFFICIENT_FUNDS' };
    if (idempotencyKey) state.idempotencyStore[idempotencyKey] = { status: 402, body: errorBody, timestamp: new Date().toISOString() };
    return res.status(402).json(errorBody);
  }
  
  // 4. Call acquiring bank
  try {
    const bankRes = await simulateBankCall(transactionId, amount);
    
    if (bankRes.status === 200 && bankRes.data.status === 'APPROVED') {
      // SUCCESSFUL TRANSACTION
      state.transactions[transactionId].status = 'succeeded';
      state.transactions[transactionId].bankResponse = bankRes.data;
      
      // Complete double entry ledger transfers
      const gatewayFee = parseFloat((amount * 0.02).toFixed(2)); // 2% gateway fee
      const merchantSettlement = parseFloat((amount - gatewayFee).toFixed(2));
      
      // Move customer escrow to merchant bank account & gateway fees account
      writeLedgerEntry('bank_reserve', 'merchant', merchantSettlement, `Settlement for transaction: ${transactionId}`);
      writeLedgerEntry('bank_reserve', 'gateway_fees', gatewayFee, `Fee share for transaction: ${transactionId}`);
      
      logSystemEvent('GATEWAY', `Payment completed successfully. Tx: ${transactionId}. Net to Merchant: $${merchantSettlement.toFixed(2)}, Fee: $${gatewayFee.toFixed(2)}`);
      
      const successBody = { success: true, transactionId, status: 'succeeded', authCode: bankRes.data.authCode };
      
      // Cache response for idempotency
      if (idempotencyKey) {
        state.idempotencyStore[idempotencyKey] = { status: 200, body: successBody, timestamp: new Date().toISOString() };
      }
      
      // Queue merchant webhook notification
      enqueueWebhook(transactionId, 'succeeded');
      
      return res.status(200).json(successBody);
    } else {
      // DECLINED TRANSACTION (e.g. NSF)
      state.transactions[transactionId].status = 'failed';
      state.transactions[transactionId].bankResponse = bankRes.data;
      
      // Release Hold: Refund customer
      writeLedgerEntry('bank_reserve', 'customer', amount, `Release hold (declined tx: ${transactionId})`);
      
      logSystemEvent('GATEWAY', `Payment declined by bank. Tx: ${transactionId}. Code: ${bankRes.data.code}`);
      
      const declineBody = { success: false, transactionId, status: 'failed', error: 'Declined by card issuer', code: bankRes.data.code };
      if (idempotencyKey) {
        state.idempotencyStore[idempotencyKey] = { status: 400, body: declineBody, timestamp: new Date().toISOString() };
      }
      
      enqueueWebhook(transactionId, 'failed');
      
      return res.status(400).json(declineBody);
    }
    
  } catch (bankErr) {
    // 5. Handle Network Failures / Bank Timeouts
    // This is the CRITICAL state. The gateway is in an indeterminate state!
    // We cannot refund the customer immediately because the bank *might* have processed it.
    // The transaction status remains 'pending_reconciliation' or 'pending' in our logs.
    state.transactions[transactionId].status = 'pending_reconciliation';
    state.transactions[transactionId].bankResponse = { error: bankErr.message, code: bankErr.code || 'GATEWAY_TIMEOUT' };
    
    logSystemEvent('GATEWAY', `Indeterminate payment state (Network issue). Tx: ${transactionId}. Error: ${bankErr.message}. Transaction held for reconciliation.`);
    
    // We do NOT write a ledger entry back (we keep the money on hold to prevent double spending until reconciled!).
    
    const timeoutBody = {
      success: false,
      transactionId,
      status: 'pending_reconciliation',
      error: 'Gateway encountered a temporary processor communication timeout. The status is indeterminate.',
      code: 'GATEWAY_TIMEOUT'
    };
    
    if (idempotencyKey) {
      state.idempotencyStore[idempotencyKey] = { status: 504, body: timeoutBody, timestamp: new Date().toISOString() };
    }
    
    return res.status(504).json(timeoutBody);
  }
}

// ==========================================
// API ROUTING
// ==========================================

// Webhook route must be registered BEFORE express.json() is applied
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  if (!stripeInstance) {
    logSystemEvent('WEBHOOK', 'Warning: Received webhook but Stripe is not initialized.');
    return res.status(400).send('Stripe not initialized');
  }

  try {
    if (endpointSecret) {
      event = stripeInstance.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = JSON.parse(req.body.toString());
      logSystemEvent('WEBHOOK', 'Webhook received without signature verification (no webhook secret set).');
    }
  } catch (err) {
    logSystemEvent('WEBHOOK', `Webhook error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logSystemEvent('WEBHOOK', `Stripe Webhook event received: ${event.type}`, { eventId: event.id });

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      const txId = paymentIntent.id;
      const amount = paymentIntent.amount / 100;
      
      logSystemEvent('WEBHOOK', `PaymentIntent succeeded: ${txId} for $${amount.toFixed(2)}`);
      
      // Update transaction state
      if (state.transactions[txId]) {
        const tx = state.transactions[txId];
        tx.status = 'succeeded';
        tx.bankResponse = paymentIntent;
        
        // Ledger entry transfers
        const gatewayFee = parseFloat((amount * 0.02).toFixed(2)); // 2% gateway fee
        const merchantSettlement = parseFloat((amount - gatewayFee).toFixed(2));
        
        writeLedgerEntry('bank_reserve', 'merchant', merchantSettlement, `Stripe Settlement for transaction: ${txId}`);
        writeLedgerEntry('bank_reserve', 'gateway_fees', gatewayFee, `Stripe Fee share for transaction: ${txId}`);
        
        enqueueWebhook(txId, 'succeeded');
      } else {
        // Create transactional state on the fly if it doesn't exist
        state.transactions[txId] = {
          id: txId,
          amount,
          status: 'succeeded',
          timestamp: new Date().toISOString(),
          bankResponse: paymentIntent
        };
        // Ledger entries
        writeLedgerEntry('customer', 'bank_reserve', amount, `Stripe hold funds (PaymentIntent succeeded: ${txId})`);
        const gatewayFee = parseFloat((amount * 0.02).toFixed(2));
        const merchantSettlement = parseFloat((amount - gatewayFee).toFixed(2));
        writeLedgerEntry('bank_reserve', 'merchant', merchantSettlement, `Stripe Settlement for transaction: ${txId}`);
        writeLedgerEntry('bank_reserve', 'gateway_fees', gatewayFee, `Stripe Fee share for transaction: ${txId}`);
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object;
      const txId = paymentIntent.id;
      const amount = paymentIntent.amount / 100;
      
      logSystemEvent('WEBHOOK', `PaymentIntent failed: ${txId}. Reason: ${paymentIntent.last_payment_error?.message || 'unknown'}`);
      
      if (state.transactions[txId]) {
        const tx = state.transactions[txId];
        tx.status = 'failed';
        tx.bankResponse = paymentIntent;
        
        // Release Hold: Refund customer
        writeLedgerEntry('bank_reserve', 'customer', amount, `Stripe Release hold (failed tx: ${txId})`);
        enqueueWebhook(txId, 'failed');
      }
      break;
    }
    default:
      logSystemEvent('WEBHOOK', `Unhandled Stripe event type ${event.type}`);
  }

  res.json({ received: true });
});

// Apply JSON parsing middleware to all subsequent routes
app.use(express.json());

// Get Stripe & application settings
app.get('/api/settings', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ? 'sk_test_••••' + process.env.STRIPE_SECRET_KEY.slice(-4) : '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'whsec_••••' + process.env.STRIPE_WEBHOOK_SECRET.slice(-4) : '',
    isStripeEnabled: !!stripeInstance
  });
});

// Update Stripe settings
app.post('/api/settings', (req, res) => {
  const { publishableKey, secretKey, webhookSecret } = req.body;
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const envPath = path.join(__dirname, '.env');
  
  let envContent = '';
  if (publishableKey) envContent += `STRIPE_PUBLISHABLE_KEY=${publishableKey}\n`;
  if (secretKey) envContent += `STRIPE_SECRET_KEY=${secretKey}\n`;
  if (webhookSecret) envContent += `STRIPE_WEBHOOK_SECRET=${webhookSecret}\n`;
  
  try {
    fs.writeFileSync(envPath, envContent);
    
    // Reload env variables
    dotenv.config({ path: envPath, override: true });
    
    // Re-initialize Stripe client
    if (process.env.STRIPE_SECRET_KEY) {
      stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
      logSystemEvent('SYSTEM', 'Stripe client initialized successfully.');
    } else {
      stripeInstance = null;
      logSystemEvent('SYSTEM', 'Stripe client cleared.');
    }
    
    res.json({
      success: true,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      isStripeEnabled: !!stripeInstance
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create Stripe PaymentIntent
app.post('/api/gateway/create-payment-intent', async (req, res) => {
  const { amount } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'];
  
  if (!stripeInstance) {
    return res.status(400).json({ error: 'Stripe is not configured. Please set API keys in Settings.', code: 'STRIPE_NOT_CONFIGURED' });
  }
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount', code: 'INVALID_AMOUNT' });
  }
  
  try {
    logSystemEvent('GATEWAY', `Stripe PaymentIntent request received for $${parseFloat(amount).toFixed(2)}`, { idempotencyKey });
    
    // Create PaymentIntent in Stripe
    const paymentIntentOptions = {
      amount: Math.round(parseFloat(amount) * 100), // in cents
      currency: 'usd',
      metadata: { idempotencyKey }
    };
    
    const requestOptions = {};
    if (idempotencyKey) {
      requestOptions.idempotencyKey = idempotencyKey;
    }
    
    const paymentIntent = await stripeInstance.paymentIntents.create(paymentIntentOptions, requestOptions);
    
    // Create transaction in state
    state.transactions[paymentIntent.id] = {
      id: paymentIntent.id,
      amount: parseFloat(amount),
      status: 'pending',
      idempotencyKey,
      timestamp: new Date().toISOString(),
      bankResponse: null
    };
    
    // Create Ledger Hold entry (source: customer, destination: bank_reserve)
    writeLedgerEntry('customer', 'bank_reserve', parseFloat(amount), `Stripe hold funds (PaymentIntent created: ${paymentIntent.id})`);
    
    logSystemEvent('GATEWAY', `Stripe PaymentIntent created: ${paymentIntent.id}. Client secret returned.`);
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      transactionId: paymentIntent.id
    });
  } catch (error) {
    logSystemEvent('SYSTEM', `Stripe error during PaymentIntent creation: ${error.message}`);
    res.status(500).json({ error: error.message, code: 'STRIPE_ERROR' });
  }
});

// 1. Reset state
app.post('/api/state/reset', (req, res) => {
  resetState();
  res.json({ message: 'State reset successfully' });
});

// 2. Fetch current playground state
app.get('/api/state', (req, res) => {
  res.json(state);
});

// 3. Update Bank Settings
app.post('/api/bank/settings', (req, res) => {
  const { latency, errorMode } = req.body;
  if (latency !== undefined) state.bankSettings.latency = parseInt(latency);
  if (errorMode !== undefined) state.bankSettings.errorMode = errorMode;
  logSystemEvent('SYSTEM', `Bank settings updated. Latency: ${state.bankSettings.latency}ms, Error Mode: ${state.bankSettings.errorMode}`);
  res.json(state.bankSettings);
});

// 4. Update Merchant Settings
app.post('/api/merchant/settings', (req, res) => {
  const { status } = req.body;
  if (status !== undefined) state.merchantWebhookSettings.status = status;
  logSystemEvent('SYSTEM', `Merchant webhook receiver status set to: ${state.merchantWebhookSettings.status.toUpperCase()}`);
  res.json(state.merchantWebhookSettings);
});

// 5. Submit charge endpoint (Main gateway API)
app.post('/api/gateway/charge', async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  
  if (!idempotencyKey) {
    // Process without idempotency protection
    logSystemEvent('GATEWAY', 'WARNING: Request received without Idempotency Key header.');
    return await processPayment(req, res, null);
  }
  
  // Idempotency Key validation
  const existingKey = state.idempotencyStore[idempotencyKey];
  
  if (existingKey) {
    if (existingKey.status === 'processing') {
      logSystemEvent('GATEWAY', `CONCURRENCY BLOCKED: Duplicate request with key '${idempotencyKey}' is already processing. Returning 409.`);
      return res.status(409).json({ error: 'Concurrent request already in progress', code: 'CONCURRENT_REQUEST' });
    }
    
    logSystemEvent('GATEWAY', `IDEMPOTENCY CACHE HIT: Returning cached response for key '${idempotencyKey}'`);
    res.setHeader('x-cache', 'HIT');
    return res.status(existingKey.status).json(existingKey.body);
  }
  
  // Lock the key while processing
  state.idempotencyStore[idempotencyKey] = { status: 'processing', body: null, timestamp: new Date().toISOString() };
  
  // Process payment
  try {
    await processPayment(req, res, idempotencyKey);
  } catch (error) {
    logSystemEvent('SYSTEM', `Fatal error during payment execution: ${error.message}`);
    // Unlock or cache error
    const fatalError = { error: 'Internal gateway error', code: 'INTERNAL_ERROR' };
    state.idempotencyStore[idempotencyKey] = { status: 500, body: fatalError, timestamp: new Date().toISOString() };
    res.status(500).json(fatalError);
  }
});

// 6. Manual Reconciliation Endpoint
app.post('/api/gateway/reconcile', (req, res) => {
  logSystemEvent('GATEWAY', 'Starting manual reconciliation matching routine...');
  let resolvedCount = 0;
  
  // Look at all pending_reconciliation transactions
  Object.keys(state.transactions).forEach(txId => {
    const tx = state.transactions[txId];
    if (tx.status === 'pending_reconciliation') {
      logSystemEvent('GATEWAY', `Reconciling transaction ${txId}... Checking bank registry.`);
      
      // Look up bank's records
      const bankRecord = state.bankRecords.find(r => r.transactionId === txId);
      
      if (bankRecord) {
        if (bankRecord.status === 'SUCCESS') {
          // Bank successfully charged! We settle it.
          tx.status = 'succeeded';
          tx.bankResponse = { status: 'APPROVED', code: 'APPROVED', authCode: bankRecord.authCode };
          
          const gatewayFee = parseFloat((tx.amount * 0.02).toFixed(2));
          const merchantSettlement = parseFloat((tx.amount - gatewayFee).toFixed(2));
          
          writeLedgerEntry('bank_reserve', 'merchant', merchantSettlement, `Reconciled Settlement for transaction: ${txId}`);
          writeLedgerEntry('bank_reserve', 'gateway_fees', gatewayFee, `Reconciled Fee share for transaction: ${txId}`);
          
          logSystemEvent('GATEWAY', `Reconciliation SUCCESS: Transaction ${txId} resolved. Settled payouts.`);
          enqueueWebhook(txId, 'succeeded');
        } else {
          // Bank declined it
          tx.status = 'failed';
          tx.bankResponse = { status: 'DECLINED', code: bankRecord.code };
          
          // Refund/release hold
          writeLedgerEntry('bank_reserve', 'customer', tx.amount, `Reconciled release hold (failed tx: ${txId})`);
          logSystemEvent('GATEWAY', `Reconciliation DECLINED: Transaction ${txId} resolved. Released customer hold.`);
          enqueueWebhook(txId, 'failed');
        }
      } else {
        // Bank has NO record of this transaction!
        // This means the network timeout occurred BEFORE the bank processed the request.
        // It is safe to cancel it and release the hold.
        tx.status = 'failed';
        tx.bankResponse = { status: 'NO_RECORD', code: 'GATEWAY_TIMEOUT_CANCELLED' };
        
        writeLedgerEntry('bank_reserve', 'customer', tx.amount, `Reconciled release hold (timeout cancel tx: ${txId})`);
        logSystemEvent('GATEWAY', `Reconciliation NOT_FOUND: Bank has no record of ${txId}. Cancelled transaction and refunded customer.`);
        enqueueWebhook(txId, 'failed');
      }
      
      // Update cached response in Idempotency Store
      if (tx.idempotencyKey) {
        const cachedEntry = state.idempotencyStore[tx.idempotencyKey];
        if (cachedEntry) {
          if (tx.status === 'succeeded') {
            cachedEntry.status = 200;
            cachedEntry.body = { success: true, transactionId: txId, status: 'succeeded', authCode: tx.bankResponse.authCode };
          } else {
            cachedEntry.status = 400;
            cachedEntry.body = { success: false, transactionId: txId, status: 'failed', error: 'Declined or timed out', code: tx.bankResponse.code };
          }
        }
      }
      resolvedCount++;
    }
  });
  
  res.json({ success: true, reconciledCount: resolvedCount });
});

// 7. Simulated Merchant Webhook Receiver endpoint
// This endpoint simulates the webhook target. We just log the request payload.
app.post('/api/merchant/webhook', (req, res) => {
  const { status } = state.merchantWebhookSettings;
  if (status === 'down') {
    // Simulate server crash
    return res.status(500).send('Internal Server Error');
  }
  
  res.status(200).json({ received: true });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Payment Gateway backend listening on port ${PORT}`);
});
