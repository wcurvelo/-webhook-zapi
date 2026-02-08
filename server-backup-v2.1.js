// server-wdespachante.js - Webhook Z-API com Regras WDESPachante v2.1
// Prompt completo integrado - Preços e regras atualizados

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURAÇÕES ====================
const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

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
    '001-9': 209.78,  // Primeira Licença - Veículo Zero KM
    '002-7': 209.78,  // Alteração de Características
    '003-5': 209.78,  // Segunda Via CRV/CRLV
    '004-3': 209.78,  // Alteração de Categoria
    '007-8': 93.26,   // Pedido Informação
    '008-6': 209.78,  // Baixa de Veículo
    '009-4': 209.78,  // Vistoria Regularização
    '014-0': 209.78,  // Transferência de Propriedade
    '016-7': 251.74,  // Vistoria Móvel/Transito
    '018-3': 233.09,  // Inclusão/Baixa Financiamento
    '019-1': 419.55,  // Remarcação de Chassi
    '020-5': 2051.08, // Placa Experiência
    '023-0': 209.78,  // Emplacamento Fora
    '037-0': 250.95,  // Duas Placas Mercosul
    '038-8': 125.45,  // Uma Placa Mercosul
    '041-8': 76.84    // Uma Placa Mercosul Moto
  },
  
  // PRAZOS (dias úteis)
  prazos: {
    'transferencia': '5-7',
    'licenciamento': '3-5',
    'segunda_via_crv': '5-7',
    'comunicacao_venda': '1-2',
    'baixa_gravame': '5-7',
    'troca_placa': '5-7',
    'mudanca_endereco': '5-7',
    'transferencia_jurisdicao': '7-15',
    'alteracao_caracteristicas': '5-7'
  },
  
  // DOCUMENTOS POR SERVIÇO
  documentos: {
    'transferencia': {
      vendedor: ['CRV original assinado com firma reconhecida', 'Cópia CNH/RG', 'CPF', 'Comprovante residência (90 dias)'],
      comprador: ['Cópia CNH/RG', 'CPF', 'Comprovante residência (90 dias)'],
      veiculo: ['CRLV vigente', 'Quitação débitos']
    },
    'licenciamento': {
      required: ['CRLV anterior', 'Comprovante quitação IPVA', 'Comprovante quitação multas'],
      optional: ['Laudo de vistoria (se necessário)']
    },
    'comunicacao_venda': {
      required: ['Cópia CRV frente/verso', 'Cópia CNH/RG', 'Dados completos comprador', 'Data da venda']
    },
    'baixa_gravame': {
      required: ['Carta anuência banco (original)', 'Cópia CNH/RG', 'CRLV atual', 'Comprovante quitação financiamento']
    }
  },
  
  // TEMPLATES DE MENSAGENS
  templates: {
    boas_vindas: 'Olá! Seja bem-vindo(a) à WDespachante! Como posso te ajudar hoje?',
    
    primeiro_contato: `Olá {nome}! Tudo bem? Vi sua mensagem sobre {servico}. 
Para eu consultar débitos e restrições, pode me enviar:
- Placa
- RENAVAM  
- CPF do proprietário

Se preferir, manda uma foto do CRLV/CRV bem nítida!`,
    
    orcamento: `*{nome}*, aqui está seu orçamento!

*Veículo:* {placa} - {modelo}
*Serviço:* {servico}

*VALORES:*
├─ Honorários: R$ {honorario:.2f}
├─ Taxa DETRAN: R$ {taxa:.2f}
└─ *TOTAL: R$ {total:.2f}

*Documentos necessários:*
{documentos}

*Prazo:* {prazo} dias úteis

*Pagamento:* Antecipado via PIX
{link_infinite}

Posso dar andamento?`,
    
    aguardando_pagamento: `{nome}, documentação aprovada! 

Para dar entrada no DETRAN, preciso do pagamento antecipado:
*Total: R$ {valor}*

*PIX:* {chave_pix}

Assim que confirmar, já protocolo! 📋`,
    
    processo_protocolado: `{nome}, boa notícia! 

Seu processo de *{servico}* foi protocolado no DETRAN! ✅

*Status:* Em andamento
*Prazo estimado:* {prazo} dias úteis

Te aviso qualquer novidade!`,
    
    processo_concluido: `{nome}, *CONCLUÍDO!* 🎉

Seu *{servico}* foi finalizado com sucesso!

{detalhes}

Foi um prazer te atender! 😊`
  },
  
  // REGRA DE PAGAMENTO
  regras_pagamento: {
    pagamento_antecipado: true,
    desconto_nao_disponivel: true,
    parcelamento_url: 'https://www.infinitepay.io/'
  }
};

// ==================== BANCO DE DADOS ====================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Erro DB:', err.message);
  else { console.log('DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_wd (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      text_message TEXT,
      message_category TEXT,
      is_client BOOLEAN,
      gemini_analysis TEXT,
      resposta_gerada TEXT,
      resposta_aprovada TEXT,
      approved_at TIMESTAMP,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      service_type TEXT,
      budget_value REAL,
      status TEXT DEFAULT 'novo'
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS orcamentos_wd (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_nome TEXT,
      cliente_phone TEXT,
      veiculo_placa TEXT,
      servico TEXT,
      honorarios REAL,
      taxa_detran REAL,
      total REAL,
      documentos TEXT,
      prazo TEXT,
      status TEXT DEFAULT 'enviado',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ==================== MIDDLEWARE ====================
app.use(bodyParser.json({ limit: '50mb' }));

// ==================== ENDPOINTS ====================

// Dashboard WDESPACHANTE v2.1
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>WDespachante Dashboard v2.1</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-gray-50 min-h-screen p-8">
  <div class="max-w-7xl mx-auto">
    <!-- Header -->
    <div class="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl shadow-lg p-6 mb-6 text-white">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-3xl font-bold">
            <i class="fas fa-car-side mr-3"></i>
            WDespachante v2.1
          </h1>
          <p class="text-blue-200 mt-2">
            <i class="fas fa-map-marker-alt mr-2"></i>
            Av. Treze de Maio, 23 - Centro, RJ
            <i class="fas fa-phone ml-4 mr-2"></i>
            (21) 96447-4147
          </p>
        </div>
        <div class="text-right">
          <div class="bg-white/20 px-4 py-2 rounded-lg">
            <span class="text-2xl font-bold">18 anos</span>
            <div class="text-sm">de experiência</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Mensagens Hoje</div>
        <div class="text-2xl font-bold text-blue-600" id="stat-msg">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Orçamentos</div>
        <div class="text-2xl font-bold text-green-600" id="stat-orc">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Processos</div>
        <div class="text-2xl font-bold text-purple-600" id="stat-proc">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Faturamento</div>
        <div class="text-2xl font-bold text-yellow-600" id="stat-fat">R$ 0</div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="bg-white rounded-xl shadow p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-bolt mr-2"></i>Ações Rápidas
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button onclick="testBudget()" class="p-4 bg-green-100 text-green-800 rounded-lg hover:bg-green-200">
          <i class="fas fa-calculator mr-2"></i>Orçamento
        </button>
        <button onclick="testMessage()" class="p-4 bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200">
          <i class="fas fa-comment mr-2"></i>Testar Msg
        </button>
        <button onclick="showPrices()" class="p-4 bg-purple-100 text-purple-800 rounded-lg hover:bg-purple-200">
          <i class="fas fa-list mr-2"></i>Ver Preços
        </button>
        <button onclick="loadStats()" class="p-4 bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200">
          <i class="fas fa-sync mr-2"></i>Atualizar
        </button>
      </div>
    </div>

    <!-- Messages & Budget -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow p-6">
        <h2 class="text-xl font-bold text-gray-800 mb-4">
          <i class="fas fa-comments mr-2"></i>Mensagens
        </h2>
        <div id="messages-container" class="space-y-4 max-h-96 overflow-y-auto">
          <div class="text-center py-8 text-gray-500">Carregando...</div>
        </div>
      </div>
      
      <div class="bg-white rounded-xl shadow p-6">
        <h2 class="text-xl font-bold text-gray-800 mb-4">
          <i class="fas fa-file-invoice-dollar mr-2"></i>Orçamento Gerado
        </h2>
        <div id="budget-preview" class="bg-gray-50 rounded-lg p-4 font-mono text-sm">
          Selecione um serviço para gerar orçamento...
        </div>
      </div>
    </div>

    <!-- Preços -->
    <div id="prices-section" class="hidden bg-white rounded-xl shadow p-6 mt-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-tags mr-2"></i>Tabela de Preços v2.1
      </h2>
      <div id="prices-table" class="overflow-x-auto"></div>
    </div>
  </div>

  <script>
    const WD = ${JSON.stringify(WDESPACHANTE, null, 2)};
    
    async function loadMessages() {
      const res = await fetch('/api/messages?limit=10');
      const data = await res.json();
      renderMessages(data.messages);
    }
    
    function renderMessages(msgs) {
      const c = document.getElementById('messages-container');
      if (!msgs.length) {
        c.innerHTML = '<div class="text-center py-8 text-gray-500">Nenhuma mensagem</div>';
        return;
      }
      c.innerHTML = msgs.map(m => {
        const a = m.gemini_analysis ? JSON.parse(m.gemini_analysis) : {};
        return \`
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="flex justify-between text-sm mb-1">
              <span class="font-medium">\${m.phone || '?'}</span>
              <span class="text-gray-500">\${new Date(m.received_at).toLocaleString()}</span>
            </div>
            <p class="text-gray-800">"\${m.text_message?.substring(0,80)}"</p>
            \${a.tipo_servico ? \`<div class="mt-2 text-sm">
              <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">\${a.tipo_servico}</span>
              <span class="text-gray-500">\${Math.round((a.confianca || 0) * 100)}%</span>
            </div>\` : ''}
          </div>
        \`;
      }).join('');
    }
    
    function testMessage() {
      fetch('/test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ text: 'Olá, quanto custa transferir meu carro?' })
      }).then(() => {
        loadMessages();
        alert('Mensagem de teste enviada!');
      });
    }
    
    function testBudget() {
      const budget = generateBudget('transferencia', 'Honda Civic 2020', 'ABC1234');
      document.getElementById('budget-preview').innerHTML = budget;
    }
    
    function showPrices() {
      const s = document.getElementById('prices-section');
      s.classList.toggle('hidden');
      if (!s.classList.contains('hidden')) {
        let html = '<table class="w-full text-sm"><thead><tr class="bg-gray-100"><th class="p-2 text-left">Serviço</th><th class="p-2 text-right">Honorário</th><th class="p-2 text-right">Taxa</th></tr></thead><tbody>';
        Object.entries(WD.honorarios).forEach(([k, v]) => {
          const taxa = WD.taxas_detran['014-0'] || 209.78;
          html += \`<tr class="border-b"><td class="p-2">\${k.replace(/_/g, ' ')}</td><td class="p-2 text-right">R\$ \${v.toFixed(2)}</td><td class="p-2 text-right">R\$ \${taxa.toFixed(2)}</td></tr>\`;
        });
        html += '</tbody></table>';
        document.getElementById('prices-table').innerHTML = html;
      }
    }
    
    function generateBudget(servico, veiculo, placa) {
      const honorario = WD.honorarios[servico] || 450;
      const taxa = WD.taxas_detran['014-0'] || 209.78;
      const total = honorario + taxa;
      const prazo = WD.prazos[servico] || '5-7';
      
      return \`
═══════════════════════════════════════
           ORÇAMENTO WDESPACHANTE
═══════════════════════════════════════

Cliente: [Nome]
Veículo: \${veiculo} - \${placa}
Serviço: \${servico.replace(/_/g, ' ')}

VALORES:
├─ Honorários: R\$ \${honorario.toFixed(2)}
├─ Taxa DETRAN: R\$ \${taxa.toFixed(2)}
└─ TOTAL: R\$ \${total.toFixed(2)}

PRAZO: \${prazo} dias úteis

PAGAMENTO:
- PIX antecipado
- Parcelamento: InfinitePay

DOCUMENTOS:
- CRLV vigente
- CNH/RG + CPF
- Comprovante residência

═══════════════════════════════════════
WDespachante - 18 anos de experiência
\${WD.endereco}
\${WD.whatsapp}
      \`.trim();
    }
    
    function loadStats() {
      fetch('/stats').then(r => r.json()).then(data => {
        document.getElementById('stat-msg').textContent = data.messages;
        document.getElementById('stat-orc').textContent = data.budgets;
        document.getElementById('stat-proc').textContent = data.processos;
        document.getElementById('stat-fat').textContent = 'R$ ' + data.faturamento.toFixed(0);
      });
      loadMessages();
    }
    
    document.addEventListener('DOMContentLoaded', loadStats);
  </script>
</body>
</html>
  `);
});

// API: Mensagens
app.get('/api/messages', (req, res) => {
  db.all('SELECT * FROM mensagens_wd ORDER BY received_at DESC LIMIT 20', (err, rows) => {
    res.json({ messages: rows || [] });
  });
});

// API: Stats
app.get('/stats', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens_wd', (err, m) => {
    db.all('SELECT COUNT(*) as c FROM orcamentos_wd', (err, o) => {
      db.all('SELECT SUM(total) as s FROM orcamentos_wd WHERE status = "concluido"', (err, f) => {
        res.json({
          messages: m[0]?.c || 0,
          budgets: o[0]?.c || 0,
          processos: o[0]?.c || 0,
          faturamento: f[0]?.s || 0
        });
      });
    });
  });
});

// API: Teste
app.post('/test', (req, res) => {
  processMessage({ phone: '5511999999999', text: { message: req.body.text || 'Teste' }, type: 'ReceivedCallback' });
  res.json({ status: 'ok' });
});

// Health
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'webhook-wdespachante-v2.1',
    version: '2.1.0',
    rules: Object.keys(WDESPACHANTE.honorarios).length + ' serviços'
  });
});

// Webhook
app.post('/webhook', (req, res) => {
  res.status(200).json({ received: true });
  setTimeout(() => processMessage(req.body), 100);
});

// Debug
app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as c FROM mensagens_wd', (err, r) => {
    res.json({ messages: r[0]?.c || 0, timestamp: new Date().toISOString() });
  });
});

// ==================== PROCESSAMENTO ====================
function processMessage(payload) {
  const phone = payload.phone || 'unknown';
  const text = payload.text?.message || payload.message?.text || '';
  const type = payload.type || 'ReceivedCallback';
  const isGroup = payload.isGroup || false;
  
  console.log(\`📱 [\${phone}] \${text.substring(0,50)}...\`);
  
  // Classificar
  const cat = classifyMessage(text, type, isGroup);
  
  if (cat.isClient) {
    db.run(\`INSERT INTO mensagens_wd (phone, text_message, type, is_group, message_category, is_client) VALUES (?, ?, ?, ?, ?, ?)\`,
      [phone, text, type, isGroup ? 1 : 0, cat.category, 1], function(err) {
        if (err) console.error(err);
        else {
          console.log(\`💾 Salvou #\${this.lastID} como \${cat.category}\`);
          analyzeWithGemini(this.lastID, text);
        }
      });
  }
}

function classifyMessage(text, type, isGroup) {
  const lower = text.toLowerCase();
  if (isGroup) return { category: 'grupo', isClient: false };
  if (type === 'MessageTemplate') return { category: 'anuncio', isClient: false };
  
  const adKeywords = ['promoção', 'desconto', 'oferta', 'liquidação', 'clique aqui'];
  if (adKeywords.some(k => lower.includes(k))) return { category: 'anuncio', isClient: false };
  
  const clientKeywords = ['oi', 'olá', 'preciso', 'gostaria', 'quanto custa', 'valor', 'transferir', 'ipva', 'multa'];
  if (clientKeywords.some(k => lower.includes(k))) return { category: 'cliente', isClient: true };
  
  return { category: 'outros', isClient: false };
}

async function analyzeWithGemini(msgId, text) {
  try {
    // PROMPT INTEGRADO COM REGRAS WDESPACHANTE
    const prompt = \`
Você é Wellington, dono do WDespachante (18 anos de experiência, RJ).

REGRAS WDESPACHANTE v2.1:
- Honorários: Transferência R$ 450, Licenciamento R$ 150-250, ATPV R$ 250
- Taxa DETRAN: R$ 209,78 (código 014-0)
- Prazo transferência: 5-7 dias úteis
- Pagamento: PIX antecipado, sem desconto
- Parcelamento: InfinitePay

Analise: "\${text}"

Responda JSON:
{
  "tipo_servico": "transferencia|licenciamento|multas|crlv|outros",
  "confianca": 0.0-1.0,
  "documentos_necessarios": ["lista"],
  "resposta_sugerida": "tom amigável, direto, com emoji"
}\`;

    const res = await axios.post(
      \`https://generativelanguage.googleapis.com/v1beta/models/\${GEMINI_MODEL}:generateContent?key=\${GEMINI_API_KEY}\`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 500 } },
      { timeout: 10000 }
    );

    if (res.status === 200) {
      const txt = res.data.candidates[0].content.parts[0].text;
      let a = {};
      try {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) a = JSON.parse(m[0]);
      } catch(e) {}
      
      db.run(\`UPDATE mensagens_wd SET gemini_analysis = ?, resposta_gerada = ? WHERE id = ?\`,
        [JSON.stringify(a), a.resposta_sugerida || '', msgId]);
      
      console.log(\`🧠 \${a.tipo_servico} (\${Math.round((a.confianca || 0) * 100)}%) - "\${a.resposta_sugerida?.substring(0,50)}"\`);
    }
  } catch (e) {
    console.error('Erro Gemini:', e.message);
    const fb = fallbackAnalysis(text);
    db.run(\`UPDATE mensagens_wd SET gemini_analysis = ?, resposta_gerada = ? WHERE id = ?\`,
      [JSON.stringify(fb), fb.resposta_sugerida, msgId]);
  }
}

function fallbackAnalysis(text) {
  const lower = text.toLowerCase();
  if (lower.includes('transfer')) 
    return { tipo_servico: 'transferencia', confianca: 0.9, documentos_necessarios: ['CRLV', 'CNH', 'Comprovante'], resposta_sugerida: 'Olá! Para transferência, preciso do CRLV, CNH e comprovante. Honorários R$ 450 + taxa DETRAN R$ 209,78. Posso seguir?' };
  if (lower.includes('ipva') || lower.includes('licenciamento')) 
    return { tipo_servico: 'licenciamento', confianca: 0.9, documentos_necessarios: ['CRLV'], resposta_sugerida: 'Olá! Para licenciamento, preciso do CRLV. Serviço R$ 150-250 + taxa. Posso ajudar?' };
  if (lower.includes('multa')) 
    return { tipo_servico: 'multas', confianca: 0.8, documentos_necessarios: ['Auto infração'], resposta_sugerida: 'Olá! Para recursos de multa, me mande foto do auto de infração. Analiso pra você!' };
  return { tipo_servico: 'outros', confianca: 0.3, documentos_necessarios: [], resposta_sugerida: 'Olá! Como posso te ajudar com seu veículo?' };
}

// INICIAR
app.listen(PORT, () => {
  console.log(\`🚀 WDespachante v2.1 rodando na porta \${PORT}\`);
  console.log(\`📋 \${Object.keys(WDESPACHANTE.honorarios).length} serviços configurados\`);
  console.log(\`💰 Transferência: R\$ \${WDESPACHANTE.honorarios.transferencia}\`);
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('🫀'), 5 * 60 * 1000);
}