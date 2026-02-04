const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = '/home/wcurvelo/railway-project/sistema-clientes/clientes.db';

console.log('Testando conexão com banco...');
console.log('Caminho do banco:', DB_PATH);
console.log('Existe?', require('fs').existsSync(DB_PATH));

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erro ao conectar:', err.message);
    } else {
        console.log('✅ Conectado ao banco!');
        
        // Testar consulta
        db.get("SELECT COUNT(*) as count FROM mensagens", (err, row) => {
            if (err) {
                console.error('Erro na consulta:', err.message);
            } else {
                console.log(`✅ Mensagens no banco: ${row.count}`);
            }
            db.close();
        });
    }
});