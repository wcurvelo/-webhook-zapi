# Webhook Z-API - WDespachante

Serviço webhook para receber mensagens WhatsApp via Z-API, parte do sistema de automação do WDespachante.

## 🚀 Funcionalidades

- Recebe webhooks da Z-API em tempo real
- Health check para monitoramento (Render.com)
- Logging estruturado para produção
- Keep-alive para evitar sleep no free tier
- Endpoints de status e debug

## 📁 Estrutura

```
webhook-zapi/
├── server.js              # Servidor principal
├── package.json          # Dependências Node.js
├── render.yaml           # Configuração Render.com
├── .gitignore           # Arquivos ignorados
└── README.md            # Este arquivo
```

## 🔧 Deploy Automático

Configurado para deploy automático no [Render.com](https://render.com):

1. **Free tier:** 750 horas/mês
2. **Health checks:** Automáticos
3. **Logs:** Dashboard em tempo real
4. **Auto-deploy:** Push no GitHub → Deploy automático

## 🌐 Endpoints

- `POST /webhook` - Receber mensagens Z-API
- `GET /health` - Health check (Render monitor)
- `GET /status` - Status do serviço
- `GET /` - Página inicial informativa

## 🔗 Integrações

- **Z-API:** Recebimento de mensagens WhatsApp
- **SQLite/PostgreSQL:** Armazenamento de dados
- **Gemini API:** Análise automática (quota excedida)
- **Google Drive/ClickUp:** Em desenvolvimento

## 🛠️ Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Rodar localmente
npm start

# Testar endpoints
curl http://localhost:3000/health
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d '{"test":"data"}'
```

## 📋 Variáveis de Ambiente

```env
PORT=3000
NODE_ENV=production
# Z-API config (adicionar no Render dashboard)
# ZAPI_TOKEN=seu_token
# ZAPI_INSTANCE=sua_instancia
```

## 🚀 Deploy no Render

1. Conectar repositório GitHub ao Render
2. Render detectará `render.yaml` automaticamente
3. Adicionar variáveis de ambiente no dashboard
4. Configurar webhook Z-API com URL do Render

## 📞 Suporte

- **Render:** https://render.com/docs
- **Z-API:** https://panel.z-api.io
- **Issues:** Abrir issue no GitHub

---

**Sistema WDespachante** • Wellington Curvelo • Barra Mansa-RJ