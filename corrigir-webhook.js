const fs = require('fs');
const file = 'server.js';

console.log('🔧 Corrigindo erros de sintaxe no server.js...\n');

// Ler arquivo
let content = fs.readFileSync(file, 'utf8');

// Corrigir phone
const phoneFix = content.replace(
  /const phone = payload\.phone payload\.sender\?\.phone 'unknown'/g,
  'const phone = payload.phone || payload.sender?.phone || \'unknown\''
);

// Corrigir messageType
content = phoneFix.replace(
  /const messageType = payload\.type payload\.message\?\.type 'text'/g,
  'const messageType = payload.type || payload.message?.type || \'text\''
);

// Corrigir text
content = content.replace(
  /const text = payload\.text\?\.message\?\.message payload\.text\?\.message payload\.text ''/g,
  'const text = payload.text?.message?.message || payload.text?.message || payload.text || \'\''
);

// Corrigir isGroup
content = content.replace(
  /if \(payload\.isGroup payload\.is_group\)/g,
  'if (payload.isGroup || payload.is_group)'
);

fs.writeFileSync(file, content);
console.log('✅ Correções aplicadas!\n');

console.log('Agora pode fazer:');
console.log('git add .');
console.log('git commit -m "fix: corrigir erros de sintaxe"');
console.log('git push origin main');
