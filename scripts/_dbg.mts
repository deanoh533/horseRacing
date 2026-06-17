import 'dotenv/config';
import { getLocalDb } from './src/db/localDb.js';
import { predictRace } from './src/engine/scorePredictor.js';
const db = await getLocalDb();
try {
  await predictRace(db, 20260606, 1, 1);
} catch(e) {
  console.error(e.stack);
}
