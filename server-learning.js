// server-learning.js - Webhook com APRENDIZADO do seu estilo
// Salva suas respostas como exemplos para treinar o Gemini

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração
const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

// Seu perfil de atendimento (vai sendo aprendido)
const ATTENDANT_PROFILE = {
  name: 'Wellington',
  business: 'WDespachante',
  style: {
    tone: 'simpatico_direto',
    emojis: 'moderado',
    values: 'sempre_menciona',
    structure: 'resposta_objetiva'
  },
  examples: [],
  learned_from: 0
};

// Conectar banco
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Erro DB:', err.message);
  else { console.log('DB:', DB_PATH); criarTabelas(); }
});

function criarTabelas() {
  // Tabela mensagens (igual anterior)
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_zapi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT, text_message TEXT, message_category TEXT,
      is_client BOOLEAN, is_announcement BOOLEAN, priority INTEGER,
      gemini_analysis TEXT, resposta_gerada TEXT, processed BOOLEAN,
      resposta_aprovada TEXT, -- SUA RESPOSTA (para treinar)
      approved_by TEXT DEFAULT 'wellington',
      approved_at TIMESTAMP,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    )
  `, (err) => {
    if (err) console.error('Erro criar tabela:', err);
    else console.log('Tabela mensagens pronta');
  });

  // Tabela de EXEMPLOS do seu estilo (NOVA)
  db.run(`
    CREATE TABLE IF NOT EXISTS attendant_style_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT,
      original_prompt TEXT,
      gemini_response TEXT,
      attendant_response TEXT, -- SUA RESPOSTA
      quality_score INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Erro criar tabela style:', err);
    else console.log('Tabela attendant_style_examples pronta');
  });

  // Carregar exemplos salvos
  loadExamples();
}

function loadExamples() {
  db.all('SELECT * FROM attendant_style_examples ORDER BY created_at DESC LIMIT 20', (err, rows) => {
    if (!err && rows && rows.length > 0) {
      ATTENDANT_PROFILE.examples = rows;
      ATTENDANT_PROFILE.learned_from = rows.length;
      console.log(`📚 Carregados ${rows.length} exemplos do seu estilo`);
    }
  });
}

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));

// ==================== ENDPOINTS ====================

// Dashboard completo
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>WDespachante Dashboard v3.0 - Aprendizado</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    .msg-cliente { border-left: 4px solid #10B981; }
    .msg-grupo { border-left: 4px solid #EF4444; background: #FEF2F2; }
    .msg-anuncio { border-left: 4px solid #8B5CF6; background: #F5F3FF; }
    .msg-aprovado { border-left: 4px solid #3B82F6; background: #EFF6FF; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body class="bg-gray-50 p-8">
  <div class="max-w-7xl mx-auto">
    <!-- Header -->
    <div class="bg-white rounded-xl shadow p-6 mb-6">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">
            <i class="fas fa-graduation-cap text-blue-600 mr-3"></i>
            Dashboard WDespachante v3.0
          </h1>
          <p class="text-gray-600 mt-2">
            Com <span class="text-blue-600 font-bold">APRENDIZADO DO SEU ESTILO</span>
          </p>
        </div>
        <div class="text-right">
          <div class="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-lg">
            <i class="fas fa-brain mr-2"></i>
            <span id="learned-count">0</span> exemplos aprendidos
          </div>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Clientes</div>
        <div class="text-2xl font-bold text-green-600" id="stat-cliente">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Grupos</div>
        <div class="text-2xl font-bold text-red-600" id="stat-grupo">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Anúncios</div>
        <div class="text-2xl font-bold text-purple-600" id="stat-anuncio">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Aprovados</div>
        <div class="text-2xl font-bold text-blue-600" id="stat-aprovado">0</div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow">
        <div class="text-gray-500 text-sm">Precisão Gemini</div>
        <div class="text-2xl font-bold" id="stat-precisao">0%</div>
      </div>
    </div>

    <!-- Seu Perfil de Atendimento -->
    <div class="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl shadow p-6 mb-6 text-white">
      <h2 class="text-xl font-bold mb-4">
        <i class="fas fa-user-tie mr-2"></i>
        Seu Perfil de Atendimento
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div class="text-blue-200 text-sm">Tom</div>
          <div class="font-bold">Simpático mas Direto</div>
        </div>
        <div>
          <div class="text-blue-200 text-sm">Emojis</div>
          <div class="font-bold">Moderado (✅, 📋, 💰)</div>
        </div>
        <div>
          <div class="text-blue-200 text-sm">Exemplos</div>
          <div class="font-bold" id="profile-examples">0</div>
        </div>
        <div>
          <div class="text-blue-200 text-sm">Status</div>
          <div class="font-bold"><span class="pulse">●</span> Aprendendo</div>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div class="bg-white rounded-xl shadow p-6 mb-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-gray-800">
          <i class="fas fa-comments mr-2"></i>Mensagens
        </h2>
        <button onclick="loadMessages()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <i class="fas fa-sync-alt mr-2"></i>Atualizar
        </button>
      </div>
      <div id="messages-container" class="space-y-4">
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-comment-dots text-4xl mb-4"></i>
          <p>Carregando mensagens...</p>
        </div>
      </div>
    </div>

    <!-- Seus Exemplos -->
    <div class="bg-white rounded-xl shadow p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-book mr-2"></i>Seus Exemplos de Atendimento
      </h2>
      <div id="examples-container" class="space-y-4">
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-graduation-cap text-4xl mb-4"></i>
          <p>Aprove respostas para criar sua base de exemplos</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function loadMessages() {
      try {
        const res = await fetch('/api/messages?limit=30');
        const data = await res.json();
        renderMessages(data.messages);
        updateStats(data.messages);
        renderExamples();
      } catch (e) {
        console.error('Erro:', e);
      }
    }

    function renderMessages(messages) {
      const container = document.getElementById('messages-container');
      if (!messages.length) {
        container.innerHTML = '<div class="text-center py-12 text-gray-500"><i class="fas fa-inbox text-4xl mb-4"></i><p>Nenhuma mensagem</p></div>';
        return;
      }
      container.innerHTML = messages.map(msg => {
        const cat = msg.message_category || 'outros';
        const cls = 'msg-' + (msg.resposta_aprovada ? 'aprovado' : cat);
        const badge = getBadge(cat);
        const analysis = msg.gemini_analysis ? JSON.parse(msg.gemini_analysis) : null;
        const conf = analysis ? Math.round(analysis.confianca * 100) : 0;
        const resposta = msg.resposta_aprovada || analysis?.resposta_sugerida || '';
        
        return \`
          <div class="\${cls} rounded-lg border p-4">
            <div class="flex justify-between items-start mb-2">
              <div class="flex items-center">
                \${badge}
                <span class="text-sm text-gray-500 ml-2">\${msg.phone || 'Desconhecido'}</span>
              </div>
              <span class="text-xs text-gray-400">\${new Date(msg.received_at).toLocaleString()}</span>
            </div>
            <p class="text-gray-800 mb-3">"\${msg.text_message?.substring(0,100)}"</p>
            \${analysis ? \`
              <div class="bg-gray-50 rounded p-3 mb-3">
                <div class="flex justify-between text-sm mb-1">
                  <span class="font-medium">\${analysis.tipo_servico}</span>
                  <span class="text-gray-500">\${conf}% confiança</span>
                </div>
                <p class="text-gray-700 text-sm">\${resposta?.substring(0,150)}\${resposta?.length > 150 ? '...' : ''}</p>
              </div>
            \` : ''}
            <div class="flex gap-2">
              \${!msg.resposta_aprovada ? \`
                <button onclick="openApproval(\${msg.id}, \`\${msg.text_message}\`, \`\${escapeHtml(analysis?.resposta_sugerida || '')}\`)" 
                        class="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  <i class="fas fa-check mr-1"></i>Aprovar/Editar
                </button>
              \` : \`
                <span class="px-3 py-1 bg-green-100 text-green-800 rounded text-sm">
                  <i class="fas fa-check-circle mr-1"></i>Aprovado
                </span>
              \`}
              <button onclick="deleteMessage(\${msg.id})" class="px-3 py-1 bg-red-100 text-red-800 rounded text-sm hover:bg-red-200">
                <i class="fas fa-trash mr-1"></i>Excluir
              </button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function updateStats(messages) {
      const stats = { cliente: 0, grupo: 0, anuncio: 0, aprovado: 0, confTotal: 0, confCount: 0 };
      messages.forEach(m => {
        if (m.message_category) stats[m.message_category] = (stats[m.message_category] || 0) + 1;
        if (m.resposta_aprovada) stats.aprovado++;
        if (m.gemini_analysis) {
          try { stats.confTotal += JSON.parse(m.gemini_analysis).confianca; stats.confCount++; } catch(e) {}
        }
      });
      document.getElementById('stat-cliente').textContent = stats.cliente;
      document.getElementById('stat-grupo').textContent = stats.grupo;
      document.getElementById('stat-anuncio').textContent = stats.anuncio;
      document.getElementById('stat-aprovado').textContent = stats.aprovado;
      document.getElementById('stat-precisao').textContent = stats.confCount ? Math.round((stats.confTotal / stats.confCount) * 100) + '%' : '0%';
      document.getElementById('learned-count').textContent = stats.aprovado;
      document.getElementById('profile-examples').textContent = stats.aprovado;
    }

    function renderExamples() {
      document.getElementById('examples-container').innerHTML = \`
        <div class="bg-blue-50 rounded-lg p-4">
          <p class="text-blue-800">
            <i class="fas fa-lightbulb mr-2"></i>
            <strong>Dica:</strong> A cada resposta que você aprovar/editar, o sistema aprende seu estilo!
          </p>
        </div>
        <div class="text-gray-500 text-center py-8">
          <i class="fas fa-book text-4xl mb-4"></i>
          <p>Aprove respostas para construir sua base de exemplos</p>
        </div>
      \`;
    }

    function getBadge(cat) {
      const badges = {
        'cliente': '<span class="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold">CLIENTE</span>',
        'grupo': '<span class="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-bold">GRUPO</span>',
        'anuncio': '<span class="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">ANÚNCIO</span>',
        'outros': '<span class="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs font-bold">OUTROS</span>'
      };
      return badges[cat] || badges.outros;
    }

    function escapeHtml(text) {
      return text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '';
    }

    function openApproval(id, text, geminiResponse) {
      const yourResponse = prompt('Edite a resposta do Gemini com seu jeito:', geminiResponse);
      if (yourResponse !== null) {
        fetch('/api/approve', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ messageId: id, approvedResponse: yourResponse })
        }).then(() => loadMessages()).catch(console.error);
      }
    }

    function deleteMessage(id) {
      if (confirm('Excluir esta mensagem?')) {
        fetch(\`/api/messages/\${id}\`, { method: 'DELETE' })
          .then(() => loadMessages()).catch(console.error);
      }
    }

    document.addEventListener('DOMContentLoaded', loadMessages);
  </script>
</body>
</html>
  `);
});

// API: Listar mensagens
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  db.all(\`SELECT * FROM mensagens_zapi ORDER BY received_at DESC LIMIT \${limit}\`, (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ messages: rows, total: rows.length });
  });
});

// API: Aprovar resposta (SALVA COMO EXEMPLO)
app.post('/api/approve', (req, res) => {
  const { messageId, approvedResponse } = req.body;
  if (!messageId || !approvedResponse) {
    return res.status(400).json({ error: 'messageId e approvedResponse são obrigatórios' });
  }
  
  // Atualizar mensagem
  db.run(\`UPDATE mensagens_zapi SET resposta_aprovada = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?\`,
    [approvedResponse, messageId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // Buscar dados para salvar como exemplo
      db.get('SELECT text_message, gemini_analysis, message_category FROM mensagens_zapi WHERE id = ?', [messageId], (err, msg) => {
        if (err || !msg) return res.json({ success: true, changes: this.changes });
        
        let analysis = {};
        try { analysis = JSON.parse(msg.gemini_analysis || '{}'); } catch(e) {}
        
        // Salvar como exemplo do seu estilo
        db.run(\`
          INSERT INTO attendant_style_examples (service_type, gemini_response, attendant_response, quality_score)
          VALUES (?, ?, ?, ?)
        \`, [
          analysis.tipo_servico || 'outros',
          analysis.resposta_sugerida || '',
          approvedResponse,
          analysis.confianca || 0.5
        ], function(err) {
          if (!err) {
            console.log(\`📚 Novo exemplo salvo! Total: \${this.lastID}\`);
            loadExamples(); // Recarregar exemplos
          }
          res.json({ 
            success: true, 
            changes: this.changes,
            exampleId: this.lastID 
          });
        });
      });
    });
});

// API: Ver perfil de atendimento
app.get('/api/profile', (req, res) => {
  res.json({
    profile: ATTENDANT_PROFILE,
    examplesCount: ATTENDANT_PROFILE.examples.length,
    examples: ATTENDANT_PROFILE.examples.slice(0, 10) // Últimos 10
  });
});

// API: Gerar prompt com seu estilo
app.get('/api/prompt-template', (req, res) => {
  const examples = ATTENDANT_PROFILE.examples.slice(-5).map(e => 
    \`- Exemplo: "\${e.attendant_response}"\`
  ).join('\n');
  
  const template = \`
Você é ${ATTENDANT_PROFILE.name}, dono do ${ATTENDANT_PROFILE.business}.

Seu estilo de atendimento:
- Tom: ${ATTENDANT_PROFILE.style.tone}
- Uso de emojis: ${ATTENDANT_PROFILE.style.emojis}
- Sempre menciona: ${ATTENDANT_PROFILE.style.values}
- Estrutura: ${ATTENDANT_PROFILE.style.structure}

EXEMPLOS DAS SUAS RESPOSTAS:
\${examples}

Responda como ${ATTENDANT_PROFILE.name}.
  \`;
  
  res.json({ template, examplesUsed: examples.split('\n').filter(e => e.trim()).length });
});

// API: Webhook Z-API
app.post('/webhook', (req, res) => {
  res.status(200).json({ received: true, timestamp: new Date().toISOString() });
  setTimeout(() => processMessage(req.body), 100);
});

// DEBUG endpoint
app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as total FROM mensagens_zapi', (err, rows) => {
    res.json({
      status: 'debug',
      messages: rows ? rows[0].total : 0,
      examples: ATTENDANT_PROFILE.examples.length,
      timestamp: new Date().toISOString()
    });
  });
});

// Test endpoint
app.post('/test', (req, res) => {
  const payload = {
    phone: req.body.phone || '5511999999999',
    text: { message: req.body.text || 'Teste' },
    type: 'ReceivedCallback',
    instanceId: process.env.ZAPI_INSTANCE_ID
  };
  processMessage(payload);
  res.json({ status: 'test_received', payload });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'webhook-learning-v3',
    version: '3.0.0',
    examplesLearned: ATTENDANT_PROFILE.examples.length,
    features: ['message_classification', 'gemini_analysis', 'style_learning']
  });
});

// ==================== FUNÇÕES ====================

function processMessage(payload) {
  const phone = payload.phone || payload.sender?.phone || 'unknown';
  const text = payload.text?.message || payload.message?.text || '';
  const type = payload.type || 'ReceivedCallback';
  const isGroup = payload.isGroup || false;
  const isNewsletter = payload.isNewsletter || false;
  
  // Classificar
  const classification = classifyMessage(text, type, isGroup, isNewsletter);
  
  console.log(\`📱 \${text.substring(0,50)}... [\${classification.category}]\`);
  
  // Salvar
  db.run(\`
    INSERT INTO mensagens_zapi 
    (phone, text_message, type, is_group, is_newsletter, message_category, is_client, is_announcement, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  \`, [
    phone, text, type, isGroup ? 1 : 0, isNewsletter ? 1 : 0,
    classification.category, classification.isClient, classification.isAnnouncement, classification.priority
  ], function(err) {
    if (err) console.error('Erro salvar:', err);
    else {
      const msgId = this.lastID;
      // Analisar se for cliente
      if (classification.isClient && text.trim()) {
        setTimeout(() => analyzeWithGemini(msgId, text), 500);
      }
    }
  });
}

function classifyMessage(text, type, isGroup, isNewsletter) {
  const lower = text.toLowerCase();
  
  if (isGroup) return { category: 'grupo', isClient: false, isAnnouncement: false, priority: 0 };
  if (isNewsletter) return { category: 'canal', isClient: false, isAnnouncement: true, priority: 0 };
  if (type === 'MessageTemplate') return { category: 'anuncio', isClient: false, isAnnouncement: true, priority: 0 };
  
  const adKeywords = ['promoção', 'desconto', 'oferta', 'liquidação', 'clique aqui', 'link na bio'];
  if (adKeywords.some(k => lower.includes(k))) {
    return { category: 'anuncio', isClient: false, isAnnouncement: true, priority: 0 };
  }
  
  const clientKeywords = ['oi', 'olá', 'preciso', 'gostaria', 'quanto custa', 'valor'];
  if (clientKeywords.some(k => lower.includes(k))) {
    return { category: 'cliente', isClient: true, isAnnouncement: false, priority: 1 };
  }
  
  return { category: 'outros', isClient: false, isAnnouncement: false, priority: 0 };
}

async function analyzeWithGemini(msgId, text) {
  try {
    // GERAR PROMPT COM SEU ESTILO
    const examples = ATTENDANT_PROFILE.examples.slice(-3).map(e => 
      \`- "\${e.attendant_response}"\`
    ).join('\n');
    
    const prompt = \`
Você é Wellington, dono do WDespachante.

Seu estilo:
- Simpático mas direto
- Usa emojis moderadamente (✅, 📋, 💰)
- Sempre menciona valores e prazos
- Oferece solução completa

EXEMPLOS DAS SUAS RESPOSTAS REAIS:
\${examples}

Analise esta mensagem:
"\${text}"

Responda em JSON:
{
  "tipo_servico": "transferencia|multas|ipva|crlv|outros",
  "confianca": 0.0-1.0,
  "documentos_necessarios": ["lista"],
  "resposta_sugerida": "sua resposta no estilo do Wellington"
}\`;

    const response = await axios.post(
      \`https://generativelanguage.googleapis.com/v1beta/models/\${GEMINI_MODEL}:generateContent?key=\${GEMINI_API_KEY}\`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 500 } },
      { timeout: 10000 }
    );

    if (response.status === 200) {
      const geminiResponse = response.data.candidates[0].content.parts[0].text;
      let analysis = {};
      try {
        const match = geminiResponse.match(/\{[\s\S]*\}/);
        if (match) analysis = JSON.parse(match[0]);
      } catch (e) {}
      
      db.run(\`UPDATE mensagens_zapi SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE WHERE id = ?\`,
        [JSON.stringify(analysis), analysis.resposta_sugerida || '', msgId]);
      
      console.log(\`🧠 \${analysis.tipo_servico} (\${Math.round(analysis.confianca * 100)}%)\`);
    }
  } catch (error) {
    console.error('Erro Gemini:', error.message);
    const fallback = fallbackAnalysis(text);
    db.run(\`UPDATE mensagens_zapi SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE WHERE id = ?\`,
      [JSON.stringify(fallback), fallback.resposta_sugerida, msgId]);
  }
}

function fallbackAnalysis(text) {
  const lower = text.toLowerCase();
  if (lower.includes('transfer')) return { tipo_servico: 'transferencia', confianca: 0.8, documentos_necessarios: ['CRLV', 'CNH'], resposta_sugerida: 'Olá! Para transferência precisamos...' };
  if (lower.includes('multa')) return { tipo_servico: 'multas', confianca: 0.7, documentos_necessarios: ['Auto infração'], resposta_sugerida: 'Olá! Para recursos de multa...' };
  if (lower.includes('ipva')) return { tipo_servico: 'ipva', confianca: 0.9, documentos_necessarios: ['CRLV'], resposta_sugerida: 'Olá! Para IPVA...' };
  return { tipo_servico: 'outros', confianca: 0.3, documentos_necessarios: [], resposta_sugerida: 'Olá! Como posso ajudar?' };
}

// Iniciar
app.listen(PORT, () => {
  console.log(\`🚀 Server Learning v3.0 rodando na porta \${PORT}\`);
  console.log(\`📚 Exemplos carregados: \${ATTENDANT_PROFILE.examples.length}\`);
  console.log(\`🎯 Aprendizado: \${ATTENDANT_PROFILE.style.tone}\`);
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('🫀 Keep-alive'), 5 * 60 * 1000);
}