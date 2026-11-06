require('../config/env');
const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const Content = require('../models/Content');

const starterContents = Array.from({ length: 20 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    seedKey: `starter-viral-link-${number}`,
    title: `Viral link starter ${number}`,
    imageUrl: '',
    videoUrl: '',
    date: new Date(Date.now() - index * 86400000),
    totalViews: 0,
    requiredTaskCount: 0,
    isActive: true,
    isTrending: index < 5
  };
});

async function seed() {
  try {
    await connectDatabase();
    const operations = starterContents.map((content) => ({
      updateOne: {
        filter: { seedKey: content.seedKey },
        update: { $setOnInsert: content },
        upsert: true
      }
    }));
    const result = await Content.bulkWrite(operations, { ordered: true });
    console.info(`Seed complete: ${result.upsertedCount} starter content records inserted; existing records were preserved.`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error) => {
  console.error('Content seeding failed:', error);
  process.exitCode = 1;
});
