const ActivityLog = require('../models/ActivityLog');

async function logActivity({ actorId = null, actorType = 'system', action, targetType = '', targetId = '', amount = null, details = {} }) {
  return ActivityLog.create({ actorId, actorType, action, targetType, targetId, amount, details });
}

module.exports = { logActivity };
