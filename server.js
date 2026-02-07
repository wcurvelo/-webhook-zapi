// server.js - WDespachante v3.0
// Webhook Z-API + Gemini Vision + Google Drive + Dashboard Treinamento

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARES ====================
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('./uploads'));

// ==================== POSTGRESQL ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:5432/${process.env.DB_NAME}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL:', err.stack);
  } else {
    console.log('✅ Conectado ao PostgreSQL com sucesso!');
    release();
  }
});

// ==================== GEMINI 2.0 FLASH VISION ====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash-001';

async function analyzeWithGemini(imageBuffer, mimeType, fileName) {
  if (!GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY não configurada');
    return { error: 'API key não configurada', tipo: detectDocumentType(fileName, mimeType) };
  }
  
  try {
    const base64 = imageBuffer.toString('base64');
    const prompt = `Você é Wellington, dono do WDespachante (18 anos de experiência, RJ).

Analise este documento e extraia:

1. **Tipo de documento** (CRLV, CNH, RG, CPF, Comprovante, Contrato, Multa, etc.)
2. **Dados extraídos** (nome, CPF, placa, Renavam, validade, etc.)
3. **Status** (legível, ilegível, incompleto)
4. **Próximos passos** (o que o cliente precisa enviar/fazer)
5. **Serviço relacionado** (transferência, licenciamento, recurso de multa, etc.)

Responda em JSON:
{
  "tipo": "crlv",
  "dados": {"placa": "ABC1234", "renavam": "123456789", "proprietario": "João Silva"},
  "status": "legivel",
  "proximo_passo": "Solicitar CRLV verso ou CNH do comprador",
  "servico": "transferencia",
  "confianca": 0.95
}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1000 }
      },
      { timeout: 30000 }
    );

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch (e) {}
    }
    return { raw: text, tipo: detectDocumentType(fileName, mimeType) };
  } catch (e) {
    console.error('Gemini Error:', e.message);
    return { error: e.message, tipo: detectDocumentType(fileName, mimeType) };
  }
}

function detectDocumentType(fileName, mimeType) {
  const lower = (fileName || '').toLowerCase();
  if (lower.includes('crlv')) return 'crlv';
  if (lower.includes('cnh')) return 'cnh';
  if (lower.includes('rg')) return 'rg';
  if (lower.includes('cpf')) return 'cpf';
  if (lower.includes('multa')) return 'multa';
  if (lower.includes('comp') || lower.includes('residencia')) return 'comprovante';
  if (mimeType && mimeType.startsWith('image/')) return 'imagem';
  if (mimeType && mimeType.includes('pdf')) return 'pdf';
  if (mimeType && mimeType.includes('audio')) return 'audio';
  return 'documento';
}

// ==================== GOOGLE DRIVE (Organizado por Cliente) ====================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

let driveAccessToken = null;
let driveTokenExpiry = null;

function loadDriveToken() {
  if (fs.existsSync('./drive-token.json')) {
    try {
      const t = JSON.parse(fs.readFileSync('./drive-token.json', 'utf8'));
      driveAccessToken = t.access_token;
      driveTokenExpiry = t.expiry;
      return true;
    } catch (e) {}
  }
  return false;
}
loadDriveToken();

function isDriveConfigured() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && driveAccessToken);
}

async function getOrCreateClientFolder(phone) {
  if (!isDriveConfigured()) return null;
  
  try {
    // Buscar pasta do cliente
    const q = `name='${phone}' and mimeType='application/vnd.google-apps.folder' and '${GOOGLE_DRIVE_FOLDER_ID}' in parents`;
    const search = await axios.get(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${driveAccessToken}` } }
    );
    
    if (search.data.files?.length > 0) {
      return search.data.files[0].id;
    }
    
    // Criar pasta do cliente
    const create = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      { name: phone, mimeType: 'application/vnd.google-apps.folder', parents: [GOOGLE_DRIVE_FOLDER_ID] },
      { headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': 'application/json' } }
    );
    
    console.log(`📁 Pasta criada: ${phone}`);
    return create.data.id;
  } catch (e) {
    console.error('Erro ao criar pasta:', e.message);
    return null;
  }
}

async function uploadToDrive(filePath, fileName, phone, docType) {
  if (!isDriveConfigured() || !filePath || !fs.existsSync(filePath)) {
    // Salvar localmente como fallback
    const localDir = `./uploads/${phone}`;
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    const localPath = `${localDir}/${Date.now()}_${docType}_${fileName}`;
    fs.copyFileSync(filePath, localPath);
    return { success: true, local_path: localPath };
  }
  
  try {
    const clientFolderId = await getOrCreateClientFolder(phone);
    if (!clientFolderId) throw new Error('Não foi possível criar pasta do cliente');
    
    const content = fs.readFileSync(filePath);
    const structuredName = `${new Date().toISOString().split('T')[0]}_${docType}_${fileName}`;
    
    // Upload multipart
    const boundary = '-------314159265358979323846';
    const metadata = JSON.stringify({ name: structuredName, parents: [clientFolderId] });
    
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    
    const upload = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      body,
      { headers: { 
        Authorization: `Bearer ${driveAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      }}
    );
    
    const url = `https://drive.google.com/file/d/${upload.data.id}/view`;
    console.log('✅ Drive:', url);
    return { success: true, drive_url: url };
  } catch (e) {
    console.error('Erro upload Drive:', e.message);
    // Fallback local
    const localDir = `./uploads/${phone}`;
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    const localPath = `${localDir}/${Date.now()}_${docType}_${fileName}`;
    fs.copyFileSync(filePath, localPath);
    return { success: true, local_path: localPath };
  }
}

// ==================== DATABASE INITIALIZATION ====================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        text TEXT,
        category VARCHAR(50),
        is_client BOOLEAN DEFAULT true,
        deepseek_response TEXT,
        gemini_analysis TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS mensagens_treinadas (
        id SERIAL PRIMARY KEY,
        mensagem_id INTEGER,
        phone VARCHAR(50),
        mensagem_cliente TEXT NOT NULL,
        resposta_ia TEXT NOT NULL,
        resposta_corrigida TEXT,
        tipo VARCHAR(20) CHECK (tipo IN ('aprovada', 'corrigida')),
        service VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS documentos (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50),
        message_id TEXT,
        tipo VARCHAR(50),
        mime_type VARCHAR(100),
        file_name TEXT,
        file_path TEXT,
        file_size INTEGER,
        file_hash TEXT,
        drive_url TEXT,
        gemini_analysis TEXT,
        status VARCHAR(50) DEFAULT 'recebido',
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_mensagens_phone ON mensagens(phone);
      CREATE INDEX IF NOT EXISTS idx_documentos_phone ON documentos(phone);
      
      -- Add gemini_analysis column if not exists
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documentos' AND column_name='gemini_analysis') THEN
          ALTER TABLE documentos ADD COLUMN gemini_analysis TEXT;
        END IF;
      END $$;
    `);
    console.log('✅ Tabelas criadas/verificadas!');
  } catch (e) {
    console.error('Erro ao criar tabelas:', e.message);
  } finally {
    client.release();
  }
}

// ==================== WEBHOOK Z-API ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

async function processMessage(payload) {
  const phone = payload.phone || payload.sender?.phone || 'unknown';
  
  // Ignorar grupos
  if (payload.isGroup || payload.is_group || phone.includes('@g.us') || phone.includes('-group')) {
    console.log('Grupo, ignorando');
    return;
  }
  
  // Detectar tipo de mídia
  let docType = null;
  let fileUrl = null;
  
  if (payload.photo) {
    docType = 'image';
    fileUrl = payload.photo;
  } else if (payload.video) {
    docType = 'video';
    fileUrl = payload.video;
  } else if (payload.document) {
    docType = 'document';
    fileUrl = payload.document.url || payload.document;
  } else if (payload.audio) {
    docType = 'audio';
    fileUrl = payload.audio;
  }
  
  // Processar documento/mídia
  if (docType && fileUrl) {
    console.log(`📎 [${phone}] Detectado: ${docType}`);
    await processDocument(payload, phone, docType, fileUrl);
    return;
  }
  
  // Fallback: verificar payload.type antigo
  const messageType = payload.type || payload.message?.type || 'text';
  if (['image', 'document', 'audio', 'video'].includes(messageType)) {
    const msg = payload.message || payload;
    const url = msg.mediaUrl || msg.content?.mediaUrl || null;
    if (url) {
      await processDocument(payload, phone, messageType, url);
      return;
    }
  }
  
  // Processar mensagem de texto
  const text = payload.text?.message?.message || payload.text?.message || payload.text || '';
  console.log(`💬 [${phone}] ${text.substring(0, 50)}`);
  
  const category = classifyMessage(text);
  
  try {
    const result = await pool.query(
      'INSERT INTO mensagens (phone, text, category, is_client) VALUES ($1, $2, $3, $4) RETURNING id',
      [phone, text, category, true]
    );
    console.log(`✅ MSG #${result.rows[0].id}: ${category}`);
  } catch (e) {
    console.error('Erro ao salvar mensagem:', e.message);
  }
}

async function processDocument(payload, phone, docType, fileUrl) {
  const msg = payload.message || payload;
  let fileName = msg.fileName || msg.mediaName || payload.document?.fileName || `arquivo_${Date.now()}`;
  let mimeType = msg.mimeType || msg.content?.mimeType || payload.document?.mimeType || 'application/octet-stream';
  
  // Detectar mimeType pelo tipo
  if (mimeType === 'application/octet-stream') {
    if (docType === 'image') mimeType = 'image/jpeg';
    else if (docType === 'video') mimeType = 'video/mp4';
    else if (docType === 'audio') mimeType = 'audio/ogg';
    else if (docType === 'document') mimeType = 'application/pdf';
  }
  
  console.log(`📎 Documento - phone: ${phone} type: ${docType} url: ${fileUrl ? 'SIM' : 'NÃO'}`);
  
  let content = null, filePath = null, fileSize = 0, fileHash = null, driveUrl = null, geminiAnalysis = null;
  
  // Download
  if (fileUrl) {
    try {
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
      content = Buffer.from(response.data);
      fileSize = content.length;
      fileHash = crypto.createHash('md5').update(content).digest('hex');
      filePath = '/tmp/' + crypto.randomUUID() + path.extname(fileName);
      fs.writeFileSync(filePath, content);
      console.log(`⬇️ Baixado: ${(fileSize / 1024).toFixed(1)}KB`);
    } catch (e) {
      console.error('Download error:', e.message);
    }
  }
  
  // Upload para Google Drive (pasta do cliente)
  const docCategory = detectDocumentType(fileName, mimeType);
  const driveResult = await uploadToDrive(filePath, fileName, phone, docCategory);
  if (driveResult.success) driveUrl = driveResult.drive_url || driveResult.local_path;
  
  // Análise com Gemini Vision (imagem ou PDF)
  if (content && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
    console.log('🔍 Analisando com Gemini 2.0 Flash Vision...');
    geminiAnalysis = await analyzeWithGemini(content, mimeType, fileName);
    console.log('✅ Gemini:', JSON.stringify(geminiAnalysis).substring(0, 100));
  }
  
  // Salvar no PostgreSQL
  try {
    await pool.query(
      `INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, drive_url, gemini_analysis, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [phone, msg.id || crypto.randomUUID(), docType, mimeType, fileName, filePath, fileSize, fileHash, driveUrl, JSON.stringify(geminiAnalysis), 'analisado']
    );
    console.log('💾 Documento salvo no PostgreSQL');
  } catch (e) {
    console.error('Erro ao salvar documento:', e.message);
  }
}

function classifyMessage(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('transfer') || lower.includes('compr') || lower.includes('vend')) return 'transferencia';
  if (lower.includes('ipva') || lower.includes('licenci')) return 'licenciamento';
  if (lower.includes('multa') || lower.includes('recurso')) return 'multas';
  if (lower.includes('crlv') || lower.includes('documento')) return 'crlv';
  if (lower.includes('cnh') || lower.includes('carteira')) return 'cnh';
  return 'consulta';
}

// ==================== DASHBOARD TREINAMENTO APIs ====================

// GET /api/mensagens-pendentes
app.get('/api/mensagens-pendentes', async (req, res) => {
  try {
    const { service, limit = 50 } = req.query;
    
    let query = `
      SELECT 
        m.id,
        m.phone,
        m.text as "originalMessage",
        COALESCE(m.deepseek_response, 'Sem sugestão') as "aiSuggestion",
        m.category,
        m.created_at as date,
        CASE 
          WHEN mt.id IS NOT NULL THEN 
            CASE WHEN mt.tipo = 'aprovada' THEN 'approved' ELSE 'corrected' END
          ELSE 'pending'
        END as status,
        mt.resposta_corrigida as "correctedResponse"
      FROM mensagens m
      LEFT JOIN mensagens_treinadas mt ON m.id = mt.mensagem_id
      WHERE 1=1
    `;
    
    const params = [];
    if (service && service !== 'all') {
      query += ` AND m.category = $1 ORDER BY m.created_at DESC LIMIT $2`;
      params.push(service, limit);
    } else {
      query += ` ORDER BY m.created_at DESC LIMIT $1`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    res.json({ success: true, count: result.rows.length, messages: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Erro ao buscar mensagens', details: e.message });
  }
});

// GET /api/mensagens-treinadas
app.get('/api/mensagens-treinadas', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, mensagem_id, phone, mensagem_cliente as "customerMessage", resposta_ia as "aiResponse",
       resposta_corrigida as "correctedResponse", tipo as type, service, created_at as date
       FROM mensagens_treinadas ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ success: true, count: result.rows.length, training: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/aprovar/:id
app.post('/api/aprovar/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    
    const msgResult = await client.query('SELECT * FROM mensagens WHERE id = $1', [id]);
    if (msgResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    }
    
    const msg = msgResult.rows[0];
    const existing = await client.query('SELECT id FROM mensagens_treinadas WHERE mensagem_id = $1', [id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Já foi treinada' });
    }
    
    await client.query(
      `INSERT INTO mensagens_treinadas (mensagem_id, phone, mensagem_cliente, resposta_ia, tipo, service)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, msg.phone, msg.text, msg.deepseek_response || 'Sem sugestão', 'aprovada', msg.category]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Resposta aprovada! IA aprendeu.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/corrigir/:id
app.post('/api/corrigir/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { correctedResponse } = req.body;
    
    if (!correctedResponse) {
      return res.status(400).json({ success: false, error: 'Resposta corrigida obrigatória' });
    }
    
    await client.query('BEGIN');
    
    const msgResult = await client.query('SELECT * FROM mensagens WHERE id = $1', [id]);
    if (msgResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    }
    
    const msg = msgResult.rows[0];
    const existing = await client.query('SELECT id FROM mensagens_treinadas WHERE mensagem_id = $1', [id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Já foi treinada' });
    }
    
    await client.query(
      `INSERT INTO mensagens_treinadas (mensagem_id, phone, mensagem_cliente, resposta_ia, resposta_corrigida, tipo, service)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, msg.phone, msg.text, msg.deepseek_response || 'Sem sugestão', correctedResponse, 'corrigida', msg.category]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Correção salva! IA aprendeu.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /api/mensagem/:id
app.delete('/api/mensagem/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mensagens WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Mensagem removida' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/estatisticas
app.get('/api/estatisticas', async (req, res) => {
  try {
    const [total, aprovadas, corrigidas, hoje, porServico] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM mensagens_treinadas'),
      pool.query("SELECT COUNT(*) as c FROM mensagens_treinadas WHERE tipo = 'aprovada'"),
      pool.query("SELECT COUNT(*) as c FROM mensagens_treinadas WHERE tipo = 'corrigida'"),
      pool.query("SELECT COUNT(*) as c FROM mensagens_treinadas WHERE DATE(created_at) = CURRENT_DATE"),
      pool.query("SELECT service, COUNT(*) as count FROM mensagens_treinadas GROUP BY service ORDER BY count DESC")
    ]);
    
    const t = parseInt(total.rows[0].c);
    const a = parseInt(aprovadas.rows[0].c);
    
    res.json({
      success: true,
      stats: {
        total: t,
        aprovadas: a,
        corrigidas: parseInt(corrigidas.rows[0].c),
        hoje: parseInt(hoje.rows[0].c),
        taxaAprovacao: t > 0 ? Math.round((a / t) * 100) : 0,
        porServico: porServico.rows
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/documentos
app.get('/api/documentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM documentos ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, count: result.rows.length, documentos: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== DASHBOARD & HEALTH ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      service: 'wdespachante-v3.0',
      version: '3.0.0',
      db: 'postgresql',
      drive: isDriveConfigured(),
      gemini: GEMINI_API_KEY ? '2.0-flash-vision' : 'não configurado'
    });
  } catch (e) {
    res.status(500).json({ status: 'unhealthy', error: e.message });
  }
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════╗
║   🚗 WDespachante v3.0 - Sistema Completo        ║
║   ✅ Servidor: http://localhost:${PORT}             ║
║   📊 Dashboard: http://localhost:${PORT}/dashboard  ║
║   🔗 API: http://localhost:${PORT}/api              ║
║   📎 Drive: ${isDriveConfigured() ? 'Ativo' : 'Inativo'}                            ║
║   🤖 Gemini: ${GEMINI_API_KEY ? 'Ativo' : 'Inativo'}                           ║
╚═══════════════════════════════════════════════════╝
      `);
    });
  } catch (e) {
    console.error('❌ Erro ao iniciar:', e);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando...');
  await pool.end();
  process.exit(0);
});
