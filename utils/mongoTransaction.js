const mongoose = require('mongoose');

async function withMongoTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (error.code === 20 || /Transaction numbers are only allowed/i.test(error.message || '')) {
      throw Object.assign(new Error('This financial action requires MongoDB transactions. Configure MongoDB as a replica set.'), { status: 503 });
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { withMongoTransaction };
