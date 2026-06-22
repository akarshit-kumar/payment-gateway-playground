# 💳 Interactive Payment Gateway & System Design Playground
A robust, full-stack payment gateway sandbox and visualization engine built with the JavaScript ecosystem, focusing on high-concurrency patterns, double-entry ledger bookkeeping, reliable webhook delivery, and transaction reconciliation under network partition.
---
## 🚀 Core Features
- **Idempotency Engine**: Prevents double-charging on network dropouts or concurrent requests using unique idempotency keys with atomic locking and cached responses.
- **Double-Entry Bookkeeping**: Absolute data integrity with an immutable transaction ledger. Balances are computed dynamically as credit-debit sums, maintaining a full audit log.
- **Acquiring Bank Simulator**: Simulated bank backend with adjustable latency and various error modes (timeouts, rate-limiting, NSF, and socket drops) to test system resilience.
- **Asynchronous Webhook Queue**: Guarantees at-least-once webhook notification delivery using queue workers with exponential backoff and retry limits.
- **Indeterminate State Reconciliation**: Background worker checks the bank statements to automatically settle or cancel hung/timeout transactions, resolving state mismatches.
- **Dual Gateway Modes**: Toggle seamlessly between the simulated offline sandbox and a real Stripe API integration with Stripe Elements.
---
## 🛠️ Technology Stack
- **Frontend**: React.js, Vite, Stripe Elements, Tailwind CSS, Custom SVG Visualizations
- **Backend**: Node.js, Express.js, REST APIs
- **Storage**: In-memory database reproducing transactional state, ledger registers, and idempotency key caches.
- **Testing & Tools**: Concurrently, Git, NPM
---
## 📦 Local Installation & Setup
1. **Clone the repository:**
   ```bash
   git clone https://github.com/akarshit-kumar/payment-gateway-playground.git
   cd payment-gateway-playground
   ```
2. **Install dependencies:**
   The project is set up as a monorepo. Install dependencies for both `server` and `client` folders using the utility script:
   ```bash
   npm run install:all
   ```
3. **Configure Environment Variables (Optional):**
   To test the real Stripe integration, create a `.env` file in the `server` directory:
   ```env
   PORT=3000
   STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   ```
   *(Note: You can also configure these keys dynamically directly from the UI settings tab!)*
4. **Run the development servers:**
   Launch both the React frontend and Express backend concurrently:
   ```bash
   npm run dev
   ```
   The client will run on [http://localhost:5173](http://localhost:5173) and the backend server on [http://localhost:3000](http://localhost:3000).
---
## 📖 Deep-Dive System Architecture
For a detailed explanation of the system topology, idempotency sequence flows, bookkeeping patterns, and reconciliation state machines, please refer to the [System Design Document](SYSTEM_DESIGN.md).
