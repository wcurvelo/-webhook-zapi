// test-zapi-send.js - Teste de envio via Z-API
const axios = require('axios');

const ZAPI_CONFIG = {
  INSTANCE_ID: '***REMOVED***',
  TOKEN: '***REMOVED***',
  API_URL: 'https://api.z-api.io/instances/***REMOVED***/token/***REMOVED***'
};

async function testSendMessage() {
  const phone = '21979060145'; // Número do Wellington
  const message = '✅ Teste do sistema webhook - Mensagem automática via Z-API';
  
  // Formatar número (adicionar 55 e garantir 9 dígitos)
  let formattedPhone = phone.toString().trim();
  if (!formattedPhone.startsWith('55')) {
    formattedPhone = '55' + formattedPhone.replace(/\D/g, '');
  }
  
  // Garantir formato correto: 55 + DDD (2) + 9 + número (8)
  if (formattedPhone.length === 12) { // 55 + DDD (2) + 8 dígitos
    formattedPhone = formattedPhone.substring(0, 4) + '9' + formattedPhone.substring(4);
  }
  
  console.log('📱 Teste de envio Z-API');
  console.log('Número original:', phone);
  console.log('Número formatado:', formattedPhone);
  console.log('Mensagem:', message);
  console.log('URL:', ZAPI_CONFIG.API_URL + '/send-text');
  
  try {
    const response = await axios.post(
      ZAPI_CONFIG.API_URL + '/send-text',
      {
        phone: formattedPhone,
        message: message
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': '***REMOVED***'
        },
        timeout: 15000
      }
    );
    
    console.log('✅ Mensagem enviada com sucesso!');
    console.log('Status:', response.status);
    console.log('Resposta:', JSON.stringify(response.data, null, 2));
    
    return {
      success: true,
      data: response.data
    };
    
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('Sem resposta do servidor');
    }
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

// Executar teste
testSendMessage().then(result => {
  console.log('\n🎯 Resultado final:', result.success ? 'SUCESSO' : 'FALHA');
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});