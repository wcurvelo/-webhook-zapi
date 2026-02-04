// server-zapi-fix.js - Webhook corrigido para Z-API com Gemini
// Baseado na documentação oficial: https://developer.z-api.io/webhooks/on-message-received

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
      resposta_enviada BOOLEAN DEFAULT FALSE
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
    service: 'webhook-zapi-fix',
    version: '1.0.0',
    endpoints: ['/webhook', '/debug', '/test-zapi'],
    features: ['zapi-webhook', 'gemini-analysis', 'auto-response-DISABLED']
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
  
  // Simular payload Z-API
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
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body (primeiros 1000 chars):', JSON.stringify(req.body).substring(0, 1000));
  
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

// Processar mensagem Z-API
async function processZAPIMessage(payload) {
  try {
    console.log('🔧 Processando mensagem Z-API...');
    
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

// Analisar com Gemini
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

// Análise fallback (keywords)
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
  console.log(`🚀 Servidor Z-API Fix rodando na porta ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   • POST /webhook - Webhook Z-API`);
  console.log(`   • GET /health - Status saúde`);
  console.log(`   • GET /debug - Debug info`);
  console.log(`   • POST /test-zapi - Testar mensagem`);
  console.log(`🔧 Configurações:`);
  console.log(`   • Instance ID: ${ZAPI_CONFIG.INSTANCE_ID}`);
  console.log(`   • Gemini: ${GEMINI_CONFIG.ENABLED ? '✅ Ativo' : '❌ Inativo'}`);
  console.log(`   • Auto-resposta: ❌ DESLIGADA (modo treinamento)`);
});

// Manter vivo no Render
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    console.log('🫀 Keep-alive pulse');
  }, 5 * 60 * 1000);
}