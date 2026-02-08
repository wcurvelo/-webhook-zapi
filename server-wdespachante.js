// server-wdespachante.js - Webhook Z-API com Agente WDESPACHANTE v2.1 INTEGRADO
// Prompt completo + Integração com Agente OpenClaw

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURAÇÕES ====================
const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const AGENT_SCRIPT = process.env.AGENT_SCRIPT || '/home/wcurvelo/.openclaw/agents/wdespachante/wdespachante_agent.py';

// ==================== REGRAS WDESPACHANTE v2.1 ====================
const WDESPACHANTE = {
  nome: 'WDespachante',
  endereco: 'Av. Treze de Maio, 23 - Centro, Rio de Janeiro',
  whatsapp: '(21) 96447-4147',
  experiencia: '18 anos',
  
  // PREÇOS DE HONORÁRIOS (atualizados v2.1)
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
    'veiculo_colecao': 1500.00,
    'pcd_ipi': 600.00,
    'pcd_icms': 600.00,
    'pcd_ipva': 600.00
  },
  
  // TAXAS DETRAN (código: valor)
  taxas_detran: {
    '001-9': 209.78,
    '002-7': 209.78,
    '003-5': 209.78,
    '004-3': 209.78,
    '007-8': 93.26,
    '008-6': 209.78,
    '009-4': 209.78,
    '014-0': 209.78,  // Transferência
    '016-7': 251.74,
    '018-3': 233.09,  // Baixa Gravame
    '019-1': 419.55,
    '020-5': 2051.08,
    '023-0': 209.78,
    '037-0': 250.95,  // Placas Mercosul
    '038-8': 125.45,
    '041-8': 76.84
  },
  
  // PRAZOS (dias úteis)
  prazos: {
    'transferencia': '5-7',
    'licenciamento_simples': '3-5',
    'licenciamento_debitos': '3-5',
    'segunda_via_crv': '5-7',
    'comunicacao_venda': '1-2',
    'baixa_gravame': '5-7',
    'troca_placa_mercosul_par': '5-7',
    'mudanca_endereco': '5-7',
    'transferencia_jurisdicao': '7-15',
    'alteracao_caracteristicas': '5-7'
  },
  
  // TEMPLATES
  templates: {
    orcamento: (dados) => `
*ORÇAMENTO WDESPACHANTE*

*Cliente:* ${dados.nome || '[nome]'}
*Veículo:* ${dados.placa || '[placa]'}
*Serviço:* ${dados.servico}

*VALORES:*
├─ Honorários: R$ ${dados.honorario.toFixed(2)}
├─ Taxa DETRAN: R$ ${dados.taxa.toFixed(2)}
└─ *TOTAL: R$ ${dados.total.toFixed(2)}*

*Prazo:* ${dados.prazo} dias úteis

*Pagamento:* PIX antecipado
*PIX:* 19869629000109

Posso dar andamento?`,

    primeiro_contato: (nome, servico) => `
Olá ${nome}! Tudo bem?
Vi sua mensagem sobre *${servico}*.

Para consultar débitos e restrições, me mande:
- Placa
- RENAVAM
- CPF do proprietário

Ou uma foto do CRLV/CRV bem nítida!
`,

    documentacao_aprovada: (nome, proximo) => `
${nome}, documentação aprovada! ✅

Próximo passo: ${proximo}

Estamos quase lá!`
  },
  
  regras_pagamento: {
    antecipado: true,
    sem_desconto: true,
    parcelamento_url: 'https://www.infinitepay.io/'
  }
};

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err.message);
  else { console.log('📦 DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      text TEXT,
      category TEXT,
      is_client BOOLEAN,
      gemini_response TEXT,
      agent_response TEXT,
      approved BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS orcamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      cliente TEXT,
      veiculo TEXT,
      placa TEXT,
      servico TEXT,
      honorario REAL,
      taxa_detran REAL,
      total REAL,
      status TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '50mb' }));

// ==================== ENDPOINTS ====================

// Dashboard Principal
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>WDespachante v2.1 - Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <div class="bg-gradient-to-r from-blue-700 to-blue-900 text-white p-6">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div>
        <h1 class="text-3xl font-bold">
          <i class="fas fa-car-side mr-3"></i>WDespachante v2.1
        </h1>
        <p class="text-blue-200 mt-2">Av. Treze de Maio, 23 - Centro, RJ • 18 anos de experiência</p>
      </div>
      <div class="text-right">
        <div class="text-4xl font-bold" id="msg-count">0</div>
        <div class="text-sm">mensagens</div>
      </div>
    </div>
  </div>

  <div class="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Mensagens -->
    <div class="bg-white rounded-xl shadow p-6">
      <h2 class="text-xl font-bold mb-4">
        <i class="fas fa-comments mr-2"></i>Mensagens Recentes
      </h2>
      <div id="mensagens" class="space-y-3 max-h-96 overflow-y-auto">
        <div class="text-center py-8 text-gray-400">Carregando...</div>
      </div>
    </div>

    <!-- Orçamentos -->
    <div class="bg-white rounded-xl shadow p-6">
      <h2 class="text-xl font-bold mb-4">
        <i class="fas fa-file-invoice-dollar mr-2"></i>Orçamentos
      </h2>
      <div id="orcamentos" class="space-y-3 max-h-96 overflow-y-auto">
        <div class="text-center py-8 text-gray-400">Carregando...</div>
      </div>
    </div>
  </div>

  <!-- Preços -->
  <div class="max-w-7xl mx-auto p-6">
    <div class="bg-white rounded-xl shadow p-6">
      <h2 class="text-xl font-bold mb-4">
        <i class="fas fa-tags mr-2"></i>Tabela de Preços v2.1
      </h2>
      <div id="precos" class="overflow-x-auto"></div>
    </div>
  </div>

  <!-- Stats -->
  <div class="max-w-7xl mx-auto p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="bg-green-100 p-4 rounded-xl">
      <div class="text-green-800 text-sm">Orçamentos Hoje</div>
      <div class="text-2xl font-bold" id="orc-hoje">0</div>
    </div>
    <div class="bg-blue-100 p-4 rounded-xl">
      <div class="text-blue-800 text-sm">Clientes Ativos</div>
      <div class="text-2xl font-bold" id="cli-ativos">0</div>
    </div>
    <div class="bg-purple-100 p-4 rounded-xl">
      <div class="text-purple-800 text-sm">Faturamento</div>
      <div class="text-2xl font-bold" id="faturamento">R$ 0</div>
    </div>
    <div class="bg-yellow-100 p-4 rounded-xl">
      <div class="text-yellow-800 text-sm">Processos</div>
      <div class="text-2xl font-bold" id="processos">0</div>
    </div>
  </div>

  <script>
    const PRECOS = ${JSON.stringify(WDESPACHANTE.honorarios)};
    const TAXA_DETRAN = ${WDESPACHANTE.taxas_detran['014-0']};

    async function loadData() {
      const [msgRes, orcRes] = await Promise.all([
        fetch('/api/mensagens'),
        fetch('/api/orcamentos')
      ]);
      const msgs = await msgRes.json();
      const orcs = await orcRes.json();
      
      renderMensagens(msgs);
      renderOrcamentos(orcs);
      renderPrecos();
      updateStats(orcs);
    }

    function renderMensagens(msgs) {
      const c = document.getElementById('mensagens');
      document.getElementById('msg-count').textContent = msgs.length;
      if (!msgs.length) {
        c.innerHTML = '<div class="text-center py-8 text-gray-400">Nenhuma mensagem</div>';
        return;
      }
      c.innerHTML = msgs.slice(0, 20).map(m => \`
        <div class="p-3 bg-gray-50 rounded-lg border-l-4 \${m.is_client ? 'border-green-500' : 'border-gray-300'}">
          <div class="flex justify-between text-sm">
            <span class="font-medium">\${m.phone || '?'}</span>
            <span class="text-gray-500">\${new Date(m.created_at).toLocaleTimeString()}</span>
          </div>
          <p class="text-gray-700 mt-1">"\${(m.text || '').substring(0,60)}"</p>
          \${m.category ? \`<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">\${m.category}</span>\` : ''}
        </div>
      \`).join('');
    }

    function renderOrcamentos(orcs) {
      const c = document.getElementById('orcamentos');
      if (!orcs.length) {
        c.innerHTML = '<div class="text-center py-8 text-gray-400">Nenhum orçamento</div>';
        return;
      }
      c.innerHTML = orcs.slice(0, 20).map(o => \`
        <div class="p-3 bg-green-50 rounded-lg border-l-4 border-green-500">
          <div class="flex justify-between text-sm">
            <span class="font-medium">\${o.cliente || o.phone}</span>
            <span class="text-green-700 font-bold">R\$ \${o.total.toFixed(2)}</span>
          </div>
          <p class="text-gray-600 text-sm">\${o.servico} - \${o.placa || 'sem placa'}</p>
          <span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">\${o.status}</span>
        </div>
      \`).join('');
    }

    function renderPrecos() {
      let html = '<table class="w-full text-sm"><thead><tr class="bg-gray-100"><th class="p-2 text-left">Serviço</th><th class="p-2 text-right">Honorário</th><th class="p-2 text-right">Taxa</th><th class="p-2 text-right">Total</th></tr></thead><tbody>';
      Object.entries(PRECOS).forEach(([k, v]) => {
        html += \`<tr class="border-b"><td class="p-2">\${k.replace(/_/g, ' ')}</td><td class="p-2 text-right">R\$ \${v.toFixed(2)}</td><td class="p-2 text-right">R\$ \${TAXA_DETRAN.toFixed(2)}</td><td class="p-2 text-right font-bold">R\$ \${(v + TAXA_DETRAN).toFixed(2)}</td></tr>\`;
      });
      html += '</tbody></table>';
      document.getElementById('precos').innerHTML = html;
    }

    function updateStats(orcs) {
      document.getElementById('orc-hoje').textContent = orcs.length;
      document.getElementById('cli-ativos').textContent = new Set(orcs.map(o => o.phone)).size;
      document.getElementById('faturamento').textContent = 'R$ ' + orcs.reduce((s, o) => s + o.total, 0).toFixed(0);
      document.getElementById('processos').textContent = orcs.filter(o => o.status !== 'cancelado').length;
    }

    document.addEventListener('DOMContentLoaded', loadData);
    setInterval(loadData, 30000);
  </script>
</body>
</html>
  `);
});

// API: Mensagens
app.get('/api/mensagens', (req, res) => {
  db.all('SELECT * FROM mensagens ORDER BY created_at DESC LIMIT 50', (err, rows) => {
    res.json(rows || []);
  });
});

// API: Orçamentos
app.get('/api/orcamentos', (req, res) => {
  db.all('SELECT * FROM orcamentos ORDER BY created_at DESC LIMIT 50', (err, rows) => {
    res.json(rows || []);
  });
});

// API: Preços
app.get('/api/precos', (req, res) => {
  res.json({
    honorarios: WDESPACHANTE.honorarios,
    taxas: WDESPACHANTE.taxas_detran,
    prazos: WDESPACHANTE.prazos
  });
});

// API: Gerar Orçamento
app.post('/api/orcamento', async (req, res) => {
  const { phone, cliente, veiculo, placa, servico } = req.body;
  const honorario = WDESPACHANTE.honorarios[servico] || 450;
  const taxa = WDESPACHANTE.taxas_detran['014-0'] || 209.78;
  const prazo = WDESPACHANTE.prazos[servico] || '5-7';

  db.run(\`INSERT INTO orcamentos (phone, cliente, veiculo, placa, servico, honorario, taxa_detran, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
    [phone, cliente, veiculo, placa, servico, honorario, taxa, honorario + taxa, 'gerado'],
    function(err) {
      if (err) res.status(500).json({ error: err.message });
      else res.json({
        id: this.lastID,
        honorario,
        taxa,
        total: honorario + taxa,
        prazo: prazo + ' dias úteis',
        template: WDESPACHANTE.templates.orcamento({ nome: cliente, placa, servico, honorario, taxa, total: honorario + taxa, prazo })
      });
    });
});

// API: Webhook Z-API
app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  processMessage(req.body);
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'wdespachante-v2.1',
    version: '2.1.0',
    agent: 'integrated',
    services: Object.keys(WDESPACHANTE.honorarios).length,
    uptime: process.uptime()
  });
});

// Debug
app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos', (err, o) => {
      res.json({
        mensagens: m[0]?.c || 0,
        orcamentos: o[0]?.c || 0,
        timestamp: new Date().toISOString()
      });
    });
  });
});

// Teste
app.post('/test', (req, res) => {
  processMessage({
    phone: '5511999999999',
    text: { message: req.body.text || 'Teste v2.1' },
    type: 'ReceivedCallback'
  });
  res.json({ status: 'test_sent' });
});

// ==================== PROCESSAMENTO ====================
async function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const text = payload.text?.message || payload.message?.text || '';
  const type = payload.type || 'ReceivedCallback';
  const isGroup = payload.isGroup || false;

  console.log(\`📱 [${phone}] ${text.substring(0, 50)}...\`);

  // Classificar
  const cat = classifyMessage(text, type, isGroup);

  if (cat.isClient) {
    db.run(\`INSERT INTO mensagens (phone, text, category, is_client) VALUES (?, ?, ?, ?)\`,
      [phone, text, cat.category, 1],
      function(err) {
        if (err) console.error(err);
        else {
          console.log(\`💾 MSG #\${this.lastID}: \${cat.category}\`);
          analyzeWithAgent(this.lastID, phone, text, cat);
        }
      });
  }
}

function classifyMessage(text, type, isGroup) {
  const lower = text.toLowerCase();
  if (isGroup) return { category: 'grupo', isClient: false };
  if (type === 'MessageTemplate') return { category: 'template', isClient: false };

  const keywords = {
    'transferencia': ['transferir', 'transferência', 'compra', 'vendi'],
    'licenciamento': ['ipva', 'licenciamento', 'licença', 'detran'],
    'multa': ['multa', 'infração', 'ponto'],
    'crlv': ['crlv', 'documento', '2ª via', 'segunda via'],
    'gravame': ['gravame', 'financiamento', 'baixa'],
    'vistoria': ['vistoria', 'laudo']
  };

  for (const [cat, words] of Object.entries(keywords)) {
    if (words.some(w => lower.includes(w))) {
      return { category: cat, isClient: true, servico: cat };
    }
  }

  return { category: 'consulta', isClient: true };
}

async function analyzeWithAgent(msgId, phone, text, classification) {
  // Usar regras WDESPACHANTE + Gemini para resposta
  const prompt = buildAgentPrompt(text, classification);
  
  try {
    const res = await axios.post(
      \`https://generativelanguage.googleapis.com/v1beta/models/\${GEMINI_MODEL}:generateContent?key=\${GEMINI_API_KEY}\`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 15000 }
    );

    if (res.status === 200) {
      const response = res.data.candidates[0].content.parts[0].text;
      db.run('UPDATE mensagens SET agent_response = ? WHERE id = ?', [response, msgId]);
      console.log(\`🤖 Agente: \${response.substring(0, 60)}...\`);
    }
  } catch (e) {
    console.error('Erro agente:', e.message);
    const fallback = generateFallback(text, classification);
    db.run('UPDATE mensagens SET agent_response = ? WHERE id = ?', [fallback, msgId]);
  }
}

function buildAgentPrompt(text, classification) {
  return \`
Você é Wellington, dono do WDespachante (18 anos, RJ).

REGRAS:
- Transferência: R$ 450 + taxa R$ 209,78
- Licenciamento: R$ 150-250 + taxa R$ 209,78
- Pagamento: PIX antecipado, sem desconto
- Parcelamento: InfinitePay

Cliente disse: "\${text}"
Classificação: \${classification.category}

Responda de forma amigável e profissional, como Wellington falaria.
Sugira próximos passos.
\`.trim();
}

function generateFallback(text, classification) {
  const templates = {
    'transferencia': \`Olá! Para transferência, preciso:
- CRLV vigente
- CNH/RG + CPF
- Comprovante residência

Honorário: R$ 450 + taxa DETRAN R$ 209,78

Quer seguir?\`,
    'licenciamento': \`Olá! Para licenciamento, preciso do CRLV.
Serviço: R$ 150-250 + taxa DETRAN.

Posso ajudar?\`,
    'consulta': \`Olá! Como posso te ajudar com seu veículo?\`
  };
  return templates[classification.category] || templates['consulta'];
}

// ==================== INICIAR ====================
app.listen(PORT, () => {
  console.log(\`🚀 WDespachante v2.1 Agent rodando na porta \${PORT}\`);
  console.log(\`📋 \${Object.keys(WDESPACHANTE.honorarios).length} serviços\`);
  console.log(\`💰 Transferência: R\$ \${WDESPACHANTE.honorarios.transferencia}\`);
  console.log(\`🏦 Taxa DETRAN: R\$ \${WDESPACHANTE.taxas_detran['014-0']}\`);
});

// Keep-alive
if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('🫀'), 5 * 60 * 1000);
}