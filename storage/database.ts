import * as SQLite from 'expo-sqlite';
import { createRepository } from './repository';

export const repository = createRepository(() => SQLite.openDatabaseAsync('trekipelago.db'));
