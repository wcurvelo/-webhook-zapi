// server-wdespachante.js - Webhook Z-API + Gemini 2.0 Flash Vision + Google Drive + PostgreSQL

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
  connectionString: process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/wdespachante',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY, phone TEXT NOT NULL, text TEXT, category TEXT,
        is_client BOOLEAN DEFAULT true, deepseek_response TEXT, gemini_analysis TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS orcamentos (
        id SERIAL PRIMARY KEY, phone TEXT, cliente TEXT, veiculo TEXT, placa TEXT,
        servico TEXT, honorario REAL, taxa_detran REAL, total REAL,
        status TEXT DEFAULT 'gerado', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS documentos (
        id SERIAL PRIMARY KEY, phone TEXT, message_id TEXT, tipo TEXT, mime_type TEXT,
        file_name TEXT, file_path TEXT, file_size INTEGER, file_hash TEXT,
        drive_url TEXT, gemini_analysis TEXT, status TEXT DEFAULT 'recebido',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ PostgreSQL tables ready');
  } finally { client.release(); }
}
initDB();

// ==================== GOOGLE DRIVE ====================
const driveManager = new GoogleDriveManager();

// ==================== GEMINI 2.0 FLASH VISION ====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '***REMOVED***';
const GEMINI_MODEL = 'gemini-2.0-flash-001';

async function analyzeWithGemini(imageBuffer, mimeType, fileName) {
  try {
    const base64 = imageBuffer.toString('base64');
    const prompt = `Você é Wellington, dono do WDespachante (18 anos, RJ).

Analise este documento e extraia:

1. **Tipo de documento** (CRLV, CNH, RG, CPF, Comprovante, Contrato, etc.)
2. **Dados extraídos** (nome, CPF, placa, Renavam, etc.)
3. **Status** (legível, ilegível, incompleto)
4. **Próximos passos** (o que o cliente precisa enviar)
5. **Serviço relacionado** (transferência, licenciamento, etc.)

Responda em JSON:
{
  "tipo": "crlv",
  "dados": {"placa": "ABC1234", "renavam": "123456789", "proprietario": "João Silva"},
  "status": "legivel",
  "proximo_passo": "Solicitar CRLV verso",
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
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        return { raw: text, tipo: detectDocumentType(fileName, mimeType) };
      }
    }
    return { raw: text, tipo: detectDocumentType(fileName, mimeType) };
  } catch (e) {
    console.error('Gemini Error:', e.message);
    return { error: e.message, tipo: detectDocumentType(fileName, mimeType) };
  }
}

// ==================== WDESPACHANTE ====================
const WDESPACHANTE = {
  nome: 'WDespachante', endereco: 'Av. Treze de Maio, 23 - Centro, RJ',
  whatsapp: '(21) 96447-4147', experiencia: '18 anos',
  honorarios: { transferencia: 450, licenciamento_simples: 150, licenciamento_debitos: 250,
    segunda_via_crv: 450, baixa_gravame: 450, comunicacao_venda: 350 },
  taxas_detran: { '014-0': 209.78 },
  payment: { pix: '19869629000109' }
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

app.get('/stats', async (req, res) => {
  try {
    const [m, o, d, f] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM mensagens'),
      pool.query('SELECT COUNT(*) as c FROM orcamentos'),
      pool.query('SELECT COUNT(*) as c FROM documentos'),
      pool.query('SELECT SUM(total) as s FROM orcamentos')
    ]);
    res.json({
      messages: parseInt(m.rows[0].c), budgets: parseInt(o.rows[0].c),
      docs: parseInt(d.rows[0].c), faturamento: parseFloat(f.rows[0]?.s) || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'wdespachante-v2.1-gemini', version: '2.1.0',
      drive: driveManager.isConfigured(), db: 'postgresql', gemini: '2.0-flash-vision' });
  } catch (e) { res.status(500).json({ status: 'unhealthy', error: e.message }); }
});

app.post('/api/orcamento', async (req, res) => {
  const { phone, cliente, veiculo, placa, servico } = req.body;
  const honorario = WDESPACHANTE.honorarios[servico] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  try {
    const result = await pool.query(
      'INSERT INTO orcamentos (phone, cliente, veiculo, placa, servico, honorario, taxa_detran, total, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [phone, cliente, veiculo, placa, servico, honorario, taxa, honorario + taxa, 'gerado']);
    res.json({ id: result.rows[0].id, honorario, taxa, total: honorario + taxa, pix: WDESPACHANTE.payment.pix });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/test', async (req, res) => {
  await processMessage({ phone: '5511999999999', text: { message: { message: req.body.text || 'Teste' } }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent' });
});

// ==================== WEBHOOK ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

// ==================== PROCESSAMENTO ====================
async function processMessage(payload) {
  const phone = payload.phone || payload.sender?.phone || 'unknown';
  const messageType = payload.type || payload.message?.type || 'text';
  console.log('[' + phone + '] Tipo: ' + messageType);

  // Documentos (imagem, pdf, etc.)
  if (['image', 'document', 'audio', 'video'].includes(messageType)) {
    await processDocument(payload, phone, messageType);
    return;
  }

  // Mensagens de texto
  const text = payload.text?.message?.message || payload.text?.message || payload.text || '';
  if (payload.isGroup || payload.is_group) {
    console.log('Grupo, ignorando');
    return;
  }

  const cat = classifyMessage(text);
  try {
    const result = await pool.query(
      'INSERT INTO mensagens (phone, text, category, is_client) VALUES ($1, $2, $3, $4) RETURNING id',
      [phone, text, cat, true]);
    console.log('MSG #' + result.rows[0].id + ': ' + cat);
  } catch (e) { console.error(e); }
}

async function processDocument(payload, phone, docType) {
  const msg = payload.message || payload;
  let fileUrl = msg.mediaUrl || msg.content?.mediaUrl || null;
  let fileName = msg.fileName || msg.mediaName || `arquivo_${Date.now()}`;
  let mimeType = msg.mimeType || msg.content?.mimeType || 'application/octet-stream';
  
  console.log('📎 Documento - phone:', phone, 'type:', docType, 'url:', fileUrl ? 'SIM' : 'NÃO');

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
      console.log('⬇️ Baixado: ' + (fileSize / 1024).toFixed(1) + 'KB');
    } catch (e) { console.error('Download error:', e.message); }
  }

  // Upload para Google Drive
  const docCategory = detectDocumentType(fileName, mimeType);
  const driveResult = await driveManager.uploadFile(filePath, fileName, phone, docCategory);
  if (driveResult.success) driveUrl = driveResult.drive_url || driveResult.local_path;

  // Análise com Gemini 2.0 Flash Vision
  if (content && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
    console.log('🔍 Analisando com Gemini 2.0 Flash Vision...');
    geminiAnalysis = await analyzeWithGemini(content, mimeType, fileName);
    console.log('✅ Gemini:', JSON.stringify(geminiAnalysis).substring(0, 100));
  }

  // Salvar no PostgreSQL
  try {
    await pool.query(
      'INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, drive_url, gemini_analysis, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [phone, msg.id || crypto.randomUUID(), docType, mimeType, fileName, filePath, fileSize, fileHash, driveUrl, JSON.stringify(geminiAnalysis), 'analisado']);
    console.log('💾 Salvo no PostgreSQL');
  } catch (e) { console.error('Erro ao salvar:', e.message); }
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
  console.log('WDespachante v2.1 + Gemini 2.0 Flash Vision');
  console.log('Porta: ' + PORT);
  console.log('Banco: PostgreSQL (persistente!)');
  console.log('Gemini: 2.0 Flash Vision (análise de imagens)');
  console.log('Drive: ' + (driveManager.isConfigured() ? 'Ativo' : 'Inativo'));
});

module.exports = { app, pool };

// ==================== API MESSAGES ====================
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mensagens ORDER BY id DESC LIMIT 50');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mensagens WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] || { error: 'Not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
