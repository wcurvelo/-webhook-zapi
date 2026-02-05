// Simulacro de payload de documento
const payload = {
  phone: '5511999999999',
  message: {
    id: 'test-123',
    type: 'document',
    mediaUrl: 'https://exemplo.com/documento.pdf',
    fileName: 'documento.pdf',
    mimeType: 'application/pdf'
  },
  type: 'ReceivedCallback'
};

console.log('Payload de teste:');
console.log(JSON.stringify(payload, null, 2));
console.log('\nO webhook espera:');
console.log('- payload.message.id');
console.log('- payload.message.mediaUrl (ou content.mediaUrl)');
console.log('- payload.message.fileName (ou mediaName)');
console.log('- payload.message.mimeType (ou content.mimeType)');
