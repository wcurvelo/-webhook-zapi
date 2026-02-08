// zapi-sender.js - Envio de mensagens via Z-API
const axios = require('axios');

// Credenciais Z-API (do arquivo de configuração)
const ZAPI_CONFIG = {
  INSTANCE_ID: process.env.ZAPI_INSTANCE_ID,
  TOKEN: process.env.ZAPI_TOKEN,
  API_URL: `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`
};

/**
 * Envia mensagem via Z-API
 * @param {string} to - Número do destinatário (ex: 5521999999999)
 * @param {string} message - Texto da mensagem
 * @param {object} options - Opções adicionais
 * @returns {Promise<object>} Resposta da API
 */
async function sendZAPIMessage(to, message, options = {}) {
  try {
    // Formatar número (remover espaços, adicionar 55 se necessário)
    let phone = to.toString().trim();
    if (!phone.startsWith('55')) {
      phone = '55' + phone.replace(/\D/g, '');
    }
    
    // Garantir que seja celular (adicionar 9 após DDD se necessário)
    if (phone.length === 12) { // 55 + DDD (2) + 8 dígitos
      phone = phone.substring(0, 4) + '9' + phone.substring(4);
    }
    
    const payload = {
      phone: phone,
      message: message,
      ...options
    };
    
    console.log(`[Z-API] Enviando mensagem para: ${phone}`);
    console.log(`[Z-API] Mensagem: ${message.substring(0, 50)}...`);
    
    const response = await axios.post(ZAPI_CONFIG.API_URL + '/send-text', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': process.env.CLIENT_TOKEN
      },
      timeout: 10000 // 10 segundos
    });
    
    console.log(`[Z-API] Resposta: ${response.status} ${response.statusText}`);
    
    return {
      success: true,
      status: response.status,
      data: response.data,
      messageId: response.data?.messageId || response.data?.id
    };
    
  } catch (error) {
    console.error('[Z-API] Erro ao enviar mensagem:', error.message);
    
    if (error.response) {
      console.error('[Z-API] Resposta de erro:', error.response.data);
      return {
        success: false,
        status: error.response.status,
        error: error.response.data?.message || error.message,
        details: error.response.data
      };
    }
    
    return {
      success: false,
      status: 0,
      error: error.message,
      details: null
    };
  }
}

/**
 * Verifica status da instância Z-API
 * @returns {Promise<object>} Status da instância
 */
async function checkZAPIStatus() {
  try {
    const response = await axios.get(ZAPI_CONFIG.API_URL + '/status', {
      headers: {
        'Client-Token': process.env.CLIENT_TOKEN
      },
      timeout: 5000
    });
    
    return {
      success: true,
      status: response.status,
      data: response.data
    };
    
  } catch (error) {
    console.error('[Z-API] Erro ao verificar status:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Teste rápido de envio
 */
async function testSend() {
  console.log('=== TESTE Z-API ===');
  
  // Verificar status
  const status = await checkZAPIStatus();
  console.log('Status:', status.success ? '✅ Conectado' : '❌ Erro');
  
  if (status.success) {
    console.log('Dados da instância:', JSON.stringify(status.data, null, 2));
  }
  
  // Enviar mensagem de teste
  const testPhone = '21979060145'; // Número do Wellington
  const testMessage = '✅ Teste Z-API: Sistema webhook funcionando!';
  
  console.log(`\nEnviando teste para: ${testPhone}`);
  const result = await sendZAPIMessage(testPhone, testMessage);
  
  console.log('\nResultado do envio:');
  console.log('Sucesso:', result.success ? '✅' : '❌');
  if (result.success) {
    console.log('Message ID:', result.messageId);
  } else {
    console.log('Erro:', result.error);
  }
  
  return result;
}

// Executar teste se chamado diretamente
if (require.main === module) {
  testSend().then(result => {
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Erro no teste:', error);
    process.exit(1);
  });
}

module.exports = {
  sendZAPIMessage,
  checkZAPIStatus,
  testSend,
  ZAPI_CONFIG
};