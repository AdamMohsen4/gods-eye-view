/** Create the official maps and fixture locations in the local database (server stopped). */
import { openDb } from '@earthnow/db';
import { seedFixtures } from '../seed.ts';

const h = await openDb();
await seedFixtures(h.db);
await h.close();
console.log('seeded fixture locations');
