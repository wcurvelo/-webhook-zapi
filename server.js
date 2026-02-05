// server-wdespachante.js - Webhook Z-API + DeepSeek + Google Drive + PostgreSQL

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleDriveManager, detectDocumentType } = require('./google-drive');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== POSTGRESQL ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/wdespachante',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Criar tabelas no PostgreSQL
async function initDB() {
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
    console.log('✅ PostgreSQL tables created/verified');
  } catch (e) {
    console.error('Erro DB:', e.message);
  } finally {
    client.release();
  }
}

initDB();

// ==================== GOOGLE DRIVE ====================
const driveManager = new GoogleDriveManager();

// ==================== DEEPSEEK V3.2 ====================
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';

// ==================== REGRAS WDESPACHANTE ====================
const WDESPACHANTE = {
  nome: 'WDespachante',
  endereco: 'Av. Treze de Maio, 23 - Centro, Rio de Janeiro',
  whatsapp: '(21) 96447-4147',
  experiencia: '18 anos',
  honorarios: {
    'transferencia': 450.00,
    'licenciamento_simples': 150.00,
    'licenciamento_debitos': 250.00,
    'segunda_via_crv': 450.00,
    'baixa_gravame': 450.00,
    'comunicacao_venda': 350.00
  },
  taxas_detran: { '014-0': 209.78, '018-3': 233.09, '037-0': 250.95 },
  payment: { pix: '19869629000109', parcelamento: 'https://www.infinitepay.io/' }
};

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '100mb' }));
app.use('/uploads', express.static('./uploads'));

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ==================== APIs ====================
app.get('/api/mensagens', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mensagens ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orcamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM documentos ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/precos', (req, res) => {
  res.json({ honorarios: WDESPACHANTE.honorarios, taxas: WDESPACHANTE.taxas_detran });
});

app.get('/stats', async (req, res) => {
  try {
    const [m, o, d, f] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM mensagens'),
      pool.query('SELECT COUNT(*) as c FROM orcamentos'),
      pool.query('SELECT COUNT(*) as c FROM documentos'),
      pool.query('SELECT SUM(total) as s FROM orcamentos')
    ]);
    res.json({ messages: parseInt(m.rows[0].c), budgets: parseInt(o.rows[0].c), docs: parseInt(d.rows[0].c), faturamento: parseFloat(f.rows[0].s) || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orcamento', async (req, res) => {
  const { phone, cliente, veiculo, placa, servico } = req.body;
  const honorario = WDESPACHANTE.honorarios[servico] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  try {
    const result = await pool.query('INSERT INTO orcamentos (phone, cliente, veiculo, placa, servico, honorario, taxa_detran, total, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [phone, cliente, veiculo, placa, servico, honorario, taxa, honorario + taxa, 'gerado']);
    res.json({ id: result.rows[0].id, honorario, taxa, total: honorario + taxa, prazo: '5-7 dias úteis', pix: WDESPACHANTE.payment.pix });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== WEBHOOK ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'wdespachante-v2.1-postgres', version: '2.1.0', drive_configured: driveManager.isConfigured(), db: 'postgresql' });
  } catch (e) { res.status(500).json({ status: 'unhealthy', error: e.message }); }
});

app.post('/test', async (req, res) => {
  await processMessage({ phone: '5511999999999', text: { message: req.body.text || 'Teste' }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent' });
});

// ==================== PROCESSAMENTO ====================
async function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const messageType = payload.type || payload.message?.type || 'text';
  const messageId = payload.messageId || crypto.randomUUID();
  
  console.log('[' + phone + '] Tipo: ' + messageType);
  
  if (['image', 'document', 'audio', 'video'].includes(messageType)) {
    await processDocument(payload, phone, messageType, messageId);
    return;
  }
  
  const text = payload.text?.message || payload.message?.text || '';
  if (payload.isGroup) return;
  
  const cat = classifyMessage(text);
  
  try {
    const result = await pool.query('INSERT INTO mensagens (phone, text, category, is_client) VALUES ($1, $2, $3, $4) RETURNING id',
      [phone, text, cat, true]);
    console.log('MSG #' + result.rows[0].id + ': ' + cat);
  } catch (e) { console.error(e); }
}

async function processDocument(payload, phone, docType, messageId) {
  let fileUrl = null, fileName = 'arquivo', mimeType = 'application/octet-stream';
  if (payload.message?.mediaUrl) fileUrl = payload.message.mediaUrl;
  if (payload.message?.fileName) fileName = payload.message.fileName;
  if (payload.message?.mimeType) mimeType = payload.message.mimeType;
  
  const docCategory = detectDocumentType(fileName, mimeType);
  console.log('📎 Documento: ' + fileName + ' → ' + docCategory);
  
  let content = null, filePath = null, fileSize = 0, fileHash = null, driveUrl = null;
  
  if (fileUrl) {
    try {
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
      content = Buffer.from(response.data);
      fileSize = content.length;
      fileHash = crypto.createHash('md5').update(content).digest('hex');
      const tempPath = '/tmp/' + crypto.randomUUID() + path.extname(fileName);
      fs.writeFileSync(tempPath, content);
      filePath = tempPath;
    } catch (e) { console.error('Download error:', e.message); }
  }
  
  const result = await driveManager.uploadFile(filePath, fileName, phone, docCategory);
  if (result.success) driveUrl = result.drive_url || result.local_path;
  
  try {
    await pool.query('INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, drive_url, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [phone, messageId, docType, mimeType, fileName, filePath || result.local_path, fileSize, fileHash, driveUrl, 'recebido']);
    console.log('💾 Documento salvo no PostgreSQL');
  } catch (e) { console.error('Erro ao salvar documento:', e.message); }
}

function classifyMessage(text) {
  const lower = text.toLowerCase();
  if (lower.includes('transfer') || lower.includes('compr')) return 'transferencia';
  if (lower.includes('ipva') || lower.includes('licenci')) return 'licenciamento';
  if (lower.includes('multa')) return 'multas';
  if (lower.includes('crlv') || lower.includes('documento')) return 'crlv';
  return 'consulta';
}

// ==================== INICIAR ====================
app.listen(PORT, () => {
  console.log('WDespachante v2.1 + PostgreSQL rodando na porta ' + PORT);
  console.log('Database: PostgreSQL (persistente!)');
  console.log('Google Drive: ' + (driveManager.isConfigured() ? 'Ativo' : 'Inativo'));
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => pool.query('SELECT 1').catch(() => {}), 5 * 60 * 1000);
}

module.exports = { app, pool };
