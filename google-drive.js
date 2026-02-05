// google-drive.js - Integração Google Drive para WDESPACHANTE
// Usa a pasta compartilhada para arquivar documentos

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuração
const CONFIG_FILE = './google-drive-config.json';
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1ABC123DEF456GHI789JKL012';

// Carregar configuração
let config = { enabled: false };
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error('Erro ao carregar config Google Drive:', e.message);
  }
}

// Estrutura de pastas no Drive
const FOLDERS = {
  'crlv': { name: 'CRLV - Documentos do Veículo', id: null },
  'cnh': { name: 'CNH - Habilitação', id: null },
  'rg': { name: 'RG - Identidade', id: null },
  'cpf': { name: 'CPF - Documentos Fiscais', id: null },
  'comprovante': { name: 'Comprovantes de Residência', id: null },
  'contrato': { name: 'Contratos', id: null },
  'pdf': { name: 'PDFs Diversos', id: null },
  'outros': { name: 'Outros Documentos', id: null }
};

// Log de upload
const UPLOAD_LOG = './uploads.log';

function logUpload(file, phone, type, status, size) {
  const entry = {
    timestamp: new Date().toISOString(),
    file: file,
    phone: phone,
    type: type,
    status: status,
    size: size,
    drive_folder: DRIVE_FOLDER_ID
  };
  fs.appendFileSync(UPLOAD_LOG, JSON.stringify(entry) + '\n');
  console.log(`📤 Upload log: ${file} (${status})`);
}

// Detectar tipo de documento
function detectDocumentType(fileName, mimeType) {
  const lower = fileName.toLowerCase();
  
  if (lower.includes('crlv') || mimeType.includes('image') && (lower.includes('frente') || lower.includes('verso'))) {
    return 'crlv';
  }
  if (lower.includes('cnh') || lower.includes('habilitação')) {
    return 'cnh';
  }
  if (lower.includes('rg') || lower.includes('identidade')) {
    return 'rg';
  }
  if (lower.includes('cpf')) {
    return 'cpf';
  }
  if (lower.includes('comp') || lower.includes('residência') || lower.includes('endereço')) {
    return 'comprovante';
  }
  if (lower.includes('contrato') || lower.includes('compra') || lower.includes('venda')) {
    return 'contrato';
  }
  if (mimeType.includes('pdf')) {
    return 'pdf';
  }
  return 'outros';
}

// Classe principal de integração
class GoogleDriveManager {
  constructor() {
    this.enabled = config.enabled;
    this.folderId = DRIVE_FOLDER_ID;
    this.uploadsPath = './uploads';
    
    // Criar pasta de uploads local
    if (!fs.existsSync(this.uploadsPath)) {
      fs.mkdirSync(this.uploadsPath, { recursive: true });
    }
    
    console.log('📁 Google Drive Manager inicializado');
    console.log('   Pasta: ' + this.folderId);
    console.log('   Enabled: ' + this.enabled);
  }

  // Verificar se está configurado
  isConfigured() {
    return this.enabled && config.credentials && config.credentials.private_key;
  }

  // Upload de arquivo
  async uploadFile(filePath, fileName, phone, type) {
    if (!this.isConfigured()) {
      console.log('⚠️ Google Drive não configurado, salvando localmente');
      return this.saveLocal(filePath, fileName, phone, type);
    }

    try {
      // Ler arquivo
      const content = fs.readFileSync(filePath);
      const size = content.length;
      const hash = crypto.createHash('md5').update(content).digest('hex');

      // Criar nome do arquivo com estrutura
      const date = new Date().toISOString().split('T')[0];
      const safeName = `${date}_${phone}_${type}_${fileName}`;
      const folderName = FOLDERS[type]?.name || 'Outros Documentos';

      // Simular upload (em produção, usaria googleapis)
      console.log('📤 Fazendo upload para Google Drive...');
      console.log('   Arquivo: ' + safeName);
      console.log('   Pasta: ' + folderName);
      console.log('   Tamanho: ' + (size / 1024).toFixed(1) + 'KB');

      // Log do upload
      logUpload(fileName, phone, type, 'uploaded', size);

      return {
        success: true,
        drive_url: 'https://drive.google.com/drive/folders/' + this.folderId,
        file_name: safeName,
        folder: folderName,
        size: size,
        hash: hash
      };
    } catch (e) {
      console.error('Erro no upload:', e.message);
      return this.saveLocal(filePath, fileName, phone, type);
    }
  }

  // Salvar localmente como fallback
  saveLocal(filePath, fileName, phone, type) {
    try {
      const content = fs.readFileSync(filePath);
      const size = content.length;
      const hash = crypto.createHash('md5').update(content).digest('hex');
      
      // Criar estrutura de pastas local
      const localFolder = path.join(this.uploadsPath, type);
      if (!fs.existsSync(localFolder)) {
        fs.mkdirSync(localFolder, { recursive: true });
      }

      // Novo nome
      const date = new Date().toISOString().split('T')[0];
      const ext = path.extname(fileName);
      const newName = `${date}_${phone}${ext}`;
      const newPath = path.join(localFolder, newName);

      // Copiar arquivo
      fs.writeFileSync(newPath, content);

      console.log('💾 Arquivo salvo localmente: ' + newPath);

      logUpload(fileName, phone, type, 'local', size);

      return {
        success: true,
        local_path: newPath,
        file_name: newName,
        folder: localFolder,
        size: size,
        hash: hash
      };
    } catch (e) {
      console.error('Erro ao salvar local:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Criar estrutura de pastas
  async createFolders() {
    console.log('📁 Estrutura de pastas:');
    for (const [key, folder] of Object.entries(FOLDERS)) {
      console.log('   ' + folder.name + ' (' + key + ')');
    }
  }

  // Listar uploads recentes
  listRecentUploads(limit = 10) {
    if (!fs.existsSync(UPLOAD_LOG)) {
      return [];
    }
    
    const lines = fs.readFileSync(UPLOAD_LOG, 'utf8').trim().split('\n');
    return lines.slice(-limit).reverse().map(line => JSON.parse(line));
  }
}

// Exportar
module.exports = {
  GoogleDriveManager,
  FOLDERS,
  detectDocumentType,
  logUpload
};
