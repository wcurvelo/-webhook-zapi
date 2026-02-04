// server-dashboard.js - Webhook Z-API com Gemini + Dashboard Visual
// Dashboard para treinamento e aprovação de respostas

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
  INSTANCE_ID: process.env.ZAPI_INSTANCE_ID || '***REMOVED***',
  TOKEN: process.env.ZAPI_TOKEN || '***REMOVED***',
  CLIENT_TOKEN: process.env.CLIENT_TOKEN || '***REMOVED***'
};

// Configuração Gemini
const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY || '***REMOVED***',
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

// Criar tabelas se não existirem
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
      is_group BOOLEAN,
      from_me BOOLEAN,
      waiting_message BOOLEAN,
      is_edit BOOLEAN,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      raw_payload TEXT,
      processed BOOLEAN DEFAULT FALSE,
      gemini_analysis TEXT,
      resposta_gerada TEXT,
      resposta_enviada BOOLEAN DEFAULT FALSE,
      aprovada_por_humano BOOLEAN DEFAULT FALSE,
      resposta_aprovada TEXT,
      observacoes TEXT
    )
  `, (err) => {
    if (err) console.error('Erro criar tabela mensagens_zapi:', err);
    else console.log('Tabela mensagens_zapi pronta');
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
    service: 'webhook-zapi-dashboard',
    version: '1.1.0',
    endpoints: ['/webhook', '/dashboard', '/api/messages', '/api/approve', '/test-zapi'],
    features: ['zapi-webhook', 'gemini-analysis', 'dashboard', 'auto-response-DISABLED']
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
    <title>Dashboard WDespachante - Treinamento</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .message-card {
            transition: all 0.3s ease;
            border-left: 4px solid #3B82F6;
        }
        .message-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        .service-transferencia { border-left-color: #10B981 !important; }
        .service-multas { border-left-color: #EF4444 !important; }
        .service-ipva { border-left-color: #F59E0B !important; }
        .service-crlv { border-left-color: #8B5CF6 !important; }
        .service-outros { border-left-color: #6B7280 !important; }
        .confianca-bar {
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(90deg, #EF4444, #F59E0B, #10B981);
        }
        .confianca-fill {
            height: 100%;
            border-radius: 4px;
            background: #10B981;
            transition: width 1s ease;
        }
        .pulse {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
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
                        Dashboard WDespachante - Treinamento
                    </h1>
                    <p class="text-gray-600 mt-2">
                        Sistema de análise de mensagens WhatsApp com Gemini 2.0 Flash
                    </p>
                </div>
                <div class="text-right">
                    <div class="inline-flex items-center px-4 py-2 rounded-lg bg-green-100 text-green-800">
                        <i class="fas fa-check-circle mr-2"></i>
                        <span id="status">Carregando...</span>
                    </div>
                    <div class="mt-2 text-sm text-gray-500">
                        <i class="fas fa-database mr-1"></i>
                        <span id="message-count">0</span> mensagens recebidas
                    </div>
                </div>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-blue-100 text-blue-600 mr-4">
                            <i class="fas fa-comments text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Mensagens Hoje</p>
                            <p class="text-2xl font-bold" id="today-count">0</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-green-100 text-green-600 mr-4">
                            <i class="fas fa-brain text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Gemini Ativo</p>
                            <p class="text-2xl font-bold text-green-600">✅</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-yellow-100 text-yellow-600 mr-4">
                            <i class="fas fa-shield-alt text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Modo Treinamento</p>
                            <p class="text-2xl font-bold text-yellow-600">⏸️</p>
                        </div>
                    </div>
                </div>
                <div class="bg-white rounded-xl shadow p-6">
                    <div class="flex items-center">
                        <div class="p-3 rounded-lg bg-purple-100 text-purple-600 mr-4">
                            <i class="fas fa-chart-line text-xl"></i>
                        </div>
                        <div>
                            <p class="text-gray-500 text-sm">Precisão Média</p>
                            <p class="text-2xl font-bold" id="avg-confidence">0%</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Main Content -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Left Column - Mensagens -->
            <div class="lg:col-span-2">
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
                            <p>Carregando mensagens...</p>
                        </div>
                    </div>
                </div>

                <!-- Service Distribution -->
                <div class="bg-white rounded-xl shadow">
                    <div class="px-6 py-4 border-b">
                        <h2 class="text-xl font-bold text-gray-800">
                            <i class="fas fa-chart-pie mr-2"></i>
                            Distribuição de Serviços
                        </h2>
                    </div>
                    <div class="p-6">
                        <div id="services-chart" class="h-64 flex items-center justify-center text-gray-500">
                            <p>Carregando dados...</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column - Detalhes e Aprovação -->
            <div>
                <div class="bg-white rounded-xl shadow sticky top-6">
                    <div class="px-6 py-4 border-b">
                        <h2 class="text-xl font-bold text-gray-800">
                            <i class="fas fa-clipboard-check mr-2"></i>
                            Detalhes da Mensagem
                        </h2>
                    </div>
                    <div id="message-detail" class="p-6">
                        <div class="text-center py-12 text-gray-500">
                            <i class="fas fa-mouse-pointer text-4xl mb-4"></i>
                            <p>Selecione uma mensagem para ver detalhes</p>
                        </div>
                    </div>
                </div>

                <!-- Quick Actions -->
                <div class="mt-6 bg-white rounded-xl shadow">
                    <div class="px-6 py-4 border-b">
                        <h2 class="text-xl font-bold text-gray-800">
                            <i class="fas fa-bolt mr-2"></i>
                            Ações Rápidas
                        </h2>
                    </div>
                    <div class="p-6">
                        <button onclick="testMessage()" class="w-full mb-4 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center justify-center">
                            <i class="fas fa-vial mr-2"></i>Testar Mensagem
                        </button>
                        <button onclick="exportData()" class="w-full mb-4 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center">
                            <i class="fas fa-file-export mr-2"></i>Exportar Dados
                        </button>
                        <button onclick="showStats()" class="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center">
                            <i class="fas fa-chart-bar mr-2"></i>Ver Estatísticas
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="mt-12 pt-8 border-t text-center text-gray-500 text-sm">
            <p>
                <i class="fas fa-cogs mr-1"></i>
                Sistema WDespachante v1.1.0 | Gemini 2.0 Flash |
                <span class="text-green-600 ml-2">
                    <i class="fas fa-circle text-xs mr-1"></i>
                    Modo Treinamento Ativo
                </span>
            </p>
            <p class="mt-2">
                Última atualização: <span id="last-update">--:--:--</span> |
                Auto-resposta: <span class="text-red-600">DESATIVADA</span>
            </p>
        </div>
    </div>

    <!-- Modal para aprovação -->
    <div id="approval-modal" class="fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div class="px-6 py-4 border-b flex justify-between items-center">
                <h3 class="text-xl font-bold text-gray-800">
                    <i class="fas fa-check-circle mr-2 text-green-600"></i>
                    Aprovar Resposta
                </h3>
                <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto max-h-[60vh]">
                <div id="modal-content">
                    <!-- Conteúdo dinâmico -->
                </div>
            </div>
            <div class="px-6 py-4 border-t bg-gray-50">
                <div class="flex justify-end space-x-4">
                    <button onclick="closeModal()" class="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                        Cancelar
                    </button>
                    <button id="approve-btn" onclick="approveResponse()" class="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                        <i class="fas fa-check mr-2"></i>Aprovar e Enviar
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentMessageId = null;
        let messages = [];

        // Carregar status inicial
        async function loadStatus() {
            try {
                const response = await fetch('/health');
                const data = await response.json();
                document.getElementById('status').textContent = data.status === 'healthy' ? 'Sistema Online' : 'Sistema Offline';
                
                // Atualizar contagem de mensagens
                const debugResponse = await fetch('/debug');
                const debugData = await debugResponse.json();
                document.getElementById('message-count').textContent = debugData.messages_received;
                
                // Atualizar timestamp
                const now = new Date();
                document.getElementById('last-update').textContent = now.toLocaleTimeString();
                
            } catch (error) {
                console.error('Erro ao carregar status:', error);
            }
        }

        // Carregar mensagens
        async function loadMessages() {
            try {
                const response = await fetch('/api/messages?limit=20');
                const data = await response.json();
                messages = data.messages;
                
                renderMessages(messages);
                updateStats(messages);
                
            } catch (error) {
                console.error('Erro ao carregar mensagens:', error);
                document.getElementById('messages-container').innerHTML = \`
                    <div class="text-center py-12 text-red-500">
                        <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
                        <p>Erro ao carregar mensagens</p>
                        <p class="text-sm mt-2">\${error.message}</p>
                    </div>
                \`;
            }
        }

        // Renderizar mensagens
        function renderMessages(messages) {
            const container = document.getElementById('messages-container');
            
            if (messages.length === 0) {
                container.innerHTML = \`
                    <div class="text-center py-12 text-gray-500">
                        <i class="fas fa-inbox text-4xl mb-4"></i>
                        <p>Nenhuma mensagem recebida ainda</p>
                        <p class="text-sm mt-2">Envie uma mensagem pelo WhatsApp para começar</p>
                    </div>
                \`;
                return;
            }

            container.innerHTML = messages.map((msg, index) => {
                const analysis = msg.gemini_analysis ? JSON.parse(msg.gemini_analysis) : null;
                const serviceType = analysis?.tipo_servico || 'outros';
                const confidence = analysis?.confianca || 0;
                const date = new Date(msg.received_at).toLocaleTimeString();
                
                const serviceColors = {
                    'transferencia': 'text-green-600 bg-green-50 border-green-200',
                    'multas': 'text-red-600 bg-red-50 border-red-200',
                    'ipva': 'text-yellow-600 bg-yellow-50 border-yellow-200',
                    'crlv': 'text-purple-600 bg-purple-50 border-purple-200',
                    'outros': 'text-gray-600 bg-gray-50 border-gray-200'
                };
                
                const serviceIcons = {
                    'transferencia': 'fas fa-exchange-alt',
                    'multas': 'fas fa-gavel',
                    'ipva': 'fas fa-file-invoice-dollar',
                    'crlv': 'fas fa-id-card',
                    'outros': 'fas fa-question'
                };
                
                const colorClass = serviceColors[serviceType] || serviceColors.outros;
                const iconClass = serviceIcons[serviceType] || serviceIcons.outros;
                
                return \`
                    <div class="message-card bg-white rounded-lg border mb-4 p-4 cursor-pointer hover:shadow-md"
                         onclick="showMessageDetail(\${msg.id})"
                         data-message-id="\${msg.id}">
                        <div class="flex justify-between items-start mb-2">
                            <div class="flex items-center">
                                <div class="\${colorClass} px-3 py-1 rounded-full text-sm font-medium flex items-center">
                                    <i class="\${iconClass} mr-2"></i>
                                    \${serviceType.toUpperCase()}
                                </div>
                                <div class="ml-3 text-sm text-gray-500">
                                    <i class="fas fa-phone mr-1"></i>
                                    \${msg.phone ? msg.phone.substring(0, 4) + '*****' + msg.phone.substring(9) : 'Desconhecido'}
                                </div>
                            </div>
                            <div class="text-sm text-gray-500">
                                \${date}
                            </div>
                        </div>
                        
                        <div class="mb-3">
                            <p class="text-gray-800">"\${msg.text_message.substring(0, 100)}\${msg.text_message.length > 100 ? '...' : ''}"</p>
                        </div>
                        
                        <div class="flex items-center justify-between">
                            <div class="flex-1 mr-4">
                                <div class="text-xs text-gray-500 mb-1">Confiança da análise: \${Math.round(confidence * 100)}%</div>
                                <div class="confianca-bar">
                                    <div class="confianca-fill" style="width: \${confidence * 100}%"></div>
                                </div>
                            </div>
                            <div>
                                \${msg.aprovada_por_humano ? 
                                    '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full"><i class="fas fa-check mr-1"></i>Aprovada</span>' : 
                                    '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full"><i class="fas fa-clock mr-1"></i>Pendente</span>'
                                }
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        // Mostrar detalhes da mensagem
        async function showMessageDetail(messageId) {
            try {
                const response = await fetch(\`/api/messages/\${messageId}\`);
                const data = await response.json();
                currentMessageId = messageId;
                
                const msg = data.message;
                const analysis = msg.gemini_analysis ? JSON.parse(msg.gemini_analysis) : null;
                
                const detailHtml = \`
                    <div class="space-y-6">
                        <!-- Cabeçalho -->
                        <div>
                            <div class="flex items-center justify-between mb-4">
                                <h3 class="text-lg font-bold text-gray-800">
                                    <i class="fas fa-comment-dots mr-2"></i>
                                    Detalhes da Mensagem
                                </h3>
                                <span class="text-sm text-gray-500">
                                    ID: \${msg.id}
                                </span>
                            </div>
                            <div class="bg-gray-50 rounded-lg p-4">
                                <p class="text-gray-800">"\${msg.text_message}"</p>
                            </div>
                            <div class="mt-2 text-sm text-gray-500">
                                <i class="fas fa-clock mr-1"></i>
                                \${new Date(msg.received_at).toLocaleString()}
                                <span class="mx-2">•</span>
                                <i class="fas fa-phone mr-1"></i>
                                \${msg.phone || 'Número não disponível'}
                            </div>
                        </div>
                        
                        <!-- Análise do Gemini -->
                        \${analysis ? \`
                            <div>
                                <h4 class="font-bold text-gray-700 mb-3">
                                    <i class="fas fa-brain mr-2 text-purple-600"></i>
                                    Análise do Gemini
                                </h4>
                                <div class="space-y-4">
                                    <div>
                                        <div class="flex justify-between mb-1">
                                            <span class="text-sm text-gray-600">Tipo de serviço identificado:</span>
                                            <span class="font-medium">\${analysis.tipo_servico}</span>
                                        </div>
                                        <div class="flex justify-between mb-1">
                                            <span class="text-sm text-gray-600">Nível de confiança:</span>
                                            <span class="font-medium">\${Math.round(analysis.confianca * 100)}%</span>
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <h5 class="text-sm font-medium text-gray-700 mb-2">Documentos necessários:</h5>
                                        <div class="bg-blue-50 rounded-lg p-3">
                                            <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
                                                \${analysis.documentos_necessarios ? analysis.documentos_necessarios.map(doc => \`<li>\${doc}</li>\`).join('') : '<li>Não identificado</li>'}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        \` : \`
                            <div class="text-yellow-600 bg-yellow-50 rounded-lg p-4">
                                <i class="fas fa-exclamation-triangle mr-2"></i>
                                Análise Gemini não disponível para esta mensagem
                            </div>
                        \`}
                        
                        <!-- Resposta Sugerida -->
                        <div>
                            <h4 class="font-bold text-gray-700 mb-3">
                                <i class="fas fa-reply mr-2 text-green-600"></i>
                                Resposta Sugerida
                            </h4>
                            <div class="bg-green-50 rounded-lg p-4">
                                <p class="text-gray-800 whitespace-pre-wrap">\${msg.resposta_gerada || 'Nenhuma resposta gerada'}</p>
                            </div>
                        </div>
                        
                        <!-- Ações -->
                        <div class="pt-4 border-t">
                            <div class="flex space-x-4">
                                \${!msg.aprovada_por_humano ? \`
                                    <button onclick="openApprovalModal(\${msg.id})" 
                                            class="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center">
                                        <i class="fas fa-check mr-2"></i>Aprovar Resposta
                                    </button>
                                \` : \`
                                    <button class="flex-1 px-4 py-3 bg-gray-300 text-gray-700 rounded-lg cursor-not-allowed flex items-center justify-center">
                                        <i class="fas fa-check-double mr-2"></i>Já Aprovada
                                    </button>
                                \`}
                                
                                <button onclick="editResponse(\${msg.id})" 
                                        class="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center">
                                    <i class="fas fa-edit mr-2"></i>Editar
                                </button>
                            </div>
                        </div>
                    </div>
                \`;
                
                document.getElementById('message-detail').innerHTML = detailHtml;
                
                // Destacar mensagem selecionada
                document.querySelectorAll('.message-card').forEach(card => {
                    card.classList.remove('ring-2', 'ring-blue-500');
                    if (card.dataset.messageId == messageId) {
                        card.classList.add('ring-2', 'ring-blue-500');
                    }
                });
                
            } catch (error) {
                console.error('Erro ao carregar detalhes:', error);
                document.getElementById('message-detail').innerHTML = \`
                    <div class="text-center py-12 text-red-500">
                        <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
                        <p>Erro ao carregar detalhes</p>
                        <p class="text-sm mt-2">\${error.message}</p>
                    </div>
                \`;
            }
        }

        // Atualizar estatísticas
        function updateStats(messages) {
            // Contar mensagens de hoje
            const today = new Date().toDateString();
            const todayCount = messages.filter(msg => 
                new Date(msg.received_at).toDateString() === today
            ).length;
            document.getElementById('today-count').textContent = todayCount;
            
            // Calcular precisão média
            const messagesWithAnalysis = messages.filter(msg => msg.gemini_analysis);
            if (messagesWithAnalysis.length > 0) {
                const totalConfidence = messagesWithAnalysis.reduce((sum, msg) => {
                    const analysis = JSON.parse(msg.gemini_analysis);
                    return sum + (analysis.confianca || 0);
                }, 0);
                const avgConfidence = Math.round((totalConfidence / messagesWithAnalysis.length) * 100);
                document.getElementById('avg-confidence').textContent = avgConfidence + '%';
            }
            
            // Atualizar gráfico de distribuição
            updateServicesChart(messages);
        }

        // Atualizar gráfico de serviços
        function updateServicesChart(messages) {
            const services = {
                'transferencia': 0,
                'multas': 0,
                'ipva': 0,
                'crlv': 0,
                'outros': 0
            };
            
            messages.forEach(msg => {
                if (msg.gemini_analysis) {
                    try {
                        const analysis = JSON.parse(msg.gemini_analysis);
                        const service = analysis.tipo_servico || 'outros';
                        services[service] = (services[service] || 0) + 1;
                    } catch (e) {
                        services.outros++;
                    }
                } else {
                    services.outros++;
                }
            });
            
            // Criar gráfico simples
            const chartHtml = \`
                <div class="space-y-4">
                    \${Object.entries(services)
                        .filter(([_, count]) => count > 0)
                        .map(([service, count]) => {
                            const percentage = Math.round((count / messages.length) * 100);
                            const serviceColors = {
                                'transferencia': 'bg-green-500',
                                'multas': 'bg-red-500',
                                'ipva': 'bg-yellow-500',
                                'crlv': 'bg-purple-500',
                                'outros': 'bg-gray-500'
                            };
                            
                            return \`
                                <div>
                                    <div class="flex justify-between mb-1">
                                        <span class="text-sm font-medium text-gray-700 capitalize">\${service}</span>
                                        <span class="text-sm text-gray-500">\${count} (\${percentage}%)</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div class="\${serviceColors[service]} h-2 rounded-full" style="width: \${percentage}%"></div>
                                    </div>
                                </div>
                            \`;
                        }).join('')}
                </div>
            \`;
            
            document.getElementById('services-chart').innerHTML = chartHtml;
        }

        // Abrir modal de aprovação
        function openApprovalModal(messageId) {
            const msg = messages.find(m => m.id === messageId);
            if (!msg) return;
            
            const analysis = msg.gemini_analysis ? JSON.parse(msg.gemini_analysis) : null;
            
            document.getElementById('modal-content').innerHTML = \`
                <div class="space-y-6">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <h4 class="font-bold text-gray-800 mb-2">Mensagem original:</h4>
                        <p class="text-gray-700">"\${msg.text_message}"</p>
                    </div>
                    
                    <div>
                        <h4 class="font-bold text-gray-800 mb-2">Resposta sugerida pelo Gemini:</h4>
                        <textarea id="response-text" class="w-full h-40 p-3 border rounded-lg text-gray-700" 
                                  placeholder="Digite a resposta aprimorada...">\${msg.resposta_gerada || ''}</textarea>
                    </div>
                    
                    <div class="text-sm text-gray-600">
                        <i class="fas fa-info-circle mr-2"></i>
                        Ao aprovar, esta resposta poderá ser enviada ao cliente (quando o sistema for ativado).
                    </div>
                </div>
            \`;
            
            currentMessageId = messageId;
            document.getElementById('approval-modal').classList.remove('hidden');
        }

        // Fechar modal
        function closeModal() {
            document.getElementById('approval-modal').classList.add('hidden');
        }

        // Aprovar resposta
        async function approveResponse() {
            try {
                const responseText = document.getElementById('response-text').value;
                
                const response = await fetch('/api/approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageId: currentMessageId,
                        approvedResponse: responseText
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('Resposta aprovada com sucesso!');
                    closeModal();
                    loadMessages();
                    showMessageDetail(currentMessageId);
                } else {
                    alert('Erro ao aprovar resposta: ' + result.error);
                }
                
            } catch (error) {
                console.error('Erro ao aprovar:', error);
                alert('Erro ao aprovar resposta');
            }
        }

        // Editar resposta
        function editResponse(messageId) {
            openApprovalModal(messageId);
        }

        // Testar mensagem
        async function testMessage() {
            const testText = prompt('Digite uma mensagem de teste:', 'Olá, preciso transferir meu carro');
            if (!testText) return;
            
            try {
                const response = await fetch('/test-zapi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: testText })
                });
                
                const result = await response.json();
                alert('Mensagem de teste enviada! ID: ' + result.payload.messageId);
                loadMessages();
                
            } catch (error) {
                alert('Erro ao enviar teste: ' + error.message);
            }
        }

        // Exportar dados
        async function exportData() {
            try {
                const response = await fetch('/api/messages?limit=1000');
                const data = await response.json();
                
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = \`wdespachante-mensagens-\${new Date().toISOString().split('T')[0]}.json\`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert('Dados exportados com sucesso!');
                
            } catch (error) {
                alert('Erro ao exportar dados: ' + error.message);
            }
        }

        // Mostrar estatísticas
        function showStats() {
            alert('Funcionalidade de estatísticas detalhadas em desenvolvimento!');
        }

        // Inicialização
        document.addEventListener('DOMContentLoaded', () => {
            loadStatus();
            loadMessages();
            
            // Atualizar a cada 30 segundos
            setInterval(() => {
                loadStatus();
                loadMessages();
            }, 30000);
        });
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

// API: Listar mensagens
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  
  db.all(`
    SELECT * FROM mensagens_zapi 
    WHERE text_message IS NOT NULL AND text_message != ''
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ 
        messages: rows,
        total: rows.length,
        limit,
        offset
      });
    }
  });
});

// API: Obter mensagem específica
app.get('/api/messages/:id', (req, res) => {
  const id = req.params.id;
  
  db.get('SELECT * FROM mensagens_zapi WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!row) {
      res.status(404).json({ error: 'Mensagem não encontrada' });
    } else {
      res.json({ message: row });
    }
  });
});

// API: Aprovar resposta
app.post('/api/approve', (req, res) => {
  const { messageId, approvedResponse } = req.body;
  
  if (!messageId || !approvedResponse) {
    return res.status(400).json({ error: 'messageId e approvedResponse são obrigatórios' });
  }
  
  db.run(`
    UPDATE mensagens_zapi 
    SET aprovada_por_humano = TRUE, 
        resposta_aprovada = ?,
        observacoes = 'Aprovado via dashboard'
    WHERE id = ?
  `, [approvedResponse, messageId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ 
        success: true, 
        message: 'Resposta aprovada com sucesso',
        changes: this.changes
      });
    }
  });
});

// Endpoint de debug
app.get('/debug', (req, res) => {
  db.all('SELECT COUNT(*) as total FROM mensagens_zapi', (err, rows) => {
    const count = rows ? rows[0].total : 0;
    
    res.json({
      status: 'debug',
      messages_received: count,
      instance_id: ZAPI_CONFIG.INSTANCE_ID,
      gemini_enabled: GEMINI_CONFIG.ENABLED,
      timestamp: new Date().toISOString(),
      instructions: 'POST to /test-zapi to simulate Z-API message'
    });
  });
});

// Endpoint de teste Z-API
app.post('/test-zapi', (req, res) => {
  console.log('📨 Test Z-API Payload:', JSON.stringify(req.body, null, 2));
  
  const testPayload = {
    phone: '5511999999999',
    text: { message: req.body.text || 'Teste de mensagem' },
    type: 'ReceivedCallback',
    instanceId: ZAPI_CONFIG.INSTANCE_ID,
    sender: { phone: '5511999999999', name: 'Test User' },
    message: { text: req.body.text || 'Teste de mensagem', type: 'text' }
  };
  
  processZAPIMessage(testPayload);
  
  res.json({
    status: 'test_received',
    message: 'Test payload processed',
    payload: testPayload
  });
});

// Webhook principal Z-API
app.post('/webhook', (req, res) => {
  console.log('📨 Z-API Webhook Recebido');
  
  // Responder imediatamente ao Z-API (200 OK)
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

// Processar mensagem Z-API (mesma função do server.js original)
async function processZAPIMessage(payload) {
  try {
    // Extrair dados básicos
    const phone = payload.phone || payload.sender?.phone || 'unknown';
    const text = payload.text?.message || payload.message?.text || '';
    const type = payload.type || 'ReceivedCallback';
    const instanceId = payload.instanceId || ZAPI_CONFIG.INSTANCE_ID;
    const messageId = payload.messageId || `msg_${Date.now()}`;
    const isGroup = payload.isGroup || false;
    const fromMe = payload.fromMe || false;
    
    console.log(`📱 Mensagem: "${text}" de ${phone}`);
    
    // Salvar no banco de dados
    db.run(`
      INSERT INTO mensagens_zapi 
      (instance_id, phone, message_id, type, event_type, text_message, is_group, from_me, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      instanceId,
      phone,
      messageId,
      type,
      'message',
      text,
      isGroup ? 1 : 0,
      fromMe ? 1 : 0,
      JSON.stringify(payload)
    ], function(err) {
      if (err) {
        console.error('Erro salvar mensagem:', err);
      } else {
        console.log(`💾 Mensagem salva com ID: ${this.lastID}`);
        
        // Se não for de mim e tiver texto, analisar com Gemini
        if (!fromMe && text.trim() && GEMINI_CONFIG.ENABLED) {
          setTimeout(() => analisarComGemini(this.lastID, text, phone), 500);
        }
      }
    });
    
  } catch (error) {
    console.error('Erro processZAPIMessage:', error);
  }
}

// Analisar com Gemini (mesma função do server.js original)
async function analisarComGemini(messageId, text, phone) {
  try {
    console.log('🧠 Analisando com Gemini...');
    
    const prompt = `Analise esta mensagem de WhatsApp de um cliente de despachante:

"${text}"

Retorne JSON com:
{
  "tipo_servico": "transferencia|multas|ipva|licenciamento|atpv|crlv|outros",
  "confianca": 0.0 a 1.0,
  "documentos_necessarios": ["lista"],
  "resposta_sugerida": "texto em português"
}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.MODEL}:generateContent?key=${GEMINI_CONFIG.API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: GEMINI_CONFIG.TEMPERATURE,
          maxOutputTokens: GEMINI_CONFIG.MAX_TOKENS
        }
      },
      { timeout: 10000 }
    );

    if (response.status === 200) {
      const geminiResponse = response.data.candidates[0].content.parts[0].text;
      console.log('✅ Gemini respondeu:', geminiResponse.substring(0, 200));
      
      // Extrair JSON da resposta
      let analysis = {};
      try {
        const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('Erro parsear JSON Gemini:', e);
        analysis = { tipo_servico: 'outros', confianca: 0.5, resposta_sugerida: 'Não consegui analisar' };
      }
      
      // Atualizar banco com análise
      db.run(`
        UPDATE mensagens_zapi 
        SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE
        WHERE id = ?
      `, [JSON.stringify(analysis), analysis.resposta_sugerida || '', messageId], (err) => {
        if (err) {
          console.error('Erro atualizar análise:', err);
        } else {
          console.log(`📊 Análise Gemini salva para mensagem ${messageId}`);
          console.log(`Tipo: ${analysis.tipo_servico}, Confiança: ${analysis.confianca}`);
          
          // **NÃO ENVIAR RESPOSTA** - Modo treinamento
          console.log('⚠️ Modo treinamento: resposta NÃO enviada');
        }
      });
    }
  } catch (error) {
    console.error('Erro Gemini:', error.response?.data || error.message);
    
    // Fallback para análise simples
    const fallbackAnalysis = analiseFallback(text);
    db.run(`
      UPDATE mensagens_zapi 
      SET gemini_analysis = ?, resposta_gerada = ?, processed = TRUE
      WHERE id = ?
    `, [
      JSON.stringify(fallbackAnalysis),
      fallbackAnalysis.resposta_sugerida,
      messageId
    ], (err) => {
      if (err) console.error('Erro salvar fallback:', err);
    });
  }
}

// Análise fallback (keywords) - mesma função
function analiseFallback(text) {
  const lowerText = text.toLowerCase();
  
  let tipo_servico = 'outros';
  let confianca = 0.3;
  let documentos = [];
  let resposta = '';
  
  if (lowerText.includes('transfer') || lowerText.includes('vender carro') || lowerText.includes('comprar carro')) {
    tipo_servico = 'transferencia';
    confianca = 0.8;
    documentos = ['CRLV do veículo', 'CNH comprador', 'CNH vendedor', 'Comprovante residência'];
    resposta = 'Olá! Para transferência precisamos do CRLV do veículo, CNHs e comprovante de residência. Honorários: R$ 250,00.';
  } else if (lowerText.includes('multa') || lowerText.includes('lei seca') || lowerText.includes('infração')) {
    tipo_servico = 'multas';
    confianca = 0.7;
    documentos = ['Auto de infração', 'CNH do motorista'];
    resposta = 'Olá! Para análise de multas precisamos do auto de infração. Trabalhamos com CT Multas especialistas em recursos.';
  } else if (lowerText.includes('ipva') || lowerText.includes('licenciamento')) {
    tipo_servico = 'ipva';
    confianca = 0.9;
    documentos = ['CRLV do veículo'];
    resposta = 'Olá! Para IPVA/licenciamento precisamos do CRLV. Honorários: R$ 250,00.';
  } else if (lowerText.includes('crlv') || lowerText.includes('documento')) {
    tipo_servico = 'crlv';
    confianca = 0.9;
    documentos = ['RG/CNH'];
    resposta = 'Olá! Para emissão de CRLV digital precisamos do RG/CNH. Valor: R$ 80,00.';
  } else {
    resposta = 'Olá! Como posso ajudar? Preciso de mais informações sobre qual serviço precisa.';
  }
  
  return {
    tipo_servico,
    confianca,
    documentos_necessarios: documentos,
    resposta_sugerida: resposta,
    usa_fallback: true
  };
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Z-API Dashboard rodando na porta ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   • POST /webhook - Webhook Z-API`);
  console.log(`   • GET /dashboard - Dashboard visual`);
  console.log(`   • GET /api/messages - API de mensagens`);
  console.log(`   • POST /api/approve - Aprovar respostas`);
  console.log(`   • GET /health - Status saúde`);
  console.log(`🔧 Configurações:`);
  console.log(`   • Instance ID: ${ZAPI_CONFIG.INSTANCE_ID}`);
  console.log(`   • Gemini: ${GEMINI_CONFIG.ENABLED ? '✅ Ativo' : '❌ Inativo'}`);
  console.log(`   • Dashboard: ✅ Ativo`);
  console.log(`   • Auto-resposta: ❌ DESLIGADA (modo treinamento)`);
});

// Manter vivo no Render
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    console.log('🫀 Keep-alive pulse');
  }, 5 * 60 * 1000);
}