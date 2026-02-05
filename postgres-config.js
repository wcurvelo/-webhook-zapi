// PostgreSQL Configuration for WDespachante
// Run on Render with PostgreSQL service

const { Pool } = require('pg');

// Get from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/wdespachante',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
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

      CREATE INDEX IF NOT EXISTS idx_mensagens_phone ON mensagens(phone);
      CREATE INDEX IF NOT EXISTS idx_mensagens_created ON mensagens(created_at);
      CREATE INDEX IF NOT EXISTS idx_documentos_phone ON documentos(phone);
    `);
    
    console.log('✅ PostgreSQL tables created!');
    return true;
  } catch (e) {
    console.error('Erro ao criar tabelas:', e.message);
    return false;
  } finally {
    client.release();
  }
}

module.exports = { pool, createTables };
