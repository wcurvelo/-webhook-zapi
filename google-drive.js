// google-drive.js - Google Drive Integration for WDESPACHANTE
// Credentials via environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// Environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

const enabled = !!(CLIENT_ID && CLIENT_SECRET);
const UPLOADS_PATH = './uploads';
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });

let accessToken = null;
let tokenExpiry = null;

function loadToken() {
  if (fs.existsSync('./drive-token.json')) {
    try {
      const t = JSON.parse(fs.readFileSync('./drive-token.json', 'utf8'));
      accessToken = t.access_token;
      tokenExpiry = t.expiry;
      return true;
    } catch (e) {}
  }
  return false;
}

function saveToken(token, expiresIn) {
  accessToken = token;
  tokenExpiry = Date.now() + (expiresIn * 1000);
  fs.writeFileSync('./drive-token.json', JSON.stringify({ access_token: token, expiry: tokenExpiry }));
}

function detectDocumentType(fileName, mimeType) {
  const lower = fileName.toLowerCase();
  if (lower.includes('crlv') || mimeType.includes('image')) return 'crlv';
  if (lower.includes('cnh')) return 'cnh';
  if (lower.includes('rg')) return 'rg';
  if (lower.includes('cpf')) return 'cpf';
  if (lower.includes('comp') || lower.includes('residencia')) return 'comprovante';
  if (lower.includes('contrato')) return 'contrato';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'documentos';
}

const FOLDERS = {
  'crlv': 'CRLV - Documentos do Veículo',
  'cnh': 'CNH - Habilitação',
  'rg': 'RG - Identidade',
  'cpf': 'CPF - Documentos Fiscais',
  'comprovante': 'Comprovantes de Residência',
  'contrato': 'Contratos',
  'pdf': 'PDFs Diversos',
  'documentos': 'Outros Documentos'
};

class GoogleDriveManager {
  constructor() {
    this.enabled = enabled;
    console.log('📁 Google Drive Manager:', enabled ? 'Enabled' : 'Disabled (no env vars)');
    loadToken();
  }

  isConfigured() { return this.enabled; }

  getAuthUrl() {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code) {
    try {
      const res = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code,
        grant_type: 'authorization_code', redirect_uri: 'http://localhost'
      });
      saveToken(res.data.access_token, res.data.expires_in);
      console.log('✅ Token salvo!');
      return true;
    } catch (e) {
      console.error('Erro token:', e.message);
      return false;
    }
  }

  async ensureToken() {
    if (!accessToken || Date.now() >= tokenExpiry - 60000) {
      console.log('⚠️ Token inválido. URL:', this.getAuthUrl());
      return false;
    }
    return true;
  }

  async uploadFile(filePath, fileName, phone, docType) {
    if (!this.enabled) return this.saveLocal(filePath, fileName, phone, docType);
    if (!filePath || !fs.existsSync(filePath)) return this.saveLocal(filePath, fileName, phone, docType);

    try {
      const content = fs.readFileSync(filePath);
      const size = content.length;
      const hash = crypto.createHash('md5').update(content).digest('hex');

      const structuredName = `${new Date().toISOString().split('T')[0]}_${phone}_${docType}${path.extname(fileName) || '.jpg'}`;
      const folderName = FOLDERS[docType] || 'Outros Documentos';

      if (!await this.ensureToken()) return this.saveLocal(filePath, fileName, phone, docType);

      // Get or create folder
      const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder'`;
      const check = await axios.get(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } });
      
      let folderId = DRIVE_FOLDER_ID;
      if (check.data.files?.length > 0) {
        folderId = check.data.files[0].id;
      } else {
        const create = await axios.post('https://www.googleapis.com/drive/v3/files',
          { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [DRIVE_FOLDER_ID] },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
        folderId = create.data.id;
      }

      // Upload
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: structuredName, parents: [folderId] })], { type: 'application/json' }));
      form.append('file', new Blob([content], { type: 'application/octet-stream' }));

      const upload = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        form, { headers: { Authorization: `Bearer ${accessToken}` } });

      const url = `https://drive.google.com/file/d/${upload.data.id}/view`;
      console.log('✅ Drive:', url);
      return { success: true, drive_url: url };
    } catch (e) {
      console.error('Erro:', e.message);
      return this.saveLocal(filePath, fileName, phone, docType);
    }
  }

  saveLocal(filePath, fileName, phone, docType) {
    if (!filePath || !fs.existsSync(filePath)) return { success: false };
    
    try {
      const content = fs.readFileSync(filePath);
      const folder = path.join(UPLOADS_PATH, docType);
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      
      const newPath = path.join(folder, `${new Date().toISOString().split('T')[0]}_${phone}${path.extname(fileName) || '.jpg'}`);
      fs.writeFileSync(newPath, content);
      console.log('💾 Local:', newPath);
      return { success: true, local_path: newPath };
    } catch (e) {
      return { success: false };
    }
  }
}

module.exports = { GoogleDriveManager, detectDocumentType };
