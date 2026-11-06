require('../config/env');
const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const Content = require('../models/Content');
const { CONTENT_TASK_COUNT } = require('../services/contentTasks');

const starterContents = [
  { title: 'Advanced Python Tutorial for Beginners', imageUrl: 'https://picsum.photos/seed/py1/300/200', videoUrl: 'https://youtube.com/watch?v=sample01', date: '2026-01-10', totalViews: 125000 },
  { title: 'Mastering UI/UX Design Principles', imageUrl: 'https://picsum.photos/seed/ui2/300/200', videoUrl: 'https://youtube.com/watch?v=sample02', date: '2026-01-15', totalViews: 84200 },
  { title: "Travel Vlog: Exploring Cox's Bazar", imageUrl: 'https://picsum.photos/seed/tr3/300/200', videoUrl: 'https://youtube.com/watch?v=sample03', date: '2026-01-20', totalViews: 250000 },
  { title: 'Top 10 JavaScript Frameworks in 2026', imageUrl: 'https://picsum.photos/seed/js4/300/200', videoUrl: 'https://youtube.com/watch?v=sample04', date: '2026-01-22', totalViews: 95600 },
  { title: 'Healthy Meal Prep for Busy Professionals', imageUrl: 'https://picsum.photos/seed/fd5/300/200', videoUrl: 'https://youtube.com/watch?v=sample05', date: '2026-01-25', totalViews: 43100 },
  { title: 'Introduction to Artificial Intelligence', imageUrl: 'https://picsum.photos/seed/ai6/300/200', videoUrl: 'https://youtube.com/watch?v=sample06', date: '2026-02-01', totalViews: 510000 },
  { title: 'Digital Marketing Strategy Guide', imageUrl: 'https://picsum.photos/seed/dm7/300/200', videoUrl: 'https://youtube.com/watch?v=sample07', date: '2026-02-05', totalViews: 67800 },
  { title: 'Lofi Hip Hop Beats to Relax / Study to', imageUrl: 'https://picsum.photos/seed/lf8/300/200', videoUrl: 'https://youtube.com/watch?v=sample08', date: '2026-02-10', totalViews: 340000 },
  { title: 'Home Workout Routine Without Equipment', imageUrl: 'https://picsum.photos/seed/hw9/300/200', videoUrl: 'https://youtube.com/watch?v=sample09', date: '2026-02-14', totalViews: 112000 },
  { title: 'Smartphone Photography Tips & Tricks', imageUrl: 'https://picsum.photos/seed/ph10/300/200', videoUrl: 'https://youtube.com/watch?v=sample10', date: '2026-02-18', totalViews: 75400 },
  { title: 'Cloud Computing Basics with AWS', imageUrl: 'https://picsum.photos/seed/aws11/300/200', videoUrl: 'https://youtube.com/watch?v=sample11', date: '2026-02-22', totalViews: 89300 },
  { title: '15 Minute Full Body Stretch', imageUrl: 'https://picsum.photos/seed/st12/300/200', videoUrl: 'https://youtube.com/watch?v=sample12', date: '2026-02-26', totalViews: 210500 },
  { title: 'Cyber Security Fundamentals 2026', imageUrl: 'https://picsum.photos/seed/cs13/300/200', videoUrl: 'https://youtube.com/watch?v=sample13', date: '2026-03-01', totalViews: 150000 },
  { title: 'Easy Homemade Italian Pizza Recipe', imageUrl: 'https://picsum.photos/seed/pz14/300/200', videoUrl: 'https://youtube.com/watch?v=sample14', date: '2026-03-05', totalViews: 420100 },
  { title: 'Learn React Native in 3 Hours', imageUrl: 'https://picsum.photos/seed/rn15/300/200', videoUrl: 'https://youtube.com/watch?v=sample15', date: '2026-03-08', totalViews: 98900 },
  { title: 'Financial Freedom and Budgeting Tips', imageUrl: 'https://picsum.photos/seed/mn16/300/200', videoUrl: 'https://youtube.com/watch?v=sample16', date: '2026-03-12', totalViews: 62300 },
  { title: 'Wildlife Documentary: Secrets of the Jungle', imageUrl: 'https://picsum.photos/seed/wf17/300/200', videoUrl: 'https://youtube.com/watch?v=sample17', date: '2026-03-15', totalViews: 830000 },
  { title: 'DIY Room Decor Ideas on a Budget', imageUrl: 'https://picsum.photos/seed/dc18/300/200', videoUrl: 'https://youtube.com/watch?v=sample18', date: '2026-03-18', totalViews: 145700 },
  { title: 'Electric Vehicles: The Future of Transport', imageUrl: 'https://picsum.photos/seed/ev19/300/200', videoUrl: 'https://youtube.com/watch?v=sample19', date: '2026-03-22', totalViews: 275000 },
  { title: 'Ambient Piano Music for Deep Focus', imageUrl: 'https://picsum.photos/seed/mu20/300/200', videoUrl: 'https://youtube.com/watch?v=sample20', date: '2026-03-25', totalViews: 615000 }
].map((content, index, contents) => ({
  ...content,
  seedKey: `starter-viral-link-${String(index + 1).padStart(2, '0')}`,
  date: new Date(`${content.date}T00:00:00.000Z`),
  requiredTaskCount: CONTENT_TASK_COUNT,
  isActive: true,
  isTrending: contents
    .slice()
    .sort((left, right) => right.totalViews - left.totalViews)
    .slice(0, 5)
    .includes(content)
}));

async function seed() {
  try {
    await connectDatabase();
    const operations = starterContents.map((content) => ({
      updateOne: {
        filter: { seedKey: content.seedKey },
        update: { $set: content },
        upsert: true
      }
    }));
    const result = await Content.bulkWrite(operations, { ordered: true, timestamps: false });
    const seededCount = await Content.countDocuments({ seedKey: { $in: starterContents.map((content) => content.seedKey) } });
    if (seededCount !== starterContents.length) {
      throw new Error(`Expected ${starterContents.length} seeded records, found ${seededCount}.`);
    }
    console.info(`Seed complete: ${seededCount} LinkHub content records available (${result.upsertedCount} inserted, ${result.modifiedCount} updated).`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error) => {
  console.error('Content seeding failed:', error);
  process.exitCode = 1;
});
