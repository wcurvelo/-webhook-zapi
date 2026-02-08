// server-updated.js - Webhook com identificação de GRUPOS e ANÚNCIOS
// Identifica: grupos, anúncios, canais e clientes reais

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do banco de dados
const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';

// Configuração Z-API
const ZAPI_CONFIG = {
  INSTANCE_ID: process.env.ZAPI_INSTANCE_ID,
  TOKEN: process.env.ZAPI_TOKEN,
  CLIENT_TOKEN: process.env.CLIENT_TOKEN
};

// Configuração Gemini
const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY,
  MODEL: 'gemini-2.0-flash',
  ENABLED: true,
  ANALISES_PATH: '/tmp/analises_gemini/',
  MAX_TOKENS: 500,
  TEMPERATURE: 0.2
};

// Conectar ao banco de dados
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite:', DB_PATH);
    criarTabelas();
  }
});

// Criar tabelas se não existirem (ATUALIZADA)
function criarTabelas() {
  db.run(`
    CREATE TABLE IF NOT EXISTS mensagens_zapi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT,
      phone TEXT,
      participant_phone TEXT,
      message_id TEXT,
      type TEXT,
      event_type TEXT,
      text_message TEXT,
      is_group BOOLEAN DEFAULT FALSE,
      is_newsletter BOOLEAN DEFAULT FALSE,
      from_me BOOLEAN DEFAULT FALSE,
      waiting_message BOOLEAN DEFAULT FALSE,
      is_edit BOOLEAN DEFAULT FALSE,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      raw_payload TEXT,
      processed BOOLEAN DEFAULT FALSE,
      gemini_analysis TEXT,
      resposta_gerada TEXT,
      resposta_enviada BOOLEAN DEFAULT FALSE,
      aprobada_por_humano BOOLEAN DEFAULT FALSE,
      resposta_aprovada TEXT,
      observacoes TEXT,
      
      -- NOVOS CAMPOS PARA CLASSIFICAÇÃO
      message_category TEXT DEFAULT 'cliente', -- 'cliente', 'grupo', 'anuncio', 'canal', 'outros'
      is_client BOOLEAN DEFAULT TRUE,
      is_announcement BOOLEAN DEFAULT FALSE,
      priority INTEGER DEFAULT 1,
      notes TEXT
    )
  `, (err) => {
    if (err) console.error('Erro criar tabela mensagens_zapi:', err);
    else console.log('Tabela mensagens_zapi pronta (atualizada com classificação)');
  });
}

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Endpoint de saúde
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'webhook-zapi-classify',
    version: '2.0.0',
    features: ['zapi-webhook', 'gemini-analysis', 'group-detection', 'announcement-detection', 'dashboard']
  });
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard WDespachante v2.0</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .message-card { transition: all 0.3s ease; border-left: 4px solid #3B82F6; }
        .message-card:hover { transform: translateY(-2px); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); }
        .type-grupo { border-left-color: #EF4444 !important; background-color: #FEF2F2; }
        .type-anuncio { border-left-color: #8B5CF6 !important; background-color: #F5F3FF; }
        .type-canal { border-left-color: #F59E0B !important; background-color: #FFFBEB; }
        .type-cliente { border-left-color: #10B981 !important; background-color: #ECFDF5; }
        .type-outros { border-left-color: #6B7280 !important; background-color: #F3F4F6; }
        .badge-grupo { background-color: #EF4444; color: white; }
        .badge-anuncio { background-color: #8B5CF6; color: white; }
        .badge-canal { background-color: #F59E0B; color: white; }
        .badge-cliente { background-color: #10B981; color: white; }
    </style>
</head>
<body class="bg-gray-50 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <!-- Header -->
        <div class="mb-10">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h1 class="text-3xl font-bold text-gray-900">
                        <i class="fas fa-robot text-blue-600 mr-3"></i>
                        Dashboard WDespachante v2.0
                    </h1>
                    <p class="text-gray-600 mt-2">
                        Com identificação de GRUPOS e ANÚNCIOS
                    </p>
                </div>
                <div class="text-right">
                    <div class="inline-flex items-center px-4 py-2 rounded-lg bg-green-100 text-green-800">
                        <i class="fas fa-check-circle mr-2"></i>
                        <span id="status">Sistema Online</span>
                    </div>
                </div>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-green-100 text-green-600 mr-4">
                            <i class="fas fa-user text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Clientes</p>
                            <p class="text-2xl font-bold" id="count-cliente">0</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-red-100 text-red-600 mr-4">
                            <i class="fas fa-users text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Grupos</p>
                            <p class="text-2xl font-bold" id="count-grupo">0</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-purple-100 text-purple-600 mr-4">
                            <i class="fas fa-bullhorn text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Anúncios</p>
                            <p class="text-2xl font-bold" id="count-anuncio">0</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-yellow-100 text-yellow-600 mr-4">
                            <i class="fas fa-newspaper text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Canais</p>
                            <p class="text-2xl font-bold" id="count-canal">0</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-blue-100 text-blue-600 mr-4">
                            <i class="fas fa-brain text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Precisão</p>
                            <p class="text-2xl font-bold" id="avg-confidence">0%</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Messages -->
        <div class="bg-white rounded-xl shadow mb-6">
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h2 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-inbox mr-2"></i>
                        Mensagens Recebidas
                    </h2>
                    <button onclick="loadMessages()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-sync-alt mr-2"></i>Atualizar
                    </button>
                </div>
            </div>
            <div id="messages-container" class="p-4">
                <div class="text-center py-12 text-gray-500">
                    <i class="fas fa-comment-dots text-4xl mb-4"></i>
                    <p>Carregando...</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        let messages = [];

        async function loadMessages() {
            try {
                const response = await fetch('/api/messages?limit=50');
                const data = await response.json();
                messages = data.messages;
                renderMessages(messages);
                updateStats(messages);
            } catch (error) {
                console.error('Erro:', error);
            }
        }

        function renderMessages(messages) {
            const container = document.getElementById('messages-container');
            
            if (messages.length === 0) {
                container.innerHTML = '<div class="text-center py-12 text-gray-500"><i class="fas fa-inbox text-4xl mb-4"></i><p>Nenhuma mensagem</p></div>';
                return;
            }

            container.innerHTML = messages.map(msg => {
                const category = msg.message_category || 'outros';
                const typeClass = 'type-' + category;
                const badgeClass = 'badge-' + category;
                const icon = getIconForCategory(category);
                const label = getLabelForCategory(category);
                const analysis = msg.gemini_analysis ? JSON.parse(msg.gemini_analysis) : null;
                const confidence = analysis?.confianca || 0;
                const date = new Date(msg.received_at).toLocaleString();
                
                return \`
                    <div class="message-card \${typeClass} rounded-lg border mb-4 p-4">
                        <div class="flex justify-between items-start mb-2">
                            <div class="flex items-center">
                                <span class="badge badge-\${category} px-2 py-1 rounded text-xs font-bold mr-2">
                                    <i class="fas \${icon} mr-1"></i>
                                    \${label}
                                </span>
                                <span class="text-sm text-gray-500">
                                    <i class="fas fa-phone mr-1"></i>
                                    \${msg.phone ? msg.phone.substring(0,4) + '****' + msg.phone.substring(9) : 'Desconhecido'}
                                </span>
                            </div>
                            <span class="text-xs text-gray-400">\${date}</span>
                        </div>
                        <p class="text-gray-800 mb-3">"\${msg.text_message?.substring(0,100)}"</p>
                        \${analysis ? \`
                            <div class="flex items-center justify-between">
                                <div class="text-sm">
                                    <span class="font-medium">\${analysis.tipo_servico}</span>
                                    <span class="text-gray-400">|</span>
                                    <span>\${Math.round(confidence * 100)}% confiança</span>
                                </div>
                                <span class="text-xs text-gray-400">
                                    \${msg.is_client ? '✅ Cliente' : '⛔ Não cliente'}
                                </span>
                            </div>
                        \` : ''}
                    </div>
                \`;
            }).join('');
        }

        function updateStats(messages) {
            const counts = { cliente: 0, grupo: 0, anuncio: 0, canal: 0, outros: 0 };
            let totalConfidence = 0;
            let analyzedCount = 0;
            
            messages.forEach(msg => {
                const category = msg.message_category || 'outros';
                counts[category] = (counts[category] || 0) + 1;
                
                if (msg.gemini_analysis) {
                    try {
                        const analysis = JSON.parse(msg.gemini_analysis);
                        totalConfidence += analysis.confianca || 0;
                        analyzedCount++;
                    } catch (e) {}
                }
            });
            
            document.getElementById('count-cliente').textContent = counts.cliente;
            document.getElementById('count-grupo').textContent = counts.grupo;
            document.getElementById('count-anuncio').textContent = counts.anuncio;
            document.getElementById('count-canal').textContent = counts.canal;
            document.getElementById('avg-confidence').textContent = 
                analyzedCount > 0 ? Math.round((totalConfidence / analyzedCount) * 100) + '%' : '0%';
        }

        function getIconForCategory(category) {
            const icons = {
                'cliente': 'fa-user',
                'grupo': 'fa-users',
                'anuncio': 'fa-bullhorn',
                'canal': 'fa-newspaper',
                'outros': 'fa-question'
            };
            return icons[category] || icons.outros;
        }

        function getLabelForCategory(category) {
            const labels = {
                'cliente': 'CLIENTE',
                'grupo': 'GRUPO',
                'anuncio': 'ANÚNCIO',
                'canal': 'CANAL',
                'outros': 'OUTROS'
            };
            return labels[category] || 'OUTROS';
        }

        document.addEventListener('DOMContentLoaded', () => {
            loadMessages();
            setInterval(loadMessages, 30000);
        });
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

// Webhook principal Z-API
app.post('/webhook', (req, res) => {
  console.log('📨 Z-API Webhook Recebido');
  
  // Responder imediatamente
  res.status(200).json({ received: true, timestamp: new Date().toISOString() });
  
  // Processar em background
  setTimeout(() => {
    try {
      processZAPIMessage(req.body);
    } catch (error) {
      console.error('Erro processar Z-API:', error);
    }
  }, 100);
});

// API: Listar mensagens
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  
  db.all(`
    SELECT * FROM mensagens_zapi 
    WHERE text_message IS NOT NULL AND text_message != ''
    ORDER BY received_at DESC
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ messages: rows, total: rows.length });
    }
  });
});

// Endpoint de teste
app.post('/test-zapi', (req, res) => {
  const testPayload = {
    phone: req.body.phone || '5511999999999',
    text: { message: req.body.text || 'Teste' },
    type: 'ReceivedCallback',
    instanceId: ZAPI_CONFIG.INSTANCE_ID,
    isGroup: req.body.isGroup || false,
    isNewsletter: req.body.isNewsletter || false,
    message: { text: req.body.text || 'Teste', type: 'text' }
  };
  
  processZAPIMessage(testPayload);
  
  res.json({ status: 'test_received', payload: testPayload });
});

// DEBUG endpoint
app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as total FROM mensagens_zapi', (err, rows) => {
    const count = rows ? rows[0].total : 0;
    res.json({
      status: 'debug',
      messages_received: count,
      instance_id: ZAPI_CONFIG.INSTANCE_ID,
      gemini_enabled: GEMINI_CONFIG.ENABLED,
      timestamp: new Date().toISOString()
    });
  });
});

// Processar mensagem Z-API (ATUALIZADO)
async function processZAPIMessage(payload) {
  try {
    // Extrair dados básicos
    const phone = payload.phone || payload.sender?.phone || 'unknown';
    const text = payload.text?.message || payload.message?.text || '';
    const type = payload.type || 'ReceivedCallback';
    const instanceId = payload.instanceId || ZAPI_CONFIG.INSTANCE_ID;
    const messageId = payload.messageId || \`msg_\${Date.now()}\`;
    const isGroup = payload.isGroup || false;
    const isNewsletter = payload.isNewsletter || false;
    const fromMe = payload.fromMe || false;
    
    // CLASSIFICAR A MENSAGEM
    const classification = classifyMessage(text, type, isGroup, isNewsletter);
    
    console.log(\`📱 Mensagem: "\${text.substring(0,50)}"\`);
    console.log(\`🏷️ Classificação: \${classification.category} (isClient: \${classification.isClient})\`);
    
    // Salvar no banco de dados
    db.run(\`
      INSERT INTO mensagens_zapi 
      (instance_id, phone, message_id, type, text_message, is_group, is_newsletter, from_me, raw_payload,
       message_category, is_client, is_announcement, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`, [
      instanceId,
      phone,
      messageId,
      type,
      text,
      isGroup ? 1 : 0,
      isNewsletter ? 1 : 0,
      fromMe ? 1 : 0,
      JSON.stringify(payload),
      classification.category,
      classification.isClient ? 1 : 0,
      classification.isAnnouncement ? 1 : 0,
      classification.priority
    ], function(err) {
      if (err) {
        console.error('Erro salvar mensagem:', err);
      } else {
        const messageIdDb = this.lastID;
        console.log(\`💾 Mensagem \${messageIdDb} salva como \${classification.category}\`);
        
        // Só analisar se for cliente
        if (classification.isClient && !fromMe && text.trim() && GEMINI_CONFIG.ENABLED) {
          setTimeout(() => analisarComGemini(messageIdDb, text, phone), 500);
        } else {
          console.log(\`⏭️ Mensagem ignorada (não é cliente ou é grupo/anúncio)\`);
        }
      }
    });
    
  } catch (error) {
    console.error('Erro processZAPIMessage:', error);
  }
}

// CLASSIFICAR MENSAGEM (NOVA FUNÇÃO)
function classifyMessage(text, type, isGroup, isNewsletter) {
  const lowerText = text.toLowerCase();
  
  // 1. Verificar se é grupo
  if (isGroup) {
    return {
      category: 'grupo',
      isClient: false,
      isAnnouncement: false,
      priority: 0
    };
  }
  
  // 2. Verificar se é canal/newsletter
  if (isNewsletter) {
    return {
      category: 'canal',
      isClient: false,
      isAnnouncement: true,
      priority: 0
    };
  }
  
  // 3. Verificar tipo Z-API
  if (type === 'MessageTemplate') {
    return {
      category: 'anuncio',
      isClient: false,
      isAnnouncement: true,
      priority: 0
    };
  }
  
  // 4. Verificar palavras-chave de anúncio
  const announcementKeywords = [
    'promoção', 'desconto', 'oferta', 'liquidação', 'black friday',
    'compre agora', 'clique aqui', 'link na bio', 'confira',
    'novidade', 'lançamento', 'breve', 'em breve',
    'anúncio', 'publicidade', 'propaganda'
  ];
  
  const isAnnouncement = announcementKeywords.some(keyword => lowerText.includes(keyword));
  
  if (isAnnouncement) {
    return {
      category: 'anuncio',
      isClient: false,
      isAnnouncement: true,
      priority: 0
    };
  }
  
  // 5. Verificar se é mensagem de pessoa física
  const clientKeywords = [
    'oi', 'olá', 'bom dia', 'boa tarde', 'boa noite',
    'preciso', 'gostaria', 'quero', 'pode',
    'quanto custa', 'valor', 'preço', 'orçamento',
    'transferir', 'ipva', 'multa', 'crlv', 'licenciamento'
  ];
  
  const hasClientKeywords = clientKeywords.some(keyword => lowerText.includes(keyword));
  
  if (hasClientKeywords && !isAnnouncement) {
    return {
      category: 'cliente',
      isClient: true,
      isAnnouncement: false,
      priority: 1
    };
  }
  
  // Default: outros
  return {
    category: 'outros',
    isClient: false,
    isAnnouncement: false,
    priority: 0
  };
}

// Analisar com Gemini (mantida igual)
async function analisarComGemini(messageId, text, phone) {
  try {
    console.log('🧠 Analisando com Gemini...');
    
    const prompt = \`Analise esta mensagem de WhatsApp de um cliente de despachante:

"\${text}"

Retorne JSON com:
{
  "tipo_servico": "transferencia|multas|ipva|licenciamento|atpv|crlv|outros",
  "confianca": 0.0 a 1.0,
  "documentos_necessarios": ["lista"],
  "resposta_sugerida": "texto em português"
}\`;

    const response = await axios.post(
      \`https://generativelanguage.googleapis.com/v1beta/models/\${GEMINI_CONFIG.MODEL}:generateContent?key=\${GEMINI_CONFIG.API_KEY}\`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 500 } },
      { timeout: 10000 }
    );

    if (response.status === 200) {
      const geminiResponse = response.data.candidates[0].content.parts[0].text;
      let analysis = {};
      try {
        const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
      } catch (e) { analysis = { tipo_servico: 'outros', confianca: 0.5, resposta_sugerida: 'Erro na análise' }; }
      
      db.run(\`UPDATE mensagens_zapi SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE WHERE id = ?\`,
        [JSON.stringify(analysis), analysis.resposta_sugerida || '', messageId], (err) => {
          if (err) console.error('Erro atualizar análise:', err);
          else console.log(\`📊 Análise salva: \${analysis.tipo_servico} (\${Math.round(analysis.confianca * 100)}%)\`);
        });
    }
  } catch (error) {
    console.error('Erro Gemini:', error.message);
    const fallback = analiseFallback(text);
    db.run(\`UPDATE mensagens_zapi SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE WHERE id = ?\`,
      [JSON.stringify(fallback), fallback.resposta_sugerida, messageId]);
  }
}

// Fallback (mantido igual)
function analiseFallback(text) {
  const lowerText = text.toLowerCase();
  let tipo_servico = 'outros', confianca = 0.3, documentos = [], resposta = '';
  
  if (lowerText.includes('transfer')) { tipo_servico = 'transferencia'; confianca = 0.8; documentos = ['CRLV', 'CNH']; resposta = 'Para transferência precisamos...'; }
  else if (lowerText.includes('multa')) { tipo_servico = 'multas'; confianca = 0.7; documentos = ['Auto infração']; resposta = 'Para recursos de multa...'; }
  else if (lowerText.includes('ipva')) { tipo_servico = 'ipva'; confianca = 0.9; documentos = ['CRLV']; resposta = 'Para IPVA precisamos...'; }
  else { resposta = 'Olá! Como posso ajudar?'; }
  
  return { tipo_servico, confianca, documentos_necessarios: documentos, resposta_sugerida: resposta, usa_fallback: true };
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(\`🚀 Servidor Z-API Classify rodando na porta \${PORT}\`);
  console.log('📝 Funcionalidades:');
  console.log('   • Classificação automática de mensagens');
  console.log('   • Identificação de GRUPOS (isClient=false)');
  console.log('   • Identificação de ANÚNCIOS');
  console.log('   • Dashboard v2.0');
  console.log('   • Gemini 2.0 Flash integrado');
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => console.log('🫀 Keep-alive'), 5 * 60 * 1000);
}