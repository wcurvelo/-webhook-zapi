// Migration script: SQLite → PostgreSQL
// Usage: node migrate-sqlite-postgres.js

const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const DB_PATH = './clientes.db';
const POSTGRES_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/wdespachante';

async function migrate() {
  console.log('🔄 Migrando SQLite → PostgreSQL...');
  
  // Connect to PostgreSQL
  const pgPool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
  
  // Read from SQLite
  const db = new sqlite3.Database(DB_PATH);
  
  try {
    // Create tables in PostgreSQL
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        text TEXT,
        category TEXT,
        is_client BOOLEAN DEFAULT true,
        deepseek_response TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orcamentos (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        cliente TEXT,
        veiculo TEXT,
        placa TEXT,
        servico TEXT,
        honorario REAL,
        taxa_detran REAL,
        total REAL,
        status TEXT DEFAULT 'gerado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS documentos (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        message_id TEXT,
        tipo TEXT,
        mime_type TEXT,
        file_name TEXT,
        file_path TEXT,
        file_size INTEGER,
        file_hash TEXT,
        drive_url TEXT,
        status TEXT DEFAULT 'recebido',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabelas criadas no PostgreSQL');
    
    // Migrate mensagens
    db.all('SELECT * FROM mensagens', async (err, rows) => {
      if (err) return console.error(err);
      for (const row of rows) {
        await pgPool.query(
          'INSERT INTO mensagens (phone, text, category, is_client, deepseek_response, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [row.phone, row.text, row.category, row.is_client, row.gemini_response || row.deepseek_response, row.created_at]
        );
      }
      console.log(`✅ ${rows.length} mensagens migradas`);
    });
    
    // Migrate orcamentos
    db.all('SELECT * FROM orcamentos', async (err, rows) => {
      if (err) return console.error(err);
      for (const row of rows) {
        await pgPool.query(
          'INSERT INTO orcamentos (phone, cliente, veiculo, placa, servico, honorario, taxa_detran, total, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [row.phone, row.cliente, row.veiculo, row.placa, row.servico, row.honorario, row.taxa_detran, row.total, row.status, row.created_at]
        );
      }
      console.log(`✅ ${rows.length} orçamentos migrados`);
    });
    
    // Migrate documentos
    db.all('SELECT * FROM documentos', async (err, rows) => {
      if (err) return console.error(err);
      for (const row of rows) {
        await pgPool.query(
          'INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, drive_url, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          [row.phone, row.message_id, row.tipo, row.mime_type, row.file_name, row.file_path, row.file_size, row.file_hash, row.drive_url, row.status, row.created_at]
        );
      }
      console.log(`✅ ${rows.length} documentos migrados`);
    });
    
    console.log('🎉 Migração completa!');
  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    await pgPool.end();
    db.close();
  }
}

migrate();
