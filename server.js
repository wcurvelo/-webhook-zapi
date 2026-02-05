// server-wdespachante.js - Webhook Z-API com Agente WDESPACHANTE v2.1 + DeepSeek V3.2 + Document Storage

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';
const DOCS_PATH = process.env.DOCS_PATH || '/tmp/documentos';

// ==================== DEEPSEEK V3.2 VIA OPENROUTER ====================
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';

// Criar diretório de documentos
if (!fs.existsSync(DOCS_PATH)) {
  fs.mkdirSync(DOCS_PATH, { recursive: true });
  console.log('Diretório de documentos criado:', DOCS_PATH);
}

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
  
  prazos: {
    'transferencia': '5-7 dias úteis',
    'licenciamento_simples': '3-5 dias úteis',
    'comunicacao_venda': '1-2 dias úteis',
    'baixa_gravame': '5-7 dias úteis'
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
  // Mensagens
  db.run("CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, text TEXT, category TEXT, is_client BOOLEAN, deepseek_response TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  
  // Orçamentos
  db.run("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, cliente TEXT, veiculo TEXT, placa TEXT, servico TEXT, honorario REAL, taxa_detran REAL, total REAL, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  
  // Respostas aprovadas (para aprendizado)
  db.run("CREATE TABLE IF NOT EXISTS approved_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, original_text TEXT, approved_response TEXT, category TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  
  // DOCUMENTOS - ARMAZENAMENTO DE ARQUIVOS
  db.run(`CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    message_id TEXT,
    tipo TEXT,
    mime_type TEXT,
    file_name TEXT,
    file_path TEXT,
    file_size INTEGER,
    file_hash TEXT,
    descricao TEXT,
    servico_relacionado TEXT,
    status TEXT DEFAULT 'recebido',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  
  console.log('✅ Tabelas criadas, incluindo documentos');
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '100mb' }));
app.use('/documentos', express.static(DOCS_PATH));

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
  let precosHtml = '';
  const servicos = ['transferencia', 'licenciamento_simples', 'baixa_gravame', 'comunicacao_venda', 'segunda_via_crv'];
  for (const s of servicos) {
    const v = WDESPACHANTE.honorarios[s];
    precosHtml += '<tr><td style="padding:8px;border:1px solid #ddd">' + s.replace(/_/g, ' ') + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + v.toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + WDESPACHANTE.taxas_detran['014-0'].toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">R$ ' + (v + WDESPACHANTE.taxas_detran['014-0']).toFixed(2) + '</td></tr>';
  }
  
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WDespachante v2.1 + Docs</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50">' +
    '<div class="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-6">' +
    '<h1 class="text-3xl font-bold">WDespachante v2.1 + DeepSeek + Documentos</h1>' +
    '<p>Av. Treze de Maio, 23 - Centro, RJ - 18 anos de experiência</p></div>' +
    '<div class="p-6 grid grid-cols-2 gap-6">' +
    '<div><h2 class="text-xl font-bold mb-4">Preços</h2><table style="width:100%;border-collapse:collapse;background:white"><thead style="background:#f3f4f6"><tr><th style="padding:12px;text-align:left">Serviço</th><th style="padding:12px;text-align:right">Honorário</th><th style="padding:12px;text-align:right">Total</th></tr></thead><tbody>' + precosHtml + '</tbody></table></div>' +
    '<div><h2 class="text-xl font-bold mb-4">Status</h2><div id="stats" class="text-gray-500">Carregando...</div></div></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">📁 Documentos Recebidos</h2><div id="docs" class="text-gray-500">Carregando...</div></div>' +
    '<script>async function load(){const r=await fetch("/stats");const d=await r.json();document.getElementById("stats").innerHTML="<div style=\'display:grid;grid-template-columns:repeat(4,1fr);gap:16px\'><div style=\'background:green;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.messages+"</div><div> mensagens</div></div><div style=\'background:blue;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.docs+"</div><div> documentos</div></div><div style=\'background:purple;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.budgets+"</div><div> orçamentos</div></div><div style=\'background:yellow;padding:16px;border-radius:8px;color:black\'><div style=\'font-size:24px;font-weight:bold\'>R$ "+d.faturamento.toFixed(0)+"</div><div> faturamento</div></div></div>";const dr=await fetch("/api/documentos");const docs=await dr.json();let h="";for(const doc of docs){const icone=doc.tipo==="image"?"🖼️":doc.tipo==="pdf"?"📄":"📎";h+="<div class=\'p-3 bg-white rounded shadow mb-2\'>"+icone+" <strong>"+doc.file_name+"</strong> <span class=\'text-gray-500\'>("+(doc.file_size/1024).toFixed(1)+"KB)</span> <span class=\'text-blue-600\'>"+doc.phone+"</span> <span class=\'text-gray-400\'>"+new Date(doc.created_at).toLocaleString()+"</span></div>"}document.getElementById("docs").innerHTML=h||"<div class=\'text-gray-500\'>Nenhum documento ainda</div>";}load();setInterval(load,30000);</script></body></html>';
  res.send(html);
});

// ==================== APIs ====================
app.get('/api/mensagens', (req, res) => {
  db.all('SELECT * FROM mensagens ORDER BY created_at DESC LIMIT 20', (err, rows) => { res.json(rows || []); });
});

app.get('/api/orcamentos', (req, res) => {
  db.all('SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 20', (err, rows) => { res.json(rows || []); });
});

app.get('/api/precos', (req, res) => {
  res.json({ honorarios: WDESPACHANTE.honorarios, taxas: WDESPACHANTE.taxas_detran });
});

// API DOCUMENTOS - LISTAR
app.get('/api/documentos', (req, res) => {
  db.all('SELECT * FROM documentos ORDER BY created_at DESC LIMIT 50', (err, rows) => { res.json(rows || []); });
});

// API DOCUMENTOS - VER DETALHES
app.get('/api/documentos/:id', (req, res) => {
  db.get('SELECT * FROM documentos WHERE id = ?', [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Documento não encontrado' });
    res.json(row);
  });
});

// API DOCUMENTOS - ATUALIZAR DESCRIÇÃO
app.patch('/api/documentos/:id', (req, res) => {
  const { descricao, servico_relacionado, status } = req.body;
  db.run('UPDATE documentos SET descricao = ?, servico_relacionado = ?, status = ? WHERE id = ?',
    [descricao, servico_relacionado, status, req.params.id],
    function(err) {
      if (err) res.status(500).json({ error: err.message });
      else res.json({ status: 'updated', id: req.params.id });
    });
});

app.get('/stats', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos', (err, o) => {
      db.all('SELECT COUNT(*) as c, SUM(total) as s FROM orcamentos', (err, s) => {
        db.all('SELECT COUNT(*) as c FROM documentos', (err, d) => {
          res.json({ 
            messages: m[0]?.c || 0, 
            budgets: o[0]?.c || 0, 
            docs: d[0]?.c || 0,
            faturamento: s[0]?.s || 0 
          });
        });
      });
    });
  });
});

// ==================== DEEPSEEK V3.2 ====================
async function askDeepSeek(prompt) {
  if (!OPENROUTER_API_KEY) {
    console.log('DeepSeek: API key não configurada');
    return null;
  }
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model: DEEPSEEK_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 500 },
      { headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return response.data.choices[0].message.content;
  } catch (e) {
    console.error('DeepSeek Error:', e.message);
    return null;
  }
}

function buildDeepSeekPrompt(text, category) {
  return `Você é Wellington, dono do WDespachante (18 anos, RJ).

REGRAS:
- Transferência: R$ 450 + R$ 209,78 taxa
- PIX: 19869629000109
- Sem desconto, pagamento antecipado

Cliente: "${text}"
Categoria: ${category}

Responda de forma amigável e profissional.`;
}

// ==================== WEBHOOK ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'wdespachante-v2.1-docs', version: '2.1.0', docs_path: DOCS_PATH });
});

app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM documentos', (err, d) => {
      res.json({ mensagens: m[0]?.c || 0, documentos: d[0]?.c || 0 });
    });
  });
});

app.post('/test', async (req, res) => {
  processMessage({ phone: '5511999999999', text: { message: req.body.text || 'Teste' }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent' });
});

// ==================== ARMAZENAMENTO DE DOCUMENTOS ====================
async function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const messageType = payload.type || payload.message?.type || 'text';
  const messageId = payload.messageId || payload.message?.id || crypto.randomUUID();
  
  console.log('[' + phone + '] Tipo: ' + messageType);
  
  // Verificar se é documento (imagem, pdf, etc)
  if (['image', 'document', 'audio', 'video'].includes(messageType)) {
    await processDocument(payload, phone, messageType, messageId);
    return;
  }
  
  // Processar mensagem de texto
  const text = payload.text?.message || payload.message?.text || '';
  const isGroup = payload.isGroup || false;
  
  if (isGroup) return;
  
  const cat = classifyMessage(text);
  
  db.run('INSERT INTO mensagens (phone, text, category, is_client) VALUES (?, ?, ?, ?)',
    [phone, text, cat, 1],
    async function(err) {
      if (err) console.error(err);
      else {
        console.log('MSG #' + this.lastID + ': ' + cat);
        const response = await askDeepSeek(buildDeepSeekPrompt(text, cat));
        if (response) {
          db.run('UPDATE mensagens SET deepseek_response = ? WHERE id = ?', [response, this.lastID]);
        }
      }
    });
}

async function processDocument(payload, phone, docType, messageId) {
  let fileUrl = null;
  let fileName = 'arquivo';
  let mimeType = 'application/octet-stream';
  
  // Obter URL do arquivo (depends on Z-API structure)
  if (payload.message?.mediaUrl) {
    fileUrl = payload.message.mediaUrl;
  } else if (payload.message?.content?.mediaUrl) {
    fileUrl = payload.message.content.mediaUrl;
  }
  
  if (payload.message?.fileName) {
    fileName = payload.message.fileName;
  } else if (docType === 'image') {
    fileName = 'imagem_' + messageId + '.jpg';
  } else if (docType === 'pdf') {
    fileName = 'documento_' + messageId + '.pdf';
  }
  
  if (payload.message?.mimeType) {
    mimeType = payload.message.mimeType;
  }
  
  console.log('📎 Documento: ' + fileName + ' (' + docType + ')');
  
  // Download do arquivo se URL disponível
  let filePath = null;
  let fileSize = 0;
  let fileHash = null;
  
  if (fileUrl) {
    try {
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
      fileSize = response.data.length;
      fileHash = crypto.createHash('md5').update(response.data).digest('hex');
      
      // Salvar arquivo
      const ext = path.extname(fileName) || '.' + docType;
      const safeName = crypto.randomUUID() + ext;
      filePath = path.join(DOCS_PATH, safeName);
      fs.writeFileSync(filePath, response.data);
      
      console.log('✅ Arquivo salvo: ' + filePath + ' (' + (fileSize/1024).toFixed(1) + 'KB)');
    } catch (e) {
      console.error('Erro ao baixar arquivo:', e.message);
    }
  }
  
  // Salvar no banco
  db.run('INSERT INTO documentos (phone, message_id, tipo, mime_type, file_name, file_path, file_size, file_hash, descricao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [phone, messageId, docType, mimeType, fileName, filePath, fileSize, fileHash, 'Documento recebido via WhatsApp'],
    function(err) {
      if (err) console.error('Erro ao salvar documento:', err.message);
      else console.log('💾 Documento #' + this.lastID + ' registrado');
    });
}

function classifyMessage(text) {
  const lower = text.toLowerCase();
  if (lower.includes('transfer') || lower.includes('compr')) return 'transferencia';
  if (lower.includes('ipva') || lower.includes('licenci')) return 'licenciamento';
  if (lower.includes('multa')) return 'multas';
  if (lower.includes('crlv') || lower.includes('documento')) return 'crlv';
  if (lower.includes('gravame')) return 'gravame';
  return 'consulta';
}

// ==================== INICIAR ====================
app.listen(PORT, () => {
  console.log('WDespachante v2.1 + Documentos rodando na porta ' + PORT);
  console.log('📁 Documentos: ' + DOCS_PATH);
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('.'), 5 * 60 * 1000);
}
