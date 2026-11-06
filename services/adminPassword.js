const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

async function verifyAdminPassword(candidate, configuredPassword) {
  if (!configuredPassword) return false;
  if (BCRYPT_HASH_PATTERN.test(configuredPassword)) {
    return bcrypt.compare(candidate, configuredPassword);
  }
  const candidateDigest = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const configuredDigest = crypto.createHash('sha256').update(configuredPassword, 'utf8').digest();
  return crypto.timingSafeEqual(candidateDigest, configuredDigest);
}

module.exports = { verifyAdminPassword };
