// server-wdespachante.js - Webhook Z-API com Agente WDESPACHANTE v2.1 + DeepSeek V3.2

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';

// ==================== DEEPSEEK V3.2 VIA OPENROUTER ====================
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-v1-9a4b4c8d5e6f7a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a';
const DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';

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
  },
  
  payment: {
    pix: '19869629000109',
    parcelamento: 'https://www.infinitepay.io/',
    advance_required: true,
    no_discount: true
  }
};

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  db.run("CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, text TEXT, category TEXT, is_client BOOLEAN, deepseek_response TEXT, approved BOOLEAN, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS orcamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, cliente TEXT, veiculo TEXT, placa TEXT, servico TEXT, honorario REAL, taxa_detran REAL, total REAL, status TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS approved_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, original_text TEXT, approved_response TEXT, category TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '50mb' }));

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
  let precosHtml = '';
  const servicosPrincipais = ['transferencia', 'licenciamento_simples', 'baixa_gravame', 'comunicacao_venda', 'segunda_via_crv'];
  for (const servico of servicosPrincipais) {
    const valor = WDESPACHANTE.honorarios[servico];
    precosHtml += '<tr><td style="padding:8px;border:1px solid #ddd">' + servico.replace(/_/g, ' ') + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + valor.toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right">R$ ' + WDESPACHANTE.taxas_detran['014-0'].toFixed(2) + '</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">R$ ' + (valor + WDESPACHANTE.taxas_detran['014-0']).toFixed(2) + '</td></tr>';
  }
  
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WDespachante v2.1 + DeepSeek</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50">' +
    '<div class="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-6">' +
    '<h1 class="text-3xl font-bold">WDespachante v2.1 + DeepSeek V3.2</h1>' +
    '<p>Av. Treze de Maio, 23 - Centro, RJ - 18 anos de experiência</p>' +
    '<div class="mt-2 text-sm"><span class="bg-green-500 px-2 py-1 rounded">DeepSeek V3.2</span> <span class="bg-purple-500 px-2 py-1 rounded">Aprendizado Ativo</span></div></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Preços Principais</h2><table style="width:100%;border-collapse:collapse;background:white"><thead style="background:#f3f4f6"><tr><th style="padding:12px;text-align:left;border:1px solid #ddd">Serviço</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Honorário</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Taxa DETRAN</th><th style="padding:12px;text-align:right;border:1px solid #ddd">Total</th></tr></thead><tbody>' + precosHtml + '</tbody></table></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Status do Sistema</h2><div id="stats" class="text-gray-500">Carregando...</div></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Últimas Mensagens</h2><div id="msgs" class="text-gray-500">Carregando...</div></div>' +
    '<div class="p-6"><h2 class="text-xl font-bold mb-4">Aprendizado de Estilo</h2><div id="learning" class="text-gray-500">Carregando...</div></div>' +
    '<script>async function load(){const r=await fetch("/stats");const d=await r.json();document.getElementById("stats").innerHTML="<div style=\'display:grid;grid-template-columns:repeat(4,1fr);gap:16px\'><div style=\'background:green;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.messages+"</div><div> mensagens</div></div><div style=\'background:blue;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.budgets+"</div><div> orçamentos</div></div><div style=\'background:purple;padding:16px;border-radius:8px;color:white\'><div style=\'font-size:24px;font-weight:bold\'>"+d.approved+"</div><div> respostas aprovadas</div></div><div style=\'background:yellow;padding:16px;border-radius:8px;color:black\'><div style=\'font-size:24px;font-weight:bold\'>R$ "+d.faturamento.toFixed(0)+"</div><div> faturamento</div></div></div>";const mr=await fetch("/api/mensagens");const msgs=await mr.json();let html="";for(const m of msgs.slice(0,5)){html+="<div class=\'p-3 bg-gray-100 rounded mb-2\'><strong>"+m.phone+"</strong>: "+m.text.substring(0,50)+"...</div>"}document.getElementById("msgs").innerHTML=html;const ar=await fetch("/api/approved");const app=await ar.json();document.getElementById("learning").innerHTML="<div class=\'bg-green-100 p-4 rounded\'><strong>"+app.count+"</strong> exemplos de estilo aprovados</div>";}load();setInterval(load,30000);</script></body></html>';
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
  res.json({ honorarios: WDESPACHANTE.honorarios, taxas: WDESPACHANTE.taxas_detran, prazos: WDESPACHANTE.prazos });
});

app.get('/api/approved', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM approved_responses', (err, rows) => {
    res.json({ count: rows[0]?.c || 0, examples: rows });
  });
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
      else res.json({ id: this.lastID, honorario, taxa, total: honorario + taxa, prazo, pix: WDESPACHANTE.payment.pix });
    });
});

app.get('/stats', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c, SUM(total) as s FROM orcamentos', (err, o) => {
      db.all('SELECT COUNT(*) as c FROM approved_responses', (err, a) => {
        res.json({ messages: m[0]?.c || 0, budgets: o[0]?.c || 0, approved: a[0]?.c || 0, faturamento: o[0]?.s || 0 });
      });
    });
  });
});

// ==================== DEEPSEEK V3.2 ====================
async function askDeepSeek(prompt) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://webhook-zapi-9i2x.onrender.com',
          'X-Title': 'WDespachante Agent'
        },
        timeout: 15000
      }
    );
    return response.data.choices[0].message.content;
  } catch (e) {
    console.error('DeepSeek Error:', e.message);
    return null;
  }
}

function buildDeepSeekPrompt(text, category) {
  return `Você é Wellington, dono do WDespachante (18 anos de experiência, RJ).

REGRAS WDESPACHANTE v2.1:
- Transferência: R$ 450 + taxa R$ 209,78
- Licenciamento: R$ 150-250 + taxa R$ 209,78
- Pagamento: PIX antecipado (19869629000109), sem desconto
- Parcelamento: InfinitePay (https://www.infinitepay.io/)
- Prazo transferência: 5-7 dias úteis

Cliente disse: "${text}"
Categoria: ${category}

Responda de forma amigável e profissional, como Wellington falaria. Seja direto, use emoji moderadamente, e sempre termine com uma pergunta de ação.

Resposta:`;
}

// ==================== WEBHOOK ====================
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'wdespachante-v2.1-deepseek', 
    version: '2.1.0',
    model: DEEPSEEK_MODEL,
    uptime: process.uptime() 
  });
});

app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos', (err, o) => {
      res.json({ mensagens: m[0]?.c || 0, orcamentos: o[0]?.c || 0, timestamp: new Date().toISOString() });
    });
  });
});

app.post('/test', async (req, res) => {
  const text = req.body.text || 'Teste DeepSeek v2.1';
  processMessage({ phone: '5511999999999', text: { message: text }, type: 'ReceivedCallback' });
  res.json({ status: 'test_sent', model: DEEPSEEK_MODEL });
});

// ==================== APROVAÇÃO DE RESPOSTAS ====================
app.post('/api/approve', (req, res) => {
  const { original_text, approved_response, category } = req.body;
  db.run('INSERT INTO approved_responses (original_text, approved_response, category) VALUES (?, ?, ?)',
    [original_text, approved_response, category],
    function(err) {
      if (err) res.status(500).json({ error: err.message });
      else res.json({ status: 'approved', id: this.lastID });
    });
});

// ==================== PROCESSAMENTO ====================
async function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const text = payload.text?.message || payload.message?.text || '';
  const isGroup = payload.isGroup || false;

  console.log('[' + phone + '] ' + text.substring(0, 50) + '...');
  
  const cat = classifyMessage(text, isGroup);
  
  if (cat.isClient) {
    db.run('INSERT INTO mensagens (phone, text, category, is_client) VALUES (?, ?, ?, ?)',
      [phone, text, cat.category, 1],
      async function(err) {
        if (err) console.error(err);
        else {
          console.log('MSG #' + this.lastID + ': ' + cat.category);
          
          // Usar DeepSeek V3.2
          const prompt = buildDeepSeekPrompt(text, cat.category);
          const response = await askDeepSeek(prompt);
          
          if (response) {
            db.run('UPDATE mensagens SET deepseek_response = ? WHERE id = ?', [response, this.lastID]);
            console.log('DeepSeek: ' + response.substring(0, 60) + '...');
          } else {
            // Fallback para resposta pré-definida
            const fallback = generateFallback(text, cat.category);
            db.run('UPDATE mensagens SET deepseek_response = ? WHERE id = ?', [fallback, this.lastID]);
          }
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

function generateFallback(text, category) {
  const honorario = WDESPACHANTE.honorarios[category] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  
  if (category === 'transferencia') {
    return 'Olá! Para transferência, vou precisar de:\n\n📋 CRLV vigente\n📋 CNH/RG + CPF\n📋 Comprovante residência\n\n💰 VALORES:\n├─ Honorários: R$ ' + honorario.toFixed(2) + '\n├─ Taxa DETRAN: R$ ' + taxa.toFixed(2) + '\n└─ TOTAL: R$ ' + (honorario + taxa).toFixed(2) + '\n\n⏱️ Prazo: 5-7 dias úteis\n\n📲 PIX: ' + WDESPACHANTE.payment.pix + '\n\nPosso dar andamento?';
  }
  return 'Olá! Como posso te ajudar com seu veículo?\n\nPosso ajudar com:\n• Transferência\n• Licenciamento\n• Multas\n• Documentos';
}

// ==================== INICIAR ====================
app.listen(PORT, () => {
  console.log('WDespachante v2.1 + DeepSeek V3.2 rodando na porta ' + PORT);
  console.log('Modelo: ' + DEEPSEEK_MODEL);
  console.log(Object.keys(WDESPACHANTE.honorarios).length + ' serviços configurados');
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('.'), 5 * 60 * 1000);
}
