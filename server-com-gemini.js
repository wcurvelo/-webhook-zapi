// server-com-gemini.js - Webhook Z-API com Gemini Flash
// Integração do Gemini 2.0 Flash com análise automática de mensagens

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para Render (free tier)
const RENDER_KEEP_ALIVE = process.env.NODE_ENV === 'production';
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Configuração do banco de dados
const DB_PATH = process.env.DB_PATH || '/tmp/clientes.db';

// Configuração Z-API
const ZAPI_CONFIG = {
  INSTANCE_ID: process.env.ZAPI_INSTANCE_ID || '***REMOVED***',
  TOKEN: process.env.ZAPI_TOKEN || '***REMOVED***',
  API_URL: process.env.ZAPI_API_URL || 'https://api.z-api.io/instances/***REMOVED***/token/***REMOVED***',
  CLIENT_TOKEN: process.env.ZAPI_CLIENT_TOKEN || '***REMOVED***',
  RESPONSE_ENABLED: true // ATIVADO para resposta automática
};

// Configuração Gemini
const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY || '***REMOVED***',
  MODEL: 'gemini-2.0-flash',
  ENABLED: true, // Ativar/desativar Gemini
  ANALISES_PATH: '/home/wcurvelo/railway-project/sistema-clientes/analises_gemini/',
  MAX_TOKENS: 500,
  TEMPERATURE: 0.2
};

// Cooldown entre respostas (30 segundos)
const RESPONSE_COOLDOWN_MS = 30 * 1000;
const lastResponseTime = new Map();

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
  const sqlAnalises = `
    CREATE TABLE IF NOT EXISTS analise_gemini (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensagem_id INTEGER NOT NULL,
      tipo_servico TEXT,
      urgencia INTEGER DEFAULT 0,
      complexidade INTEGER DEFAULT 0,
      acao_sugerida TEXT,
      template_resposta TEXT,
      confianca REAL DEFAULT 0.0,
      raw_response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (mensagem_id) REFERENCES mensagens(id)
    )
  `;
  
  db.exec(sqlAnalises, (err) => {
    if (err) {
      console.error('Erro ao criar tabela analise_gemini:', err.message);
    } else {
      console.log('Tabela analise_gemini criada/verificada');
    }
  });
  
  // Verificar se tabela mensagens existe
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='mensagens'", (err, row) => {
    if (err) {
      console.error('Erro ao verificar tabela mensagens:', err.message);
    } else if (!row) {
      console.log('Criando tabela mensagens...');
      const sqlMensagens = `
        CREATE TABLE mensagens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id INTEGER,
          telefone TEXT NOT NULL,
          mensagem TEXT NOT NULL,
          tipo TEXT,
          intencao TEXT,
          data_recebimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          origem TEXT DEFAULT 'z-api',
          message_id TEXT,
          instance_id TEXT,
          processed BOOLEAN DEFAULT FALSE,
          resposta_gerada TEXT,
          resposta_enviada BOOLEAN DEFAULT FALSE,
          resposta_timestamp TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )
      `;
      db.exec(sqlMensagens);
    }
  });
}

// Middleware
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging detalhado
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  if (data && typeof data === 'object') {
    console.log(`[${timestamp}] ${message}:`, JSON.stringify(data, null, 2));
  } else if (data) {
    console.log(`[${timestamp}] ${message}: ${data}`);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
};

// Função para chamar análise Gemini via Python
async function analisarComGemini(mensagemTexto, contextoCliente = null) {
  
  return new Promise((resolve, reject) => {
    
    const comando = `cd /home/wcurvelo/railway-project/sistema-clientes && python3 -c "
import sys
sys.path.append('.')
from analise_gemini_melhorada import analisar_mensagem_json
import json
try:
    resultado = analisar_mensagem_json('${mensagemTexto.replace(/'/g, "\\'")}', '${contextoCliente || ''}')
    print(resultado)
except Exception as e:
    print(json.dumps({'error': str(e), 'tipo_servico': 'outros', 'confianca': 0.3}))
"`;
    
    exec(comando, (error, stdout, stderr) => {
      
      if (error) {
        log('❌ Erro ao executar análise Gemini:', error.message);
        resolve({
          tipo_servico: 'outros',
          urgencia: 3,
          complexidade: 3,
          acao_sugerida: 'escalar_humano',
          template_resposta: 'Recebi sua mensagem! Um especialista entrará em contato em breve.',
          confianca: 0.3,
          error: error.message
        });
        return;
      }
      
      if (stderr) {
        log('⚠️ Stderr Gemini:', stderr.substring(0, 200));
      }
      
      try {
        const resultado = JSON.parse(stdout.trim());
        log('✅ Análise Gemini concluída', {
          tipo: resultado.tipo_servico,
          confianca: resultado.confianca,
          urgencia: resultado.urgencia
        });
        resolve(resultado);
        
      } catch (parseError) {
        log('❌ Erro ao parsear resposta Gemini:', parseError.message);
        log('Resposta original:', stdout.substring(0, 300));
        
        // Fallback
        resolve({
          tipo_servico: 'outros',
          urgencia: 3,
          complexidade: 3,
          acao_sugerida: 'escalar_humano',
          template_resposta: 'Recebi sua mensagem! Um especialista entrará em contato em breve.',
          confianca: 0.3,
          parse_error: parseError.message
        });
      }
      
    });
    
  });
  
}

// Função para verificar cooldown
function podeEnviarResposta(telefone) {
  const agora = Date.now();
  const ultimoTempo = lastResponseTime.get(telefone);
  
  if (!ultimoTempo) {
    return { podeEnviar: true, tempoRestante: 0 };
  }
  
  const tempoDesdeUltimo = agora - ultimoTempo;
  const tempoRestante = RESPONSE_COOLDOWN_MS - tempoDesdeUltimo;
  
  if (tempoDesdeUltimo >= RESPONSE_COOLDOWN_MS) {
    return { podeEnviar: true, tempoRestante: 0 };
  } else {
    return { podeEnviar: false, tempoRestante: Math.ceil(tempoRestante / 1000) };
  }
  
}

// Função para enviar resposta via Z-API
async function enviarRespostaZAPI(telefone, mensagem) {
  
  if (!ZAPI_CONFIG.RESPONSE_ENABLED) {
    log('Envio Z-API desabilitado por configuração');
    return { success: false, error: 'Envio desabilitado', sent: false };
  }
  
  // Verificar cooldown
  const cooldownCheck = podeEnviarResposta(telefone);
  if (!cooldownCheck.podeEnviar) {
    log('Cooldown ativo para telefone', { 
      telefone, 
      segundos_restantes: cooldownCheck.tempoRestante,
      mensagem: 'Aguardando 30 segundos entre respostas' 
    });
    return { 
      success: false, 
      sent: false, 
      error: `Cooldown ativo. Aguarde ${cooldownCheck.tempoRestante} segundos.`,
      cooldown: true,
      tempoRestante: cooldownCheck.tempoRestante
    };
  }
  
  try {
    
    // Formatar número
    let phone = telefone.toString().trim();
    if (!phone.startsWith('55')) {
      phone = '55' + phone.replace(/\D/g, '');
    }
    
    // Garantir que seja celular (adicionar 9 após DDD se necessário)
    if (phone.length === 12) { // 55 + DDD (2) + 8 dígitos
      phone = phone.substring(0, 4) + '9' + phone.substring(4);
    }
    
    const payload = {
      phone: phone,
      message: mensagem
    };
    
    log('Enviando resposta via Z-API', { 
      telefone: phone, 
      mensagem_preview: mensagem.substring(0, 50) + '...',
      cooldown: 'não aplicado (primeira mensagem ou >30s)'
    });
    
    const response = await axios.post(ZAPI_CONFIG.API_URL + '/send-text', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CONFIG.CLIENT_TOKEN
      },
      timeout: 15000
    });
    
    // Atualizar timestamp do último envio
    lastResponseTime.set(telefone, Date.now());
    
    log('Resposta Z-API enviada com sucesso', { 
      status: response.status, 
      messageId: response.data?.messageId,
      cooldown_set: '30 segundos'
    });
    
    return {
      success: true,
      sent: true,
      status: response.status,
      data: response.data,
      messageId: response.data?.messageId || response.data?.id,
      cooldown: false

    };
    
  } catch (error) {
    
    log('Erro ao enviar resposta Z-API', { error: error.message, telefone });
    
    if (error.response) {
      return {
        success: false,
        sent: false,
        status: error.response.status,
        error: error.response.data?.message || error.message,
        details: error.response.data,
        cooldown: false
      };
    }
    
    return {
      success: false,
      sent: false,
      status: 0,
      error: error.message,
      details: null,
      cooldown: false
    };
    
  }
  
}

// Função para extrair dados da mensagem Z-API
function extrairDadosZAPI(body) {
  
  try {
    
    log('DEBUG: Payload completo recebido:', body);
    
    // Inicializar resultado
    const resultado = {
      instanceId: body?.instance || body?.data?.instance || 'unknown',
      type: body?.type || 'ReceivedCallback',
      from: '',
      text: '',
      messageId: '',
      timestamp: body?.timestamp || body?.data?.timestamp || body?.date || body?.data?.date || new Date().toISOString(),
      rawBody: JSON.stringify(body).substring(0, 500) + '...'
    };
    
    // Extrair telefone
    const possibleFromFields = ['from', 'phone', 'sender', 'number', 'chatId'];
    for (const field of possibleFromFields) {
      if (body[field]) {
        resultado.from = body[field];
        break;
      }
      if (body.data && body.data[field]) {
        resultado.from = body.data[field];
        break;
      }
    }
    
    // Extrair texto
    const possibleTextFields = ['text', 'body', 'message', 'content', 'msg'];
    for (const field of possibleTextFields) {
      if (body[field]) {
        resultado.text = body[field];
        break;
      }
      if (body.data && body.data[field]) {
        resultado.text = body.data[field];
        break;
      }
    }
    
    // Extrair messageId
    const possibleIdFields = ['messageId', 'id', 'message_id'];
    for (const field of possibleIdFields) {
        if (body[field]) {
          resultado.messageId = body[field];
          break;
        }
        if (body.data && body.data[field]) {
          resultado.messageId = body.data[field];
          break;
        }
    }
    
    // Limpar telefone (remover @c.us se presente)
    if (resultado.from.includes('@')) {
      resultado.from = resultado.from.split('@')[0];
    }
    
    log('DEBUG: Dados extraídos:', {
      from: resultado.from,
      text_preview: resultado.text.substring(0, 100),
      type: resultado.type,
      instanceId: resultado.instanceId
    });
    
    return resultado;
    
  } catch (error) {
    
    log('ERRO ao extrair dados Z-API:', error.message);
    
    return {
      instanceId: 'error',
      type: 'error',
      from: 'error',
      text: `Erro ao processar mensagem: ${error.message}`,
      messageId: '',
      timestamp: new Date().toISOString(),
      rawBody: JSON.stringify(body || {}).substring(0, 500) + '...'
    };
    
  }
  
}

// Rota principal do webhook
app.post('/webhook', async (req, res) => {
  
  let mensagemSalva = false;
  let mensagemId = null;
  let analiseGemini = null;
  let respostaEnviada = false;
  let arquivosSalvos = [];
  
  try {
    
    const { body } = req;
    
    log('=== WEBHOOK RECEBIDO ===');
    log('Body completo (resumido):', {
      type: body?.type,
      instance: body?.instance,
      hasData: !!body?.data,
      keys: Object.keys(body || {})

    });
    
    // Extrair dados da mensagem
    const mensagemData = extrairDadosZAPI(body);
    
    log('Dados extraídos:', {
      from: mensagemData.from,
      text_preview: mensagemData.text.substring(0, 100),
      type: mensagemData.type,
      instanceId: mensagemData.instanceId

    });
    
    // Salvar mensagem no banco
    const salvarMensagem = new Promise((resolve, reject) => {
      
      const sql = `
        INSERT INTO mensagens (
          telefone, 
          mensagem, 
          tipo,
          data_recebimento,
          origem,
          instance_id,
          message_id,
          processed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        mensagemData.from,
        mensagemData.text || '(sem texto)',
        'outros',
        mensagemData.timestamp,
        'z-api',
        mensagemData.instanceId,
        mensagemData.messageId,
        false

      ];
      
      db.run(sql, params, function(err) {
        
        if (err) {
          log('Erro ao salvar mensagem no banco:', err.message);
          reject(err);
        } else {
          
          mensagemSalva = true;
          mensagemId = this.lastID;
          
          log('Mensagem salva no banco', { 
            id: mensagemId, 
            telefone: mensagemData.from,
            texto_preview: mensagemData.text.substring(0, 50) 
          });
          
          resolve(mensagemId);
          
        }
        
      });
      
    });
    
    // Analisar com Gemini (se habilitado)
    if (GEMINI_CONFIG.ENABLED && mensagemData.text && mensagemData.text.length > 3) {
      
      log('Iniciando análise Gemini...');
      
      try {
        
        analiseGemini = await analisarComGemini(mensagemData.text, `Telefone: ${mensagemData.from}`);
        
        log('Análise Gemini concluída', {
          tipo: analiseGemini.tipo_servico,
          confianca: analiseGemini.confianca,
          template_preview: analiseGemini.template_resposta.substring(0, 80) + '...'

        });
        
        // Salvar análise no banco (se temos ID da mensagem)
        if (mensagemId) {
          
          const sqlAnalise = `
            INSERT INTO analise_gemini (
              mensagem_id,
              tipo_servico,
              urgencia,
              complexidade,
              acao_sugerida,
              template_resposta,
              confianca,
              raw_response
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const paramsAnalise = [
            mensagemId,
            analiseGemini.tipo_servico,
            analiseGemini.urgencia,
            analiseGemini.complexidade,
            analiseGemini.acao_sugerida,
            analiseGemini.template_resposta,
            analiseGemini.confianca,
            JSON.stringify(analiseGemini)

          ];
          
          db.run(sqlAnalise, paramsAnalise, (err) => {
            if (err) {
              log('Erro ao salvar análise Gemini:', err.message);
            } else {
              log('Análise Gemini salva no banco');
            }

          });
          
        }
        
        // Enviar resposta automática (se confiança > 50%)
        if (analiseGemini.confianca > 0.5 && mensagemData.from !== 'unknown' && mensagemData.from !== 'error') {
          
          const resultadoEnvio = await enviarRespostaZAPI(mensagemData.from, analiseGemini.template_resposta);
          
          respostaEnviada = resultadoEnvio.sent;
          
          if (respostaEnviada) {
            
            log('Resposta automática enviada via Z-API', { messageId: resultadoEnvio.messageId });
            
            // Atualizar mensagem no banco
            db.run("UPDATE mensagens SET resposta_gerada = ?, resposta_enviada = ?, resposta_timestamp = CURRENT_TIMESTAMP WHERE id = ?", 
              [analiseGemini.template_resposta, true, mensagemId], 
              (err) => {
                if (err) {
                  log('Erro ao atualizar resposta:', err.message);
                }

              });
            
          } else {
            
            if (resultadoEnvio.cooldown) {
              log('Cooldown ativo - resposta não enviada', { 
                telefone: mensagemData.from, 
                segundos_restantes: resultadoEnvio.tempoRestante,
                motivo: 'Aguardando 30 segundos entre respostas'

              });
            } else {
              log('Falha ao enviar resposta via Z-API', { error: resultadoEnvio.error });
            }

          }

        } catch (geminiError) {

          log('Erro ao processar análise Gemini:', geminiError.message);

        }

      }

      // Responder com sucesso

      const resposta = {

        status: 'success',

        message: 'Webhook recebido e processado',

        timestamp: new Date().toISOString(),

        saved: mensagemSalva,

        messageId: mensagemId,

        gemini_analysis: analiseGemini ? {

          type: analiseGemini.tipo_servico,

          urgency: analiseGemini.urgencia,

          confidence: analiseGemini.confianca,

          response_preview: analiseGemini.template_resposta.substring(0, 100) + (analiseGemini.template_resposta.length > 100 ? '...' : '')

        } : null,

        response_sent: respostaEnviada,

        features: [

          'Message reception',

          'Gemini analysis (enabled)',

          'Auto response (if confidence > 50%)',

          'Database saving'

        ]

      };

      res.status(200).json(resposta);

      log('Webhook respondido com sucesso', resposta);

    } catch (error) {

      log('ERRO CRÍTICO no webhook', {

        error: error.message,

        stack: error.stack,

        timestamp: new Date().toISOString()

      });

      // Responder com erro mas manter conexão

      res.status(200).json({

        status: 'error',

        message: 'Erro interno no servidor',

        timestamp: new Date().toISOString(),

        saved: mensagemSalva

      });

    }

  });

  // Health check

  app.get('/health', (req, res) => {

    const health = {

      status: 'healthy',

      timestamp: new Date().toISOString(),

      service: 'webhook-zapi-gemini',

      version: '1.0.0',

      database: 'connected',

      zapi_enabled: ZAPI_CONFIG.RESPONSE_ENABLED,

      gemini_enabled: GEMINI_CONFIG.ENABLED,

      features: [

        'Message reception',

        'Gemini analysis',

        'Auto response',

        'Database saving'

      ],

      notes: 'Integration with Gemini 2.0 Flash for intelligent message analysis'

    };

    db.get("SELECT COUNT(*) as count FROM mensagens", (err, row) => {

      if (!err) health.messagesCount = row.count;

      db.get("SELECT COUNT(*) as count FROM analise_gemini", (err, row) => {

        if (!err) health.geminiAnalysisCount = row.count;

        log('Health check solicitado', { ip: req.ip });

        res.status(200).json(health);

      });

    });

  });

  // Status para debug

  app.get('/status', (req, res) => {

    db.all("SELECT id, telefone, SUBSTR(mensagem, 1, 30) as preview, tipo, resposta_enviada FROM mensagens ORDER BY id DESC LIMIT 5", (err, rows) => {

      const status = {

        service: 'Z-API Webhook + Gemini',

        version: '1.0.0',

        status: 'operational',

        auto_response: 'ENABLED (confidence > 50%)',

        environment: process.env.NODE_ENV || 'development',

        timestamp: new Date().toISOString(),

        recent_messages: err ? [] : rows,

        features: [

          'Gemini 2.0 Flash integration',

          'Intelligent message analysis',

          'Auto response based on confidence',

          'Database storage',

          'Fallback keyword analysis'

        ],

        config: {

          gemini_enabled: GEMINI_CONFIG.ENABLED,

          cooldown_seconds: RESPONSE_COOLDOWN_MS / 1000,

          response_threshold: 0.5

        }

      };

      res.status(200).json(status);

    });

  });

  // Rota para testar análise Gemini manualmente

  app.post('/analyze', async (req, res) => {

    try {

      const { text, context } = req.body;

      if (!text) {

        return res.status(400).json({

          status: 'error',

          message: 'Parâmetro text é obrigatório'

        });

      }

      log('Análise manual solicitada', { text_preview: text.substring(0, 100), context });

      const analise = await analisarComGemini(text, context);

      res.status(200).json({

        status: 'success',

        analysis: analise,

        suggestions: {

          action: analise.acao_sugerida,

          response_template: analise.template_resposta

        }

      });

    } catch (error) {

      log('Erro na análise manual', { error: error.message });

      res.status(500).json({

        status: 'error',

        message: error.message

      });

    }

  });

  // Keep-alive para Render free tier

  if (RENDER_KEEP_ALIVE) {

    log('Keep-alive ativado para Render free tier');

    setInterval(() => {

      log('Keep-alive ping enviado');

    }, KEEP_ALIVE_INTERVAL);

  }

  // Iniciar servidor

  const server = app.listen(PORT, () => {

    log(`🚀 Servidor iniciado na porta ${PORT}`);

    log(`✅ Resposta automática: ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'ATIVADA' : 'DESATIVADA'}`);

    log(`🧠 Análise Gemini: ${GEMINI_CONFIG.ENABLED ? 'ATIVADA' : 'DESATIVADA'}`);

    log(`📁 Banco de dados: ${DB_PATH}`);

    console.log(`

      ========================================

      🧠 Z-API Webhook com Gemini 2.0 Flash

      ========================================

      Porta: ${PORT}

      Health: http://localhost:${PORT}/health

      Webhook: POST http://localhost:${PORT}/webhook

      Análise: POST http://localhost:${PORT}/analyze

      Banco: ${DB_PATH}

      Gemini: ${GEMINI_CONFIG.ENABLED ? 'ATIVADO' : 'DESATIVADO'}

      ========================================

    `);

  });

  // Graceful shutdown

  process.on('SIGTERM', () => {

    log('Recebido SIGTERM, encerrando servidor...');

    db.close((err) => {

      if (err) {

        log('Erro ao fechar banco de dados:', err.message);

      } else {

        log('Banco de dados fechado');

      }

      server.close(() => {

        log('Servidor encerrado');

        process.exit(0);

      });

    });

  });

  process.on('SIGINT', () => {

    log('Recebido SIGINT, encerrando servidor...');

    db.close(() => {

      server.close(() => {

        log('Servidor encerrado');

        process.exit(0);

      });

    });

  });

  module.exports = app;