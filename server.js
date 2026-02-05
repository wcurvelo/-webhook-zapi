// server-wdespachante.js - Webhook Z-API + DeepSeek + Google Drive Documents

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleDriveManager, detectDocumentType } = require('./google-drive');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';

// Inicializar Google Drive
const driveManager = new GoogleDriveManager();
driveManager.createFolders();

// ==================== DEEPSEEK V3.2 VIA OPENROUTER ====================
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';

// ==================== REGRAS WDESPACHANTE v2.1 ====================
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
  
  taxas_detran: {
    '014-0': 209.78,
    '018-3': 233.09,
    '037-0': 250.95
  },
  
  payment: {
    pix: '19869629000109',
    parcelamento: 'https://www.infinitepay.io/'
  }
};

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  db.run("CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, text TEXT, category TEXT, is_client BOOLEAN, deepseek_response TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, cliente TEXT, veiculo TEXT, placa TEXT, servico TEXT, honorario REAL, taxa_detran REAL, total REAL, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, message_id TEXT, tipo TEXT, mime_type TEXT, file_name TEXT, file_path TEXT, file_size INTEGER, file_hash TEXT, drive_url TEXT, status TEXT DEFAULT 'recebido', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  console.log('✅ Tabelas criadas');
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '100mb' }));
app.use('/uploads', express.static('./uploads'));

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
  let precosHtml = '';
  const servicos = ['transferencia', 'licenciamento_simples', 'baixa_gravame', 'comunicacao_venda'];
  for (const s of servicos) {
    const v = WDESPACHANTE.honorarios[s];
    precosHtml += '<tr><td style="padding:8px;border:1px solid #ddd">' + s.replace(/_/g, ' ') + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + v.toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">R$ ' + (v + WDESPACHANTE.taxas_detran['014-0']).toFixed(2) + '</td></tr>';
  }
  
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WDespachante v2.1 + Google Drive</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50">' +
    '<div class="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-6">' +
    '<h1 class="text-3xl font-bold">WDespachante v2.1 + Google Drive</h1>' +
    '<p>Av. Treze de Maio, 23 - Centro, RJ - 18 anos de experiência</p>' +
    '<div class="mt-2 text-sm"><span class="bg-green-500 px-2 py-1 rounded">Drive Ativo</span> <span class="bg-purple-500 px-2 py-1 rounded">DeepSeek</span></div></div>' +
    '<div class="p-6 grid grid-cols-2 gap-6">' +
    '<div><h2 class="text-xl font-bold mb-4">Preços</h2><table style="width:100%;border-collapse:collapse;background:white"><thead style="background:#f3f4f6"><tr><th style="padding:12px;text-align:left">Serviço</th><th style="padding:12px;text-align:right">Honorário</th><th style="padding:12px;text-align:right">Total</th></tr></thead><tbody>' + precosHtml + '</tbody></table></div>' +
    '<div><h2 class="text-xl font-bold mb-4">Status</h2><div id="stats" class="text-gray-500">Carregando...</div></div></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">📁 Documentos no Google Drive</h2><div id="docs" class="text-gray-500">Carregando...</div></div>' +
    '<script>async function load(){const r=await fetch("/stats");const d=await r.json();document.getElementById("stats").innerHTML="<div style=\'display:grid;grid-template-columns:repeat(4,1fr);gap:16px\'><div style=\'background:green;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.messages+"</div><div> mensagens</div></div><div style=\'background:blue;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.docs+"</div><div> documentos</div></div><div style=\'background:purple;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.budgets+"</div><div> orçamentos</div></div><div style=\'background:yellow;padding:16px;border-radius:8px;color:black\'><div style=\'font-size:24px;font-weight:bold\'>R$ "+d.faturamento.toFixed(0)+"</div><div> faturamento</div></div></div>";const dr=await fetch("/api/documentos");const docs=await dr.json();let h="";for(const doc of docs.slice(0,10)){const icone=doc.tipo==="image"?"🖼️":doc.tipo==="pdf"?"📄":"📎";h+="<div class=\'p-3 bg-white rounded shadow mb-2\'>"+icone+" <strong>"+doc.file_name+"</strong> <span class=\'text-gray-500\'>("+(doc.file_size/1024).toFixed(1)+"KB)</span> <span class=\'text-blue-600\'>"+doc.phone+"</span>"+(doc.drive_url?" <a href=\'"+doc.drive_url+"\' target=\'_blank\' class=\'text-green-600\'>📂 Drive</a>":"")+" <span class=\'text-gray-400\'>"+new Date(doc.created_at).toLocaleString()+"</span></div>"}document.getElementById("docs").innerHTML=h||"<div class=\'text-gray-500\'>Nenhum documento</div>";}load();setInterval(load,30000);</script></body></html>';
  res.send(html);
});

// ==================== APIs ====================
app.get('/api/mensagens', (req, res) => {
  db.all('SELECT * FROM mensagens ORDER BY created_at DESC LIMIT 20', (err, rows) => { res.json(rows || []); });
});

app.get('/api/orcamentos', (req, res) => {
  db.all('SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 20', (err, rows) => { res.json(rows || []); });
});

app.get('/api/documentos', (req, res) => {
  db.all('SELECT * FROM documentos ORDER BY created_at DESC LIMIT 50', (err, rows) => { res.json(rows || []); });
});

app.get('/stats', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos', (err, o) => {
      db.all('SELECT COUNT(*) as c, SUM(total) as s FROM orcamentos', (err, s) => {
        db.all('SELECT COUNT(*) as c FROM documentos', (err, d) => {
          res.json({ messages: m[0]?.c || 0, budgets: o[0]?.c || 0, docs: d[0]?.c || 0, faturamento: s[0]?.s || 0 });
        });
      });
    });
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'wdespachante-v2.1-drive', version: '2.1.0', drive_configured: driveManager.isConfigured() });
});

app.post('/test', (req, res) => {
  processMessage({ phone: '5511999999999', text: { message: req.body.text || 'Teste' }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent' });
});

// ==================== PROCESSAMENTO ====================
async function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const messageType = payload.type || payload.message?.type || 'text';
  const messageId = payload.messageId || crypto.randomUUID();
  
  console.log('[' + phone + '] Tipo: ' + messageType);
  
  // Documento
  if (['image', 'document', 'audio', 'video'].includes(messageType)) {
    await processDocument(payload, phone, messageType, messageId);
    return;
  }
  
  // Texto
  const text = payload.text?.message || payload.message?.text || '';
  if (payload.isGroup) return;
  
  const cat = classifyMessage(text);
  
  db.run('INSERT INTO mensagens (phone, text, category, is_client) VALUES (?, ?, ?, ?)',
    [phone, text, cat, 1],
    async function(err) {
      if (err) console.error(err);
      else console.log('MSG #' + this.lastID + ': ' + cat);
    });
}

async function processDocument(payload, phone, docType, messageId) {
  let fileUrl = null;
  let fileName = 'arquivo_' + messageId;
  let mimeType = 'application/octet-stream';
  
  if (payload.message?.mediaUrl) fileUrl = payload.message.mediaUrl;
  if (payload.message?.fileName) fileName = payload.message.fileName;
  if (payload.message?.mimeType) mimeType = payload.message.mimeType;
  
  // Detectar tipo de documento
  const docCategory = detectDocumentType(fileName, mimeType);
  
  console.log('📎 Documento: ' + fileName + ' (' + docType + ') → ' + docCategory);
  
  // Download
  let content = null;
  let filePath = null;
  let fileSize = 0;
  let fileHash = null;
  
  if (fileUrl) {
    try {
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
      content = response.data;
      fileSize = content.length;
      fileHash = crypto.createHash('md5').update(content).digest('hex');
      
      const ext = path.extname(fileName) || '.' + docType;
      const tempPath = '/tmp/' + crypto.randomUUID() + ext;
      fs.writeFileSync(tempPath, content);
      filePath = tempPath;
      
      console.log('⬇️ Baixado: ' + (fileSize/1024).toFixed(1) + 'KB');
    } catch (e) {
      console.error('Erro download:', e.message);
    }
  }
  
  // Upload para Google Drive
  const driveResult = await driveManager.uploadFile(filePath, fileName, phone, docCategory);
  
  // Salvar no banco
  db.run('INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, drive_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [phone, messageId, docType, mimeType, fileName, filePath || driveResult.local_path, fileSize, fileHash, driveResult.drive_url || driveResult.local_path, 'recebido'],
    function(err) {
      if (err) console.error(err);
      else console.log('💾 Documento #' + this.lastID + ' salvo');
    });
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
  console.log('WDespachante v2.1 + Google Drive rodando na porta ' + PORT);
  console.log('Drive configurado: ' + driveManager.isConfigured());
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('.'), 5 * 60 * 1000);
}
