// server-auto-enabled.js - Webhook com resposta automática ATIVADA
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

// Configuração Z-API - RESPOSTA AUTOMÁTICA ATIVADA
const ZAPI_CONFIG = {
  INSTANCE_ID: process.env.ZAPI_INSTANCE_ID,
  TOKEN: process.env.ZAPI_TOKEN,
  API_URL: process.env.ZAPI_API_URL || `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`,
  CLIENT_TOKEN: process.env.ZAPI_CLIENT_TOKEN,
  RESPONSE_ENABLED: true // ATIVADO para resposta automática
};

// Cooldown entre respostas (30 segundos)
const RESPONSE_COOLDOWN_MS = 30 * 1000; // 30 segundos
const lastResponseTime = new Map(); // telefone -> timestamp

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
  let urgencia = 3;
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
      urgencia = 8;
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
  
  // Gerar resposta baseada no tipo de serviço - TEMPLATES MAIS ESPECÍFICOS
  switch (tipoServico) {
    case 'transferencia':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para calcular o valor da transferência preciso:\n📄 CRLV do veículo\n📄 RG e CPF do proprietário atual\n📄 RG e CPF do novo proprietário\n📄 Comprovante de endereço\n\n📋 Pode enviar fotos desses documentos?';
      break;
    case 'ipva':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para regularizar o IPVA atrasado preciso:\n📄 CRLV do veículo\n📄 RG e CPF do proprietário\n📄 Placa e Renavam\n📄 Ano/modelo do veículo\n\n📋 Quais anos estão em atraso? Pode enviar os documentos?';
      break;
    case 'licenciamento':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para fazer o licenciamento preciso:\n📄 CRLV do veículo\n📄 RG e CPF do proprietário\n📄 Comprovante de endereço\n📄 Certidão de multas (se houver)\n\n📋 Tem esses documentos disponíveis?';
      break;
    case 'multas':
      acaoSugerida = 'solicitar_informacoes';
      templateResposta = 'Para consultar e pagar multas preciso:\n🚗 Placa do veículo\n🔢 Renavam\n📋 CPF do proprietário\n📍 Cidade onde ocorreu\n\n📋 Pode informar esses dados?';
      break;
    case 'crlv':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para emitir 2ª via do CRLV preciso:\n📄 RG e CPF do proprietário\n🚗 Placa do veículo\n🔢 Renavam\n📍 Comprovante de endereço\n\n📋 Pode enviar essas informações?';
      break;
    case 'documentacao':
      acaoSugerida = 'solicitar_documentos';
      templateResposta = 'Para emissão de documentos preciso:\n📄 RG e CPF\n📍 Comprovante de endereço\n🚗 Dados do veículo (placa, renavam)\n📋 Qual documento específico precisa?';
      break;
    case 'consulta':
      acaoSugerida = 'responder_orcamento';
      templateResposta = 'Posso te ajudar com:\n🚗 Transferência de veículo\n💰 IPVA atrasado\n📋 Licenciamento\n🚨 Multas\n📄 CRLV/Documentação\n\n📋 Qual serviço precisa de orçamento?';
      break;
    case 'cumprimento':
      templateResposta = 'Olá! Tudo bem? 😊\nSou assistente do WDespachante.\n\nPosso ajudar com:\n• Transferência de veículo\n• IPVA atrasado\n• Licenciamento\n• Multas\n• Documentação\n\nEm que posso ajudar?';
      break;
    case 'confirmacao':
      templateResposta = 'Obrigado pelo contato! 👍\nQualquer dúvida sobre serviços de despachante é só perguntar.';
      break;
    default:
      templateResposta = 'Olá! Sou assistente do WDespachante.\n\nPosso ajudar com:\n🚗 Transferência de veículo\n💰 IPVA atrasado\n📋 Licenciamento\n🚨 Multas\n📄 CRLV/Documentação\n\nEm que posso ajudar?';
  }
  
  return {
    tipo_servico: tipoServico,
    urgencia: urgencia,
    complexidade: 5,
    acao_sugerida: acaoSugerida,
    template_resposta: templateResposta,
    confianca: Math.round(confianca * 100) / 100
  };
}

// Função para verificar cooldown
function podeEnviarResposta(telefone) {
  const now = Date.now();
  const lastTime = lastResponseTime.get(telefone);
  
  if (!lastTime) {
    return { podeEnviar: true, tempoRestante: 0 };
  }
  
  const tempoDesdeUltimo = now - lastTime;
  const tempoRestante = RESPONSE_COOLDOWN_MS - tempoDesdeUltimo;
  
  if (tempoDesdeUltimo >= RESPONSE_COOLDOWN_MS) {
    return { podeEnviar: true, tempoRestante: 0 };
  } else {
    return { podeEnviar: false, tempoRestante: Math.ceil(tempoRestante / 1000) }; // segundos
  }
}

// Função para enviar mensagem via Z-API com cooldown
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
      mensagem: 'Aguardando cooldown de 30 segundos' 
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

// Função melhorada para extrair dados da mensagem Z-API
function extrairDadosZAPI(body) {
  try {
    log('DEBUG: Payload completo recebido:', body);
    
    // Tentativa 1: Formato mais comum da Z-API
    if (body?.data?.from) {
      const result = {
        instanceId: body.instance || body.data.instance || 'unknown',
        type: body.type || 'ReceivedCallback',
        from: body.data.from,
        text: body.data.text || body.data.body || body.data.message || body.data.content || '',
        messageId: body.data.messageId || body.data.id || '',
        timestamp: body.data.timestamp || body.data.date || new Date().toISOString(),
        rawBody: JSON.stringify(body).substring(0, 500) + '...'
      };
      log('DEBUG: Extraído (formato 1):', result);
      return result;
    }
    
    // Tentativa 2: Formato alternativo (dados diretos)
    if (body?.from) {
      const result = {
        instanceId: body.instanceId || body.instance || 'unknown',
        type: body.type || 'ReceivedCallback',
        from: body.from,
        text: body.body || body.text || body.message || body.content || '',
        messageId: body.messageId || body.id || '',
        timestamp: body.timestamp || body.date || new Date().toISOString(),
        rawBody: JSON.stringify(body).substring(0, 500) + '...'
      };
      log('DEBUG: Extraído (formato 2):', result);
      return result;
    }
    
    // Tentativa 3: Qualquer campo que possa ser texto
    const possibleTextFields = ['text', 'body', 'message', 'content', 'msg'];
    let foundText = '';
    let foundFrom = '';
    
    for (const field of possibleTextFields) {
      if (body[field]) {
        foundText = body[field];
        break;
      }
      if (body.data && body.data[field]) {
        foundText = body.data[field];
        break;
      }
    }
    
    // Tentar encontrar número de telefone
    const possibleFromFields = ['from', 'phone', 'sender', 'number'];
    for (const field of possibleFromFields) {
      if (body[field]) {
        foundFrom = body[field];
        break;
      }
      if (body.data && body.data[field]) {
        foundFrom = body.data[field];
        break;
      }
    }
    
    const result = {
      instanceId: body?.instance || body?.data?.instance || 'unknown',
      type: body?.type || 'unknown',
      from: foundFrom || 'unknown',
      text: foundText || '(sem texto)',
      messageId: body?.messageId || body?.data?.messageId || body?.id || body?.data?.id || '',
      timestamp: body?.timestamp || body?.data?.timestamp || body?.date || body?.data?.date || new Date().toISOString(),
      rawBody: JSON.stringify(body).substring(0, 500) + '...'
    };
    
    log('DEBUG: Extraído (formato 3 - fallback):', result);
    return result;
    
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
      log('Mensagem salva no banco', { id: insertedId, telefone: from, tipo: analise.tipo_servico, texto_preview: text.substring(0, 50) });
      callback(null, insertedId);
    }
  });
}

// Rota para receber webhooks da Z-API
app.post('/webhook', async (req, res) => {
  let mensagemSalva = false;
  let mensagemId = null;
  let analiseResultado = null;
  let respostaEnviada = false;
  
  try {
    const { body } = req;
    
    log('=== WEBHOOK RECEBIDO ===');
    log('Body completo (resumido):', {
      type: body?.type,
      instance: body?.instance,
      hasData: !!body?.data,
      keys: Object.keys(body || {})
    });
    
    // Extrair dados da mensagem com logging
    const mensagemData = extrairDadosZAPI(body);
    
    log('Dados extraídos:', {
      from: mensagemData.from,
      text_preview: mensagemData.text.substring(0, 100),
      type: mensagemData.type,
      instanceId: mensagemData.instanceId
    });
    
    // Analisar mensagem
    analiseResultado = analisarMensagem(mensagemData.text);
    
    log('Análise da mensagem:', {
      tipo: analiseResultado.tipo_servico,
      urgencia: analiseResultado.urgencia,
      acao: analiseResultado.acao_sugerida,
      confianca: analiseResultado.confianca,
      resposta_preview: analiseResultado.template_resposta.substring(0, 100)
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
    
    // Enviar resposta automática se configurado E confiança > 50%
    if (ZAPI_CONFIG.RESPONSE_ENABLED && analiseResultado.confianca > 0.5 && mensagemData.from !== 'unknown' && mensagemData.from !== 'error') {
      log('Tentando enviar resposta automática...', {
        from: mensagemData.from,
        confianca: analiseResultado.confianca,
        resposta_preview: analiseResultado.template_resposta.substring(0, 50)
      });
      
      const resultadoEnvio = await enviarRespostaZAPI(mensagemData.from, analiseResultado.template_resposta);
      respostaEnviada = resultadoEnvio.sent;
      
      if (respostaEnviada) {
        log('✅ Resposta enviada com sucesso via Z-API', { messageId: resultadoEnvio.messageId });
        
        // Atualizar mensagem no banco com status de resposta enviada
        db.run("UPDATE mensagens SET resposta_enviada = ?, resposta_timestamp = CURRENT_TIMESTAMP WHERE id = ?", 
          [true, mensagemId], 
          (err) => {
            if (err) {
              log('Erro ao atualizar status de resposta', { error: err.message });
            } else {
              log('Status atualizado: resposta_enviada = true');
            }
          }
        );
      } else {
        if (resultadoEnvio.cooldown) {
          log('⏳ Cooldown ativo - resposta não enviada', { 
            telefone: mensagemData.from, 
            segundos_restantes: resultadoEnvio.tempoRestante,
            motivo: 'Aguardando 30 segundos entre respostas'
          });
        } else {
          log('❌ Falha ao enviar resposta via Z-API', { error: resultadoEnvio.error });
        }
      }
    } else {
      log('Resposta automática NÃO enviada', {
        enabled: ZAPI_CONFIG.RESPONSE_ENABLED,
        confianca: analiseResultado.confianca,
        from: mensagemData.from,
        motivo: !ZAPI_CONFIG.RESPONSE_ENABLED ? 'RESPONSE_ENABLED=false' : 
                analiseResultado.confianca <= 0.5 ? 'confiança baixa' :
                mensagemData.from === 'unknown' || mensagemData.from === 'error' ? 'from desconhecido' : 'outro'
      });
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
        response_sent: respostaEnviada,
        response_enabled: ZAPI_CONFIG.RESPONSE_ENABLED
      },
      data: {
        from: mensagemData.from,
        type: mensagemData.type,
        textLength: mensagemData.text.length,
        textPreview: mensagemData.text.substring(0, 50) + (mensagemData.text.length > 50 ? '...' : '')
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
      error: process.env.NODE_ENv === 'development' ? error.message : undefined
    });
  }
});

// Rota de health check
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'webhook-zapi-auto',
    version: '3.1.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV || 'development',
    database: 'connected',
    zapi_enabled: ZAPI_CONFIG.RESPONSE_ENABLED,
    features: ['message_reception', 'analysis', 'auto_response_ENABLED']
  };
  
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
  db.all("SELECT id, telefone, SUBSTR(mensagem, 1, 30) as preview, tipo, resposta_enviada FROM mensagens ORDER BY id DESC LIMIT 5", (err, rows) => {
    const status = {
      service: 'Z-API Webhook v3.1',
      status: 'operational',
      auto_response: 'ENABLED',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      recent_messages: err ? [] : rows,
      features: [
        'Parsing tolerante a JSON malformado',
        'Salvamento automático em SQLite',
        'Análise inteligente de mensagens',
        'Resposta automática ATIVADA',
        'Logging detalhado'
      ]
    };
    
    res.status(200).json(status);
  });
});

// Rota raiz
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Webhook Z-API v3.1 - WDespachante</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .status { padding: 20px; background: #e8f5e8; border-radius: 5px; border-left: 4px solid #4CAF50; }
        .enabled { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Webhook Z-API v3.1 - WDespachante</h1>
        <div class="status">
          <h2>Status: <span style="color: green;">● Operacional</span></h2>
          <div class="enabled">
            <strong>🚀 RESPOSTA AUTOMÁTICA ATIVADA</strong>
            <p>Sistema está respondendo automaticamente às mensagens com confiança > 50%</p>
          </div>
          <p><strong>Recursos:</strong> Salvamento automático, análise inteligente, resposta automática ATIVADA</p>
        </div>
        
        <p>
          <a href="/health">Ver health check JSON</a> | 
          <a href="/status">Ver status completo</a>
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
  log(`🚀 Servidor iniciado na porta ${PORT}`);
  log(`✅ Resposta automática: ${ZAPI_CONFIG.RESPONSE_ENABLED ? 'ATIVADA' : 'DESATIVADA'}`);
  log(`📁 Banco de dados: ${DB_PATH}`);
  
  console.log(`
    ========================================
    🚀 Z-API Webhook v3.1 - WDespachante
    ========================================
    Porta: ${PORT}
    Health: http://localhost:${PORT}/health
    Webhook: POST http://localhost:${PORT}/webhook
    Status: http://localhost:${PORT}/status
    Análise: POST http://localhost:${PORT}/analyze
    Envio: POST http://localhost:${PORT}/send-test
    Banco: ${DB_PATH}
    🔥 Resposta automática: ATIVADA
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