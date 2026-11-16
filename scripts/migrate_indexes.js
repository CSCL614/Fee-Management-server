require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/college_fee_mgmt');
    console.log('Connected to MongoDB');
    const coll = mongoose.connection.db.collection('academicyears');
    const indexes = await coll.indexes();
    console.log('Current indexes:', indexes.map(i => i.name));
    
    const hasYearIndex = indexes.some(i => i.name === 'year_1');
    if (hasYearIndex) {
      console.log('Dropping old year_1 index...');
      await coll.dropIndex('year_1');
      console.log('Dropped year_1 index successfully.');
    }
    
    const updateRes = await coll.updateMany(
      { course: { $exists: false } },
      { $set: { course: 'All', studyYear: 'All' } }
    );
    console.log(`Updated legacy records with default course and studyYear: ${updateRes.modifiedCount}`);
    
    // Ensure new compound index
    await coll.createIndex({ year: 1, course: 1, studyYear: 1 }, { unique: true });
    await coll.createIndex({ course: 1, studyYear: 1 });
    await coll.createIndex({ status: 1 });
    
    console.log('Synced new indexes:', (await coll.indexes()).map(i => i.name));
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await mongoose.connection.close();
  }
}

run();
