import { Pool } from 'pg';

// Database connection pool singleton
let pool: Pool | null = null;
let initialized = false;

export function getPool(): Pool {
  if (!pool) {
    let connectionString = process.env.DATABASE_URL || '';

    // Check if SSL is required, then remove sslmode from URL to avoid conflicts
    const requiresSsl = connectionString.includes('sslmode=require') ||
                        connectionString.includes('sslmode=prefer');

    // Remove sslmode parameter from connection string to handle it manually
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
    // Clean up any leftover ? at the end
    connectionString = connectionString.replace(/\?$/, '');

    pool = new Pool({
      connectionString,
      ssl: requiresSsl ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

// Ensure database is initialized (call this before any database operation)
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initializeDatabase();
    initialized = true;
  }
}

export async function initializeDatabase(): Promise<void> {
  const pool = getPool();

  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // User configurations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      bays INTEGER DEFAULT 3,
      levels INTEGER DEFAULT 4,
      bay_width REAL DEFAULT 2.7,
      bay_depth REAL DEFAULT 1.2,
      level_height REAL DEFAULT 1.5,
      beam_color TEXT DEFAULT '#ff6b00',
      frame_color TEXT DEFAULT '#4a90d9',
      pallet_color TEXT DEFAULT '#c4a574',
      crossbar_color TEXT DEFAULT '#ff9500',
      wire_deck_color TEXT DEFAULT '#666666',
      show_wire_decks INTEGER DEFAULT 1,
      show_pallets INTEGER DEFAULT 0,
      pallet_fill INTEGER DEFAULT 70,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Maintenance records
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      component_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      technician TEXT,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Component health
  await pool.query(`
    CREATE TABLE IF NOT EXISTS component_health (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      component_id TEXT NOT NULL,
      health_status TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, component_id)
    )
  `);

  // User racks (multiple racks per user with position)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_racks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      rack_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_x REAL DEFAULT 0,
      position_z REAL DEFAULT 0,
      rotation REAL DEFAULT 0,
      bays INTEGER DEFAULT 3,
      levels INTEGER DEFAULT 4,
      bay_width REAL DEFAULT 2.7,
      bay_depth REAL DEFAULT 1.2,
      level_height REAL DEFAULT 1.5,
      beam_color TEXT DEFAULT '#ff6b00',
      frame_color TEXT DEFAULT '#4a90d9',
      pallet_color TEXT DEFAULT '#c4a574',
      crossbar_color TEXT DEFAULT '#ff9500',
      wire_deck_color TEXT DEFAULT '#666666',
      show_wire_decks INTEGER DEFAULT 1,
      show_pallets INTEGER DEFAULT 0,
      pallet_fill INTEGER DEFAULT 70,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, rack_id)
    )
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_maintenance_user ON maintenance_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_component ON maintenance_records(user_id, component_id);
    CREATE INDEX IF NOT EXISTS idx_health_user ON component_health(user_id);
    CREATE INDEX IF NOT EXISTS idx_racks_user ON user_racks(user_id);
  `);
}

// User operations
export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
    [email, passwordHash]
  );
  return result.rows[0];
}

export async function getUserByEmail(email: string): Promise<User | null> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

export async function getUserById(id: number): Promise<User | null> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Config operations
export interface DbConfig {
  id: number;
  user_id: number;
  bays: number;
  levels: number;
  bay_width: number;
  bay_depth: number;
  level_height: number;
  beam_color: string;
  frame_color: string;
  pallet_color: string;
  crossbar_color: string;
  wire_deck_color: string;
  show_wire_decks: number;
  show_pallets: number;
  pallet_fill: number;
}

export async function getConfigByUserId(userId: number): Promise<DbConfig | null> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query('SELECT * FROM user_configs WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

export async function createDefaultConfig(userId: number): Promise<void> {
  await ensureInitialized();
  const pool = getPool();
  await pool.query('INSERT INTO user_configs (user_id) VALUES ($1)', [userId]);
}

export async function updateConfig(userId: number, config: {
  bays: number;
  levels: number;
  bayWidth: number;
  bayDepth: number;
  levelHeight: number;
  beamColor: string;
  frameColor: string;
  palletColor: string;
  crossbarColor: string;
  wireDeckColor: string;
  showWireDecks: boolean;
  showPallets: boolean;
  palletFill: number;
}): Promise<void> {
  await ensureInitialized();
  const pool = getPool();
  await pool.query(`
    INSERT INTO user_configs (
      user_id, bays, levels, bay_width, bay_depth, level_height,
      beam_color, frame_color, pallet_color, crossbar_color, wire_deck_color,
      show_wire_decks, show_pallets, pallet_fill, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT(user_id) DO UPDATE SET
      bays = EXCLUDED.bays,
      levels = EXCLUDED.levels,
      bay_width = EXCLUDED.bay_width,
      bay_depth = EXCLUDED.bay_depth,
      level_height = EXCLUDED.level_height,
      beam_color = EXCLUDED.beam_color,
      frame_color = EXCLUDED.frame_color,
      pallet_color = EXCLUDED.pallet_color,
      crossbar_color = EXCLUDED.crossbar_color,
      wire_deck_color = EXCLUDED.wire_deck_color,
      show_wire_decks = EXCLUDED.show_wire_decks,
      show_pallets = EXCLUDED.show_pallets,
      pallet_fill = EXCLUDED.pallet_fill,
      updated_at = NOW()
  `, [
    userId,
    config.bays,
    config.levels,
    config.bayWidth,
    config.bayDepth,
    config.levelHeight,
    config.beamColor,
    config.frameColor,
    config.palletColor,
    config.crossbarColor,
    config.wireDeckColor,
    config.showWireDecks ? 1 : 0,
    config.showPallets ? 1 : 0,
    config.palletFill
  ]);
}

// Maintenance records operations
export interface DbMaintenanceRecord {
  id: number;
  user_id: number;
  component_id: string;
  type: string;
  description: string;
  technician: string | null;
  status: string;
  timestamp: string;
  images: string;
}

export async function getMaintenanceRecordsByUserId(userId: number): Promise<DbMaintenanceRecord[]> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query(
    'SELECT * FROM maintenance_records WHERE user_id = $1 ORDER BY timestamp DESC',
    [userId]
  );
  return result.rows;
}

export async function saveMaintenanceRecords(userId: number, records: Record<string, Array<{
  id: number;
  type: string;
  description: string;
  technician: string;
  status: string;
  timestamp: string;
  images?: string[];
}>>): Promise<void> {
  await ensureInitialized();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing records for user
    await client.query('DELETE FROM maintenance_records WHERE user_id = $1', [userId]);

    // Insert new records
    for (const [componentId, componentRecords] of Object.entries(records)) {
      for (const record of componentRecords) {
        await client.query(`
          INSERT INTO maintenance_records (user_id, component_id, type, description, technician, status, timestamp, images)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          userId,
          componentId,
          record.type,
          record.description,
          record.technician || null,
          record.status,
          record.timestamp,
          JSON.stringify(record.images || [])
        ]);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Component health operations
export interface DbComponentHealth {
  id: number;
  user_id: number;
  component_id: string;
  health_status: string;
}

export async function getComponentHealthByUserId(userId: number): Promise<DbComponentHealth[]> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query('SELECT * FROM component_health WHERE user_id = $1', [userId]);
  return result.rows;
}

export async function saveComponentHealth(userId: number, health: Record<string, string>): Promise<void> {
  await ensureInitialized();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing health records for user
    await client.query('DELETE FROM component_health WHERE user_id = $1', [userId]);

    // Insert new health records
    for (const [componentId, healthStatus] of Object.entries(health)) {
      await client.query(`
        INSERT INTO component_health (user_id, component_id, health_status, updated_at)
        VALUES ($1, $2, $3, NOW())
      `, [userId, componentId, healthStatus]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Rack operations
export interface DbRack {
  id: number;
  user_id: number;
  rack_id: string;
  name: string;
  position_x: number;
  position_z: number;
  rotation: number;
  bays: number;
  levels: number;
  bay_width: number;
  bay_depth: number;
  level_height: number;
  beam_color: string;
  frame_color: string;
  pallet_color: string;
  crossbar_color: string;
  wire_deck_color: string;
  show_wire_decks: number;
  show_pallets: number;
  pallet_fill: number;
}

export interface RackData {
  id: string;
  name: string;
  position: { x: number; z: number };
  rotation: number;
  config: {
    bays: number;
    levels: number;
    bayWidth: number;
    bayDepth: number;
    levelHeight: number;
    beamColor: string;
    frameColor: string;
    palletColor: string;
    crossbarColor: string;
    wireDeckColor: string;
    showWireDecks: boolean;
    showPallets: boolean;
    palletFill: number;
  };
}

export async function getRacksByUserId(userId: number): Promise<RackData[]> {
  await ensureInitialized();
  const pool = getPool();
  const result = await pool.query('SELECT * FROM user_racks WHERE user_id = $1', [userId]);
  const rows = result.rows as DbRack[];

  return rows.map((row) => ({
    id: row.rack_id,
    name: row.name,
    position: { x: row.position_x, z: row.position_z },
    rotation: row.rotation,
    config: {
      bays: row.bays,
      levels: row.levels,
      bayWidth: row.bay_width,
      bayDepth: row.bay_depth,
      levelHeight: row.level_height,
      beamColor: row.beam_color,
      frameColor: row.frame_color,
      palletColor: row.pallet_color,
      crossbarColor: row.crossbar_color,
      wireDeckColor: row.wire_deck_color,
      showWireDecks: row.show_wire_decks === 1,
      showPallets: row.show_pallets === 1,
      palletFill: row.pallet_fill,
    },
  }));
}

export async function saveRacks(userId: number, racks: RackData[]): Promise<void> {
  await ensureInitialized();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete existing racks for user
    await client.query('DELETE FROM user_racks WHERE user_id = $1', [userId]);

    // Insert new racks
    for (const rack of racks) {
      await client.query(`
        INSERT INTO user_racks (
          user_id, rack_id, name, position_x, position_z, rotation,
          bays, levels, bay_width, bay_depth, level_height,
          beam_color, frame_color, pallet_color, crossbar_color, wire_deck_color,
          show_wire_decks, show_pallets, pallet_fill
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        userId,
        rack.id,
        rack.name,
        rack.position.x,
        rack.position.z,
        rack.rotation,
        rack.config.bays,
        rack.config.levels,
        rack.config.bayWidth,
        rack.config.bayDepth,
        rack.config.levelHeight,
        rack.config.beamColor,
        rack.config.frameColor,
        rack.config.palletColor,
        rack.config.crossbarColor,
        rack.config.wireDeckColor,
        rack.config.showWireDecks ? 1 : 0,
        rack.config.showPallets ? 1 : 0,
        rack.config.palletFill
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
