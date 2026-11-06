const crypto = require('crypto');
const env = require('../config/env');

function verifyTelegramInitData(initData) {
  if (!env.botToken || typeof initData !== 'string' || initData.length > 10_000) {
    throw Object.assign(new Error('Telegram authentication is not configured.'), { status: 503 });
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isInteger(authDate)) {
    throw Object.assign(new Error('Invalid Telegram authentication data.'), { status: 401 });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > 86400) {
    throw Object.assign(new Error('Telegram authentication data has expired.'), { status: 401 });
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
  const receivedHash = Buffer.from(hash, 'hex');
  if (receivedHash.length !== expectedHash.length || !crypto.timingSafeEqual(receivedHash, expectedHash)) {
    throw Object.assign(new Error('Telegram authentication verification failed.'), { status: 401 });
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch {
    throw Object.assign(new Error('Invalid Telegram user data.'), { status: 401 });
  }
  if (!user || !/^\d{1,20}$/.test(String(user.id)) || typeof user.first_name !== 'string') {
    throw Object.assign(new Error('Invalid Telegram user data.'), { status: 401 });
  }
  return { user, startParam: params.get('start_param') || '' };
}

module.exports = { verifyTelegramInitData };
