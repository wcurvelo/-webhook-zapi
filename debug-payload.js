const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

// Adicionar logging no início da função processMessage
const debugCode = `
// DEBUG - Ver payload completo
console.log('📥 PAYLOAD COMPLETO:', JSON.stringify(payload).substring(0, 500));
`;

c = c.replace(
  'async function processMessage(payload) {',
  'async function processMessage(payload) {\n' + debugCode
);

fs.writeFileSync('server.js', c);
console.log('✅ Debug adicionado!');
console.log('');
console.log('Agora faz:');
console.log('git add .');
console.log('git commit -m "feat: debug payload"');
console.log('git push origin main');
