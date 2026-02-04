// server-com-resposta.js - Webhook com análise e resposta automática
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
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
  RESPONSE_ENABLED: process.env.RESPONSE_ENABLED === 'true' || false // Por padrão desabilitado
};

// Conectar ao banco de dados
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('Conectado ao banco de dados SQLite:', DB_PATH);
    
    // Verificar se tabela mensagens existe
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='mensagens'", (err, row) => {
      if (err) {
        console.error('Erro ao verificar tabela mensagens:', err.message);
      } else if (!row) {
        console.log('Tabela mensagens não encontrada. Criando...');
        criarTabelaMensagens();
      } else {
        console.log('Tabela mensagens já existe.');
      }
    });
  }
});

// Criar tabela se não existir
function criarTabelaMensagens() {
  const sql = `
    CREATE TABLE IF NOT EXISTS mensagens (
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
    );
    
    CREATE INDEX IF NOT EXISTS idx_mensagens_telefone ON mensagens(telefone);
    CREATE INDEX IF NOT EXISTS idx_mensagens_data ON mensagens(data_recebimento);
  `;
  
  db.exec(sql, (err) => {
    if (err) {
      console.error('Erro ao criar tabela mensagens:', err.message);
    } else {
      console.log('Tabela mensagens criada com sucesso.');
    }
  });
}

// Middleware
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging melhorado para produção
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

// Função para analisar mensagem e gerar resposta
function analisarMensagem(mensagemTexto) {
  const mensagem = mensagemTexto.toLowerCase().trim();
  
  // Palavras-chave para cada tipo de serviço
  const keywords = {
    transferencia: ['transferência', 'transferir', 'venda', 'compra', 'mudar dono', 'alteração proprietário', 'documento veículo'],
    ipva: ['ipva', 'imposto', 'atrasado', 'divida', 'débito', 'exercício', 'pagamento', 'multa ipva'],
    licenciamento: ['licenciamento', 'licença', 'renavam', 'placas', 'documento veículo', 'crv', 'crlv'],
    multas: ['multa', 'infração', 'penalidade', 'ponto na carteira', 'detran', 'auto de infração'],
    crlv: ['crlv', 'documento veículo', 'certificado', 'registro', 'documentação', 'renavam'],
    documentacao: ['documento', 'documentação', 'cpf', 'rg', 'comprovante', 'endereço', 'certidão'],
    consulta: ['consulta', 'preço', 'custo', 'quanto', 'valor', 'orçamento', 'orcamento', 'informação'],
    urgencia: ['urgente', 'urgência', 'rápido', 'imediatamente', 'hoje', 'agora', 'preciso já', 'asap'],
    cumprimento: ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'como vai'],
    confirmacao: ['ok', 'entendi', 'certo', 'beleza', 'obrigado', 'grato', 'valeu', '👍', '✅']
  };
  
  // Inicializar resultados
  let tipoServico = 'outros';
  let urgencia = 3; // Padrão: média
  let acaoSugerida = 'escalar_humano';
  let templateResposta = 'Olá! Recebemos sua mensagem. Um especialista entrará em contato em breve.';
  let confianca = 0.3;
  
  // Detectar tipo de serviço
  for (const [servico, palavras] of Object.entries(keywords)) {
    if (['transferencia', 'ipva', 'licenciamento', 'multas', 'crlv', 'documentacao', 'consulta'].includes(servico)) {
      for (const palavra of palavras) {
        if (mensagem.includes(palavra)) {
          tipoServico = servico;
          confianca = Math.min(confianca + 0.3, 0.8);
          break;
        }
      }
    }
  }
  
  // Detectar urgência
  for (const palavra of keywords.urgencia) {
    if (mensagem.includes(palavra)) {
      urgencia = 8; // Alta urgência
      acaoSugerida = 'responder_imediato';
      break;
    }
  }
  
  // Detectar cumprimentos/confirmações
  for (const palavra of keywords.cumprimento) {
    if (mensagem.includes(palavra) && mensagem.split(/\s+/).length < 5) {
      tipoServico = 'consulta';
      urgencia = 1;
      acaoSugerida = 'confirmar_recebimento';
      templateResposta = 'Olá! Tudo bem? Em que posso ajudar?';
      confianca = 0.9;
      break;
    }
  }
  
  for (const palavra of keywords.confirmacao) {
    if (mensagem.includes(palavra) && mensagem.split(/\s+/).length < 5) {
      tipoServico = 'confirmacao';
      urgencia = 1;
      acaoSugerida = 'agradecer';
      templateResposta = 'Obrigado pelo contato! Qualquer dúvida é só perguntar.';
      confianca = 0.9;
      break;
    }
  }
  
  // Ajustar complexidade baseada no tipo de serviço
  let complexidade = 5;
  if (tipoServico === 'transferencia' || tipoServico === 'ipva') {
    complexidade = 7;
  } else if (tipoServico === 'licenciamento' || tipoServico === 'multas') {
    complexidade = 6;
  } else if (tipoServico === 'crlv') {
    complexidade = 4;
  } else if (tipoServico === 'consulta') {
    complexidade = 3;
  }
  
  // Gerar resposta baseada no tipo de serviço
  switch (tipoServico) {
    case 'transferencia':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para calcular o valor da transferência, preciso dos seguintes documentos:\n1. CRLV do veículo\n2. Documentos do proprietário atual e novo\n3. Comprovante de endereço\n\nPode me enviar?';
      break;
    case 'ipva':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para regularizar o IPVA atrasado, preciso:\n1. CRLV do veículo\n2. Documento do proprietário\n3. Informações dos anos em atraso\n\nPode me enviar os documentos?';
      break;
    case 'licenciamento':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para fazer o licenciamento, preciso:\n1. CRLV do veículo\n2. Documento do proprietário\n3. Comprovante de pagamento das multas (se houver)\n\nTem esses documentos?';
      break;
    case 'multas':
      acaoSugerida = 'solicitar_informacoes';
      templateResposta = 'Para consultar multas, preciso:\n1. Placa do veículo\n2. Renavam\n3. CPF do proprietário\n\nPode me informar esses dados?';
      break;
    case 'consulta':
      acaoSugerida = 'responder_orcamento';
      templateResposta = 'Posso te ajudar com:\n• Transferência de veículo\n• IPVA atrasado\n• Licenciamento\n• Multas\n• CRLV/Documentação\n\nSobre qual serviço gostaria de saber mais?';
      break;
  }
  
  return {
    tipo_servico: tipoServico,
    urgencia: urgencia,
    complexidade: complexidade,
    acao_sugerida: acaoSugerida,
    template_resposta: templateResposta,
    confianca: Math.round(confianca * 100) / 100
  };
}

// Função para enviar mensagem via Z-API
async function enviarRespostaZAPI(telefone, mensagem) {
  if (!ZAPI_CONFIG.RESPONSE_ENABLED) {
    log('Envio Z-API desabilitado por configuração');
    return { success: false, error: 'Envio desabilitado', sent: false };
  }
  
  try {
    // Formatar número (remover espaços, adicionar 55 se necessário)
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
    
    log('Enviando resposta via Z-API', { telefone: phone, mensagem_preview: mensagem.substring(0, 50) + '...' });
    
    const response = await axios.post(ZAPI_CONFIG.API_URL + '/send-text', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CONFIG.CLIENT_TOKEN
      },
      timeout: 15000
    });
    
    log('Resposta Z-API enviada com sucesso', { status: response.status, messageId: response.data?.messageId });
    
    return {
      success: true,
      sent: true,
      status: response.status,
      data: response.data,
      messageId: response.data?.messageId || response.data?.id
    };
    
  } catch (error) {
    log('Erro ao enviar resposta Z-API', { error: error.message, telefone });
    
    if (error.response) {
      return {
        success: false,
        sent: false,
        status: error.response.status,
        error: error.response.data?.message || error.message,
        details: error.response.data
      };
    }
    
    return {
      success: false,
      sent: false,
      status: 0,
      error: error.message,
      details: null
    };
  }
}

// Função para salvar mensagem no banco
function salvarMensagemNoBanco(mensagemData, analise, callback) {
  const {
    instanceId,
    type,
    from,
    text,
    messageId,
    timestamp = new Date().toISOString()
  } = mensagemData;
  
  const sql = `
    INSERT INTO mensagens (
      telefone, 
      mensagem, 
      tipo,
      intencao,
      data_recebimento,
      origem,
      instance_id,
      message_id,
      processed,
      resposta_gerada
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const params = [
    from,
    text || '(sem texto)',
    analise.tipo_servico,
    analise.acao_sugerida,
    timestamp,
    'z-api',
    instanceId,
    messageId,
    false,
    analise.template_resposta
  ];
  
  db.run(sql, params, function(err) {
    if (err) {
      console.error('Erro ao salvar mensagem no banco:', err.message);
      callback(err, null);
    } else {
      const insertedId = this.lastID;
      log('Mensagem salva no banco', { id: insertedId, telefone: from, tipo: analise.tipo_servico });
      callback(null, insertedId);
    }
  });
}

// Função para extrair dados da mensagem Z-API
function extrairDadosZAPI(body) {
  try {
    // Formato Z-API padrão
    if (body?.data?.from && (body?.data?.text || body?.data?.body)) {
      return {
        instanceId: body.instance || body.data.instance,
        type: body.type || 'ReceivedCallback',
        from: body.data.from,
        text: body.data.text || body.data.body || '',
        messageId: body.data.messageId || body.data.id,
        timestamp: body.data.timestamp || new Date().toISOString(),
        rawBody: JSON.stringify(body).substring(0, 500) + '...'
      };
    }
    
    // Formato alternativo
    if (body?.from && body?.body) {
      return {
        instanceId: body.instanceId || body.instance,
        type: body.type || 'ReceivedCallback',
        from: body.from,
        text: body.body,
        messageId: body.messageId || body.id,
        timestamp: body.timestamp || new Date().toISOString(),
        rawBody: JSON.stringify(body).substring(0, 500) + '...'
      };
    }
    
    // Fallback para dados mínimos
    return {
      instanceId: body?.instance || 'unknown',
      type: body?.type || 'unknown',
      from: body?.data?.from || body?.from || 'unknown',
      text: body?.data?.text || body?.data?.body || body?.text || body?.body || '(sem texto)',
      messageId: body?.data?.messageId || body?.messageId || '',
      timestamp: new Date().toISOString(),
      rawBody: JSON.stringify(body).substring(0, 500) + '...'
    };
    
  } catch (error) {
    console.error('Erro ao extrair dados Z-API:', error.message);
    return {
      instanceId: 'error',
      type: 'error',
      from: 'error',
      text: `Erro ao processar mensagem: ${error.message}`,
      messageId: '',
      timestamp: new Date().toISOString(),
      rawBody: '{}'
    };
  }
}

// Rota para receber webhooks da Z-API
app.post('/webhook', async (req, res) => {
  let mensagemSalva = false;
  let mensagemId = null;
  let analiseResultado = null;
  let respostaEnviada = false;
  
  try {
    const { body } = req;
    
    log('Webhook recebido da Z-API', {
      type: body?.type,
      instanceId: body?.instance,
      hasData: !!body?.data,
      timestamp: new Date().toISOString()
    });
    
    // Extrair dados da mensagem
    const mensagemData = extrairDadosZAPI(body);
    
    log(`Mensagem processada`, {
      from: mensagemData.from,
      type: mensagemData.type,
      textPreview: mensagemData.text.substring(0, 100),
      length: mensagemData.text.length,
      instance: mensagemData.instanceId
    });
    
    // Analisar mensagem
    analiseResultado = analisarMensagem(mensagemData.text);
    
    log(`Análise da mensagem`, {
      tipo: analiseResultado.tipo_servico,
      urgencia: analiseResultado.urgencia,
      acao: analiseResultado.acao_sugerida,
      confianca: analiseResultado.confianca
    });
    
    // Salvar no banco de dados com análise
    salvarMensagemNoBanco(mensagemData, analiseResultado, (err, insertedId) => {
      if (err) {
        log('ERRO ao salvar mensagem no banco', { error: err.message });
      } else {
        mensagemSalva = true;
        mensagemId = insertedId;
        log('✅ Mensagem salva no banco com ID:', insertedId);
      }
    });
    
    // Enviar resposta automática se configurado
    if (ZAPI_CONFIG.RESPONSE_ENABLED && analiseResultado.confianca > 0.5) {
      const resultadoEnvio = await enviarRespostaZAPI(mensagemData.from, analiseResultado.template_resposta);
      respostaEnviada = resultadoEnvio.sent;
      
      if (respostaEnviada) {
        // Atualizar mensagem no banco com status de resposta enviada
        db.run("UPDATE mensagens SET resposta_enviada = ?, resposta_timestamp = CURRENT_TIMESTAMP WHERE id = ?", 
          [true, mensagemId], 
          (err) => {
            if (err) {
              log('Erro ao atualizar status de resposta', { error: err.message });
            }
          }
        );
      }
    }
    
    // Responder com sucesso
    const response = {
      status: 'success',
      message: 'Webhook recebido e processado',
      timestamp: new Date().toISOString(),
      saved: mensagemSalva,
      messageId: mensagemId,
      analysis: {
        type: analiseResultado.tipo_servico,
        urgency: analiseResultado.urgencia,
        action: analiseResultado.acao_sugerida,
        confidence: analiseResultado.confianca,
        response_generated: analiseResultado.template_resposta.substring(0, 100) + (analiseResultado.template_resposta.length > 100 ? '...' : ''),
        response_sent: respostaEnviada
      },
      data: {
        from: mensagemData.from,
        type: mensagemData.type,
        textLength: mensagemData.text.length
      }
    };
    
    res.status(200).json(response);
    log('Webhook respondido com sucesso', response);
    
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
      saved: mensagemSalva,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rota para enviar mensagem manualmente (para testes)
app.post('/send-test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Parâmetros phone e message são obrigatórios'
      });
    }
    
    log('Envio manual solicitado', { phone, message_preview: message.substring(0, 50) + '...' });
    
    const resultado = await enviarRespostaZAPI(phone, message);
    
    res.status(200).json({
      status: resultado.success ? 'success' : 'error',
      sent: resultado.sent,
      message: resultado.sent ? 'Mensagem enviada' : 'Erro ao enviar mensagem',
      details: resultado
    });
    
  } catch (error) {
    log('Erro no envio manual', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Erro interno',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rota para analisar mensagem (para testes)
app.post('/analyze', (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        status: 'error',
        message: 'Parâmetro text é obrigatório'
      });
    }
    
    const analise = analisarMensagem(text);
    
    res.status(200).json({
      status: 'success',
      analysis: analise,
      suggested_response: analise.template_resposta
    });
    
  } catch (error) {
    log('Erro na análise', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Erro interno',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rota de health check (usada pelo Render e keep-alive)
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'webhook-zapi',
    version: '3.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV || 'development',
    database: 'connected',
    zapi_enabled: ZAPI_CONFIG.RESPONSE_ENABLED,
    features: ['message_reception', 'analysis', 'auto_response_' + (ZAPI_CONFIG.RESPONSE_ENABLED ? 'enabled' : 'disabled')]
  };
  
  // Verificar conexão com banco
  db.get("SELECT COUNT(*) as count FROM mensagens", (err, row) => {
    if (err) {
      health.database = 'error: ' + err.message;
    } else {
      health.messagesCount = row.count;
    }
    
    log('Health check solicitado', { ip: req.ip, database: health.database });
    res.status(200).json(health);
  });
});

// Rota de status para debug
app.get('/status', (req, res) => {
  db.get("SELECT COUNT(*) as total FROM mensagens", (err, row) => {
    const status = {
      service: 'Z-API Webhook v3.0',
      status: 'operational',
      endpoints: {
        webhook: 'POST /webhook',
        health: 'GET /health',
        status: 'GET /status',
        messages: 'GET /messages',
        analyze: 'POST /analyze',
        send_test: 'POST /send-test'
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      features: [
        'Parsing tolerante a JSON malformado',
        'Salvamento automático em SQLite',
        'Análise inteligente de mensagens',
        'Resposta automática ' + (ZAPI_CONFIG.RESPONSE_ENABLED ? 'HABILITADA' : 'DESABILITADA'),
        'Logging detalhado',
        'Keep-alive automático'
      ],
      statistics: {
        messagesStored: err ? 'error' : row.total,
        database: err ? 'disconnected' : 'connected',
        zapiResponse: ZAPI_CONFIG.RESPONSE_ENABLED ? 'enabled' : 'disabled'
      }
    };
    
    res.status(200).json(status);
  });
});

// Rota para listar mensagens recentes (debug)
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  
  db.all(`
    SELECT id, telefone, 
           SUBSTR(mensagem, 1, 50) as preview,
           tipo,
           intencao,
           datetime(data_recebimento) as data,
           processed,
           resposta_enviada,
           SUBSTR(resposta_gerada, 1, 50) as resposta_preview
    FROM mensagens 
    ORDER BY data_recebimento DESC 
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(200).json({
        count: rows.length,
        messages: rows,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// Rota raiz
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Webhook Z-API v3.0 - WDespachante</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .status { padding: 20px; background: #e8f5e8; border-radius: 5px; border-left: 4px solid #4CAF50; }
        .endpoints { margin-top: 20px; }
        .endpoint { padding: 15px; border-left: 4px solid #2196F3; margin: 10px 0; background: #f8f9fa; }
        .version { color: #666; font-size: 0.9em; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Webhook Z-API v3.0 - WDespachante</h1>
        <div class="version">Versão 3.0 - Com análise e resposta automática</div>
        
        <div class="status">
          <h2>Status: <span style="color: green;">● Operacional</span></h2>
          <p>Serviço webhook para receber mensagens WhatsApp via Z-API</p>
          <p><strong>Recursos:</strong> Salvamento automático, análise inteligente, resposta automática ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'HABILITADA' : 'DESABILITADA'}</p>
        </div>
        
        <div class="warning">
          <strong>⚠️ Resposta automática:</strong> ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'ATIVADA' : 'DESATIVADA'}<br>
          <small>Para ativar, defina RESPONSE_ENABLED=true nas variáveis de ambiente</small>
        </div>
        
        <div class="endpoints">
          <h3>Endpoints disponíveis:</h3>
          <div class="endpoint">
            <strong>POST /webhook</strong> - Receber mensagens da Z-API<br>
            <small>Salva automaticamente e analisa a mensagem</small>
          </div>
          <div class="endpoint">
            <strong>GET /health</strong> - Health check (Render monitor)<br>
            <small>Usado por UptimeRobot para keep-alive</small>
          </div>
          <div class="endpoint">
            <strong>GET /status</strong> - Status do serviço<br>
            <small>Informações técnicas e estatísticas</small>
          </div>
          <div class="endpoint">
            <strong>GET /messages</strong> - Listar mensagens recentes<br>
            <small>Adicione ?limit=10 para limitar resultados</small>
          </div>
          <div class="endpoint">
            <strong>POST /analyze</strong> - Analisar mensagem (teste)<br>
            <small>Envie {"text": "sua mensagem"} para análise</small>
          </div>
          <div class="endpoint">
            <strong>POST /send-test</strong> - Enviar mensagem manual (teste)<br>
            <small>Envie {"phone": "21979060145", "message": "texto"}</small>
          </div>
        </div>
        
        <p>
          <a href="/health">Ver health check JSON</a> | 
          <a href="/status">Ver status completo</a> |
          <a href="/messages">Ver mensagens recentes</a>
        </p>
      </div>
    </body>
    </html>
  `);
});

// Keep-alive para evitar sleep no Render free tier
if (RENDER_KEEP_ALIVE) {
  log('Keep-alive ativado para Render free tier');
  
  setInterval(() => {
    log('Keep-alive ping enviado');
  }, KEEP_ALIVE_INTERVAL);
}

// Iniciar servidor
const server = app.listen(PORT, () => {
  log(`Servidor iniciado na porta ${PORT}`);
  log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  log(`Keep-alive: ${RENDER_KEEP_ALIVE ? 'Ativado' : 'Desativado'}`);
  log(`Banco de dados: ${DB_PATH}`);
  log(`Z-API Response: ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'HABILITADO' : 'DESABILITADO'}`);
  
  console.log(`
    ========================================
    Z-API Webhook v3.0 - WDespachante
    ========================================
    Porta: ${PORT}
    Health: http://localhost:${PORT}/health
    Webhook: POST http://localhost:${PORT}/webhook
    Status: http://localhost:${PORT}/status
    Mensagens: GET http://localhost:${PORT}/messages
    Análise: POST http://localhost:${PORT}/analyze
    Envio: POST http://localhost:${PORT}/send-test
    Banco: ${DB_PATH}
    Z-API Response: ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'ON' : 'OFF'}
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

// Fechar banco ao sair
process.on('exit', () => {
  db.close();
});

module.exports = app;