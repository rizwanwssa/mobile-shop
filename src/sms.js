'use strict';
/*
 * SMS stub — single integration point. Real provider (Twilio / DJuice / local PK gateway)
 * is enabled by setting SMS_PROVIDER and credentials. In dev (default) it logs to console
 * and records the attempt so the rest of the system is fully verifiable without an account.
 */
function sendSMS(phone, message) {
  const provider = process.env.SMS_PROVIDER || 'dev';
  if (provider === 'dev') {
    const row = { to: phone, message, via: 'dev-stub', sent_at: new Date().toISOString() };
    console.log('[SMS STUB] ->', phone, ':', message);
    // record in a jsonl log so verification can confirm it fired
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'sms.log'), JSON.stringify(row) + '\n');
    return { ok: true, stub: true, ...row };
  }
  // --- real providers wired here later ---
  if (provider === 'twilio') {
    // require('twilio')(...)  -> implement when account ready
    throw new Error('twilio provider not configured');
  }
  throw new Error('unknown SMS_PROVIDER: ' + provider);
}

module.exports = { sendSMS };
