require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Crew = require('../models/Crew');
const Counter = require('../models/Counter');

async function ensurePartialUniqueIndex() {
  try {
    // Drop a strict unique index if it exists to avoid duplicate-null issues
    const indexes = await Crew.collection.indexes();
    const idx = indexes.find(i => i.name === 'crewId_1' && i.unique && !i.partialFilterExpression);
    if (idx) {
      console.log('⚠️ Dropping old unique index crewId_1 (no partial filter)');
      await Crew.collection.dropIndex('crewId_1');
    }
  } catch (e) {
    // ignore if index doesn't exist
  }

  // Create partial unique index for crewId
  try {
    await Crew.collection.createIndex(
      { crewId: 1 },
      { unique: true, partialFilterExpression: { crewId: { $exists: true, $type: 'string', $ne: '' } } }
    );
    console.log('✅ Ensured partial unique index on crewId');
  } catch (e) {
    console.log('ℹ️ Index creation skipped/exists:', e.message);
  }
}

async function nextCrewId() {
  let doc = await Counter.findOneAndUpdate({ name: 'crewId' }, { $inc: { seq: 1 } }, { new: true });
  if (!doc) {
    await Counter.create({ name: 'crewId', seq: 0 });
    doc = await Counter.findOneAndUpdate({ name: 'crewId' }, { $inc: { seq: 1 } }, { new: true });
  }
  return `DTC-C${String(doc.seq).padStart(3, '0')}`;
}

async function run() {
  await connectDB();

  // Ensure the correct index is set up
  await ensurePartialUniqueIndex();

  // Backfill any crew missing crewId
  const filter = { $or: [{ crewId: { $exists: false } }, { crewId: null }, { crewId: '' }] };
  const docs = await Crew.find(filter);
  console.log(`Found ${docs.length} crew without crewId. Backfilling...`);

  for (const c of docs) {
    c.crewId = await nextCrewId();
    await c.save();
    console.log(` -> ${c.name} => ${c.crewId}`);
  }

  await mongoose.connection.close();
  console.log('✅ Backfill done');
}

run().catch(e => { console.error('❌ Backfill error:', e); process.exit(1); });