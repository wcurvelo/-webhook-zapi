// server-wdespachante.js - Webhook Z-API com Agente WDESPACHANTE v2.1 INTEGRADO

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '***REMOVED***';
const GEMINI_MODEL = 'gemini-2.0-flash';

// ==================== REGRAS WDESPACHANTE v2.1 ====================
const WDESPACHANTE = {
  nome: 'WDespachante',
  endereco: 'Av. Treze de Maio, 23 - Centro, Rio de Janeiro',
  whatsapp: '(21) 96447-4147',
  experiencia: '18 anos',
  
  honorarios: {
    'transferencia': 450.00,
    'transferencia_jurisdicao': 450.00,
    'licenciamento_simples': 150.00,
    'licenciamento_debitos': 250.00,
    'primeira_licenca': 450.00,
    'segunda_via_crv': 450.00,
    'segunda_via_atpv': 250.00,
    'comunicacao_venda': 350.00,
    'cancelamento_comunicacao_venda': 350.00,
    'baixa_veiculo': 450.00,
    'baixa_gravame': 450.00,
    'inclusao_gravame': 450.00,
    'mudanca_municipio': 450.00,
    'mudanca_endereco': 450.00,
    'mudanca_nome': 450.00,
    'alteracao_caracteristicas': 450.00,
    'mudanca_cor': 450.00,
    'retirada_gnv': 450.00,
    'regularizacao_motor': 650.00,
    'remarcacao_chassi': 1200.00,
    'certidao_inteiro_teor': 250.00,
    'laudo_vistoria': 450.00,
    'vistoria_movel': 450.00,
    'vistoria_transito': 450.00,
    'troca_placa_mercosul_par': 450.00,
    'troca_placa_unitaria': 450.00,
    'veiculo_colecao': 1500.00
  },
  
  taxas_detran: {
    '014-0': 209.78,
    '018-3': 233.09,
    '037-0': 250.95
  },
  
  prazos: {
    'transferencia': '5-7 dias úteis',
    'licenciamento_simples': '3-5 dias úteis',
    'licenciamento_debitos': '3-5 dias úteis',
    'comunicacao_venda': '1-2 dias úteis',
    'baixa_gravame': '5-7 dias úteis'
  }
};

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  db.run("CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, text TEXT, category TEXT, is_client BOOLEAN, gemini_response TEXT, agent_response TEXT, approved BOOLEAN, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, cliente TEXT, veiculo TEXT, placa TEXT, servico TEXT, honorario REAL, taxa_detran REAL, total REAL, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '50mb' }));

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
  let precosHtml = '';
  for (const [servico, valor] of Object.entries(WDESPACHANTE.honorarios)) {
    precosHtml += '<tr><td style="padding:8px;border:1px solid #ddd">' + servico.replace(/_/g, ' ') + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + valor.toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + WDESPACHANTE.taxas_detran['014-0'].toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">R$ ' + (valor + WDESPACHANTE.taxas_detran['014-0']).toFixed(2) + '</td></tr>';
  }
  
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WDespachante v2.1</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50">' +
    '<div class="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-6">' +
    '<h1 class="text-3xl font-bold">WDespachante v2.1</h1>' +
    '<p>Av. Treze de Maio, 23 - Centro, RJ - 18 anos de experiência</p></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Tabela de Preços</h2>' +
    '<table style="width:100%;border-collapse:collapse;background:white">' +
    '<thead style="background:#f3f4f6"><tr><th style="padding:12px;text-align:left;border:1px solid #ddd">Serviço</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Honorário</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Taxa DETRAN</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Total</th></tr></thead>' +
    '<tbody>' + precosHtml + '</tbody></table></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Status</h2><div id="stats" class="text-gray-500">Carregando...</div></div>' +
    '<script>async function load(){const r=await fetch("/stats");const d=await r.json();document.getElementById("stats").innerHTML="<div style=\'display:grid;grid-template-columns:repeat(4,1fr);gap:16px\'><div style=\'background:green;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.messages+"</div><div> mensagens</div></div><div style=\'background:blue;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.orcamentos+"</div><div> orçamentos</div></div><div style=\'background:purple;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.processos+"</div><div> processos</div></div><div style=\'background:yellow;padding:16px;border-radius:8px;color:black\'><div style=\'font-size:24px;font-weight:bold\'>R$ "+d.faturamento.toFixed(0)+"</div><div> faturamento</div></div></div>";const mr=await fetch("/api/mensagens");const msgs=await mr.json();console.log("Mensagens:",msgs.length)};load();</script></body></html>';
  
  res.send(html);
});

// ==================== APIs ====================
app.get('/api/mensagens', (req, res) => {
  db.all('SELECT * FROM mensagens ORDER BY created_at DESC LIMIT 50', (err, rows) => { res.json(rows || []); });
});

app.get('/api/orcamentos', (req, res) => {
  db.all('SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 50', (err, rows) => { res.json(rows || []); });
});

app.get('/api/precos', (req, res) => {
  res.json({ honorarios: WDESPACHANTE.honorarios, taxas: WDESPACHANTE.taxas_detran, prazos: WDESPACHANTE.prazos });
});

app.post('/api/orcamento', (req, res) => {
  const { phone, cliente, veiculo, placa, servico } = req.body;
  const honorario = WDESPACHANTE.honorarios[servico] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  const prazo = WDESPACHANTE.prazos[servico] || '5-7 dias úteis';
  
  db.run('INSERT INTO orcamentos (phone, cliente, veiculo, placa, servico, honorario, taxa_detran, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [phone, cliente, veiculo, placa, servico, honorario, taxa, honorario + taxa, 'gerado'],
    function(err) {
      if (err) res.status(500).json({ error: err.message });
      else res.json({ id: this.lastID, honorario, taxa, total: honorario + taxa, prazo, pix: '19869629000109' });
    });
});

app.get('/stats', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c, SUM(total) as s FROM orcamentos', (err, o) => {
      res.json({ messages: m[0]?.c || 0, orcamentos: o[0]?.c || 0, processos: o[0]?.c || 0, faturamento: o[0]?.s || 0 });
    });
  });
});

// ==================== WEBHOOK ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'wdespachante-v2.1', version: '2.1.0', uptime: process.uptime() });
});

app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos', (err, o) => {
      res.json({ mensagens: m[0]?.c || 0, orcamentos: o[0]?.c || 0, timestamp: new Date().toISOString() });
    });
  });
});

app.post('/test', (req, res) => {
  processMessage({ phone: '5511999999999', text: { message: req.body.text || 'Teste v2.1' }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent' });
});

// ==================== PROCESSAMENTO ====================
function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const text = payload.text?.message || payload.message?.text || '';
  const isGroup = payload.isGroup || false;

  console.log('[' + phone + '] ' + text.substring(0, 50) + '...');
  
  const cat = classifyMessage(text, isGroup);
  
  if (cat.isClient) {
    db.run('INSERT INTO mensagens (phone, text, category, is_client) VALUES (?, ?, ?, ?)',
      [phone, text, cat.category, 1],
      function(err) {
        if (err) console.error(err);
        else {
          console.log('MSG #' + this.lastID + ': ' + cat.category);
          generateResponse(this.lastID, phone, text, cat);
        }
      });
  }
}

function classifyMessage(text, isGroup) {
  const lower = text.toLowerCase();
  if (isGroup) return { category: 'grupo', isClient: false };
  
  if (lower.includes('transfer') || lower.includes('compr')) return { category: 'transferencia', isClient: true };
  if (lower.includes('ipva') || lower.includes('licenci')) return { category: 'licenciamento', isClient: true };
  if (lower.includes('multa')) return { category: 'multas', isClient: true };
  if (lower.includes('crlv') || lower.includes('documento')) return { category: 'crlv', isClient: true };
  if (lower.includes('gravame')) return { category: 'gravame', isClient: true };
  
  return { category: 'consulta', isClient: true };
}

function generateResponse(msgId, phone, text, classification) {
  const honorario = WDESPACHANTE.honorarios[classification.category] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  
  let response = '';
  if (classification.category === 'transferencia') {
    response = 'Olá! Para transferência, vou precisar:\n\n📋 CRLV vigente\n📋 CNH/RG + CPF\n📋 Comprovante residência\n\n💰 VALORES:\n├─ Honorários: R$ ' + honorario.toFixed(2) + '\n├─ Taxa DETRAN: R$ ' + taxa.toFixed(2) + '\n└─ TOTAL: R$ ' + (honorario + taxa).toFixed(2) + '\n\n⏱️ Prazo: 5-7 dias úteis\n\n📲 PIX: 19869629000109\n\nPosso dar andamento?';
  } else if (classification.category === 'licenciamento') {
    response = 'Olá! Para licenciamento, preciso do CRLV.\n\n💰 Serviço: R$ ' + honorario.toFixed(2) + ' + taxa DETRAN R$ ' + taxa.toFixed(2) + '\n\nQuer seguir?';
  } else {
    response = 'Olá! Como posso te ajudar com seu veículo?\n\nPosso ajudar com:\n• Transferência\n• Licenciamento\n• Multas\n• Documentos';
  }
  
  db.run('UPDATE mensagens SET agent_response = ? WHERE id = ?', [response, msgId]);
  console.log('Response: ' + response.substring(0, 60) + '...');
}

// ==================== INICIAR ====================
app.listen(PORT, () => {
  console.log('WDespachante v2.1 rodando na porta ' + PORT);
  console.log(Object.keys(WDESPACHANTE.honorarios).length + ' serviços configurados');
  console.log('Transferência: R$ ' + WDESPACHANTE.honorarios.transferencia);
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('.'), 5 * 60 * 1000);
}