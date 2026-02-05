const fs = require('fs');
const file = 'server.js';

console.log('🔧 Corrigindo TODOS os erros de sintaxe...\n');

let content = fs.readFileSync(file, 'utf8');

// Corrigir todos os erros || missing
const corrections = [
  [/const msg = payload\.message payload;/g, 'const msg = payload.message || payload;'],
  [/let fileUrl = msg\.mediaUrl msg\.content\?\.mediaUrl null;/g, 'let fileUrl = msg.mediaUrl || msg.content?.mediaUrl || null;'],
  [/let fileName = msg\.fileName msg\.mediaName `arquivo_\$\{Date\.now\(\)\}`;/g, 'let fileName = msg.fileName || msg.mediaName || `arquivo_${Date.now()}`;'],
  [/let mimeType = msg\.mimeType msg\.content\?\.mimeType 'application\/octet-stream';/g, 'let mimeType = msg.mimeType || msg.content?.mimeType || \'application/octet-stream\';'],
  [/mimeType\.startsWith\('image\/'\) mimeType === 'application\/pdf'/g, 'mimeType.startsWith(\'image/\') || mimeType === \'application/pdf\''],
  [/if \(driveResult\.success\) driveUrl = driveResult\.drive_url driveResult\.local_path;/g, 'if (driveResult.success) driveUrl = driveResult.drive_url || driveResult.local_path;'],
  [/const phone = payload\.phone payload\.sender\?\.phone 'unknown'/g, 'const phone = payload.phone || payload.sender?.phone || \'unknown\''],
  [/const messageType = payload\.type payload\.message\?\.type 'text'/g, 'const messageType = payload.type || payload.message?.type || \'text\''],
  [/const text = payload\.text\?\.message\?\.message payload\.text\?\.message payload\.text ''/g, 'const text = payload.text?.message?.message || payload.text?.message || payload.text || \'\''],
  [/if \(payload\.isGroup payload\.is_group\)/g, 'if (payload.isGroup || payload.is_group)']
];

let count = 0;
corrections.forEach(([find, replace]) => {
  if (content.match(find)) {
    content = content.replace(find, replace);
    count++;
    console.log(`✅ Corrigido: ${find.toString().substring(0, 50)}...`);
  }
});

if (count === 0) {
  console.log('⚠️ Nenhuma correção necessária (ou padrões diferentes)');
} else {
  fs.writeFileSync(file, content);
  console.log(`\n✅ ${count} correções aplicadas!`);
}

console.log('\nAgora faça:');
console.log('git add .');
console.log('git commit -m "fix: corrigir erros de sintaxe"');
console.log('git push origin main');
