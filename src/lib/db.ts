import Database from 'better-sqlite3';
import path from 'path';

// Database instance singleton
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'data', 'racking.db');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(database: Database.Database): void {
  // Users table
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // User configurations
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Maintenance records
  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      component_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      technician TEXT,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add images column if it doesn't exist (for existing databases)
  try {
    database.exec(`ALTER TABLE maintenance_records ADD COLUMN images TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists, ignore error
  }

  // Component health
  database.exec(`
    CREATE TABLE IF NOT EXISTS component_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      component_id TEXT NOT NULL,
      health_status TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, component_id)
    )
  `);

  // User racks (multiple racks per user with position)
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_racks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, rack_id)
    )
  `);

  // Create indexes
  database.exec(`
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

export function createUser(email: string, passwordHash: string): User {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  const result = stmt.run(email, passwordHash);

  return {
    id: result.lastInsertRowid as number,
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  };
}

export function getUserByEmail(email: string): User | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  return stmt.get(email) as User | null;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id) as User | null;
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

export function getConfigByUserId(userId: number): DbConfig | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_configs WHERE user_id = ?');
  return stmt.get(userId) as DbConfig | null;
}

export function createDefaultConfig(userId: number): void {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO user_configs (user_id) VALUES (?)');
  stmt.run(userId);
}

export function updateConfig(userId: number, config: {
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
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO user_configs (
      user_id, bays, levels, bay_width, bay_depth, level_height,
      beam_color, frame_color, pallet_color, crossbar_color, wire_deck_color,
      show_wire_decks, show_pallets, pallet_fill, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      bays = excluded.bays,
      levels = excluded.levels,
      bay_width = excluded.bay_width,
      bay_depth = excluded.bay_depth,
      level_height = excluded.level_height,
      beam_color = excluded.beam_color,
      frame_color = excluded.frame_color,
      pallet_color = excluded.pallet_color,
      crossbar_color = excluded.crossbar_color,
      wire_deck_color = excluded.wire_deck_color,
      show_wire_decks = excluded.show_wire_decks,
      show_pallets = excluded.show_pallets,
      pallet_fill = excluded.pallet_fill,
      updated_at = datetime('now')
  `);
  stmt.run(
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
  );
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
  images: string; // JSON array of image paths
}

export function getMaintenanceRecordsByUserId(userId: number): DbMaintenanceRecord[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM maintenance_records WHERE user_id = ? ORDER BY timestamp DESC');
  return stmt.all(userId) as DbMaintenanceRecord[];
}

export function saveMaintenanceRecords(userId: number, records: Record<string, Array<{
  id: number;
  type: string;
  description: string;
  technician: string;
  status: string;
  timestamp: string;
  images?: string[];
}>>): void {
  const db = getDb();

  // Delete existing records for user
  const deleteStmt = db.prepare('DELETE FROM maintenance_records WHERE user_id = ?');

  // Insert new records
  const insertStmt = db.prepare(`
    INSERT INTO maintenance_records (user_id, component_id, type, description, technician, status, timestamp, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    deleteStmt.run(userId);
    for (const [componentId, componentRecords] of Object.entries(records)) {
      for (const record of componentRecords) {
        insertStmt.run(
          userId,
          componentId,
          record.type,
          record.description,
          record.technician || null,
          record.status,
          record.timestamp,
          JSON.stringify(record.images || [])
        );
      }
    }
  });

  transaction();
}

// Component health operations
export interface DbComponentHealth {
  id: number;
  user_id: number;
  component_id: string;
  health_status: string;
}

export function getComponentHealthByUserId(userId: number): DbComponentHealth[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM component_health WHERE user_id = ?');
  return stmt.all(userId) as DbComponentHealth[];
}

export function saveComponentHealth(userId: number, health: Record<string, string>): void {
  const db = getDb();

  // Delete existing health records for user
  const deleteStmt = db.prepare('DELETE FROM component_health WHERE user_id = ?');

  // Insert new health records
  const insertStmt = db.prepare(`
    INSERT INTO component_health (user_id, component_id, health_status, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  const transaction = db.transaction(() => {
    deleteStmt.run(userId);
    for (const [componentId, healthStatus] of Object.entries(health)) {
      insertStmt.run(userId, componentId, healthStatus);
    }
  });

  transaction();
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

export function getRacksByUserId(userId: number): RackData[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM user_racks WHERE user_id = ?');
  const rows = stmt.all(userId) as DbRack[];

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

export function saveRacks(userId: number, racks: RackData[]): void {
  const db = getDb();

  // Delete existing racks for user
  const deleteStmt = db.prepare('DELETE FROM user_racks WHERE user_id = ?');

  // Insert new racks
  const insertStmt = db.prepare(`
    INSERT INTO user_racks (
      user_id, rack_id, name, position_x, position_z, rotation,
      bays, levels, bay_width, bay_depth, level_height,
      beam_color, frame_color, pallet_color, crossbar_color, wire_deck_color,
      show_wire_decks, show_pallets, pallet_fill
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    deleteStmt.run(userId);
    for (const rack of racks) {
      insertStmt.run(
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
      );
    }
  });

  transaction();
}
