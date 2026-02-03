# GUIA DE DEPLOY NO RENDER.COM

## 🚀 Visão Geral
Este guia explica como fazer deploy do webhook Z-API no Render.com, substituindo o Railway atual. Render oferece free tier generoso (750h/mês) e é mais estável que Railway + ngrok.

## 📋 PRÉ-REQUISITOS

1. **Conta GitHub** (se não tiver: https://github.com)
2. **Conta Render** (free: https://render.com)
3. **Projeto no GitHub** (vamos criar)

## 🔧 PASSO 1: PREPARAR REPOSITÓRIO GITHUB

### 1.1 Criar repositório no GitHub
1. Acesse https://github.com/new
2. Nome: `webhook-zapi`
3. Descrição: "Webhook para Z-API - Sistema WDespachante"
4. Público (ou privado se preferir)
5. **NÃO** adicionar README, .gitignore, license
6. Clique "Create repository"

### 1.2 Configurar git local
```bash
cd ~/railway-project/webhook-zapi
git init
git add .
git commit -m "Initial commit: webhook Z-API"
git branch -M main
git remote add origin https://github.com/[SEU-USUARIO]/webhook-zapi.git
git push -u origin main
```

**Nota:** Substitua `[SEU-USUARIO]` pelo seu nome de usuário GitHub.

## 🖥️ PASSO 2: CONFIGURAR RENDER.COM

### 2.1 Criar conta Render
1. Acesse https://render.com
2. Clique "Sign Up"
3. Use "Sign up with GitHub" (mais fácil)
4. Autorize aplicação

### 2.2 Criar Web Service
1. No dashboard, clique "+ New" → "Web Service"
2. Conecte ao repositório GitHub `webhook-zapi`
3. Configure:
   - **Name:** `webhook-zapi`
   - **Environment:** `Node`
   - **Region:** `Ohio` (ou São Paulo se disponível)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

4. Clique "Create Web Service"

### 2.3 Configurar variáveis de ambiente
No serviço criado, vá para "Environment":
- Adicione variáveis:
  ```
  NODE_ENV=production
  PORT=3000
  ```
- **NÃO adicione Z-API tokens aqui ainda** (vamos testar primeiro)

## 🔗 PASSO 3: CONFIGURAR Z-API

### 3.1 Obter URL do Render
1. No dashboard do serviço, copie a URL:
   - Será algo como: `https://webhook-zapi.onrender.com`

### 3.2 Configurar webhook na Z-API
1. Acesse https://panel.z-api.io
2. Vá para sua instância (***REMOVED***)
3. Em "Webhook", configure:
   - **URL:** `https://webhook-zapi.onrender.com/webhook`
   - **Método:** `POST`
   - **Eventos:** `messages` (e outros que precisar)
4. Salve

### 3.3 Adicionar tokens ao Render
Volte ao Render, adicione variáveis:
```
ZAPI_TOKEN=C2D28FAD4507E284725
ZAPI_INSTANCE=***REMOVED***
```

**IMPORTANTE:** Marque como "Secret" (Render mascarará o valor)

## 🧪 PASSO 4: TESTAR

### 4.1 Testar webhook
1. Envie uma mensagem de teste pelo WhatsApp
2. Verifique logs no Render (Dashboard → "Logs")
3. Acesse: `https://webhook-zapi.onrender.com/health`
   - Deve retornar "OK"

### 4.2 Testar funcionalidade completa
O sistema deve:
1. Receber mensagem via Z-API
2. Logar no console (aparecer nos logs Render)
3. Processar conforme lógica do `server.js`

## 📊 PASSO 5: MONITORAMENTO

### 5.1 Logs em tempo real
- Render Dashboard → "Logs"
- Veja todas as requisições
- Filtre por erro/sucesso

### 5.2 Health checks automáticos
- Render verifica `/health` automaticamente
- Se falhar 3x, reinicia serviço

### 5.3 Uso do free tier
- **750 horas/mês** = ~24h/dia por 31 dias
- Serviço dorme após 15min inatividade
- Acorda automaticamente na próxima requisição
- Latência de wake-up: ~30-60s

## ⚠️ LIMITAÇÕES FREE TIER

### Atenção ao dormir:
- **Inatividade:** Serviço dorme após 15min
- **Wake-up:** Primeira requisição pode levar 30-60s
- **Z-API timeout:** Configurar timeout Z-API para >60s

### Soluções:
1. **UptimeRobot** (free): Ping a cada 5min para manter ativo
2. **Cron job próprio:** Request periódico
3. **Upgrade para paid:** $7/mês (sempre ativo)

## 🔄 PASSO 6: CONFIGURAR KEEP-ALIVE (RECOMENDADO)

### 6.1 Usar UptimeRobot (mais fácil)
1. Acesse https://uptimerobot.com
2. Crie conta free
3. Add Monitor:
   - Type: HTTP(s)
   - URL: `https://webhook-zapi.onrender.com/health`
   - Interval: 5 minutes
4. Salve

### 6.2 Ou modificar código para ping interno
Adicionar ao `server.js`:
```javascript
// Ping automático para evitar sleep
setInterval(() => {
  console.log('Keep-alive ping');
}, 5 * 60 * 1000); // 5 minutos
```

## 🗄️ PASSO 7: BANCO DE DADOS (OPCIONAL)

### Quando precisar migrar do SQLite:
1. No Render Dashboard: "+ New" → "PostgreSQL"
2. Configurar:
   - Name: `clientes-db`
   - Plan: `Free` (1GB)
   - Region: mesma do web service
3. Obter connection string
4. Adicionar variável `DATABASE_URL` ao web service
5. Atualizar código para usar PostgreSQL

## 🆘 TROUBLESHOOTING

### Problema: Serviço não sobe
**Solução:** Verificar logs de build, garantir `package.json` tem:
```json
"scripts": {
  "start": "node server.js"
}
```

### Problema: Webhook não recebe mensagens
**Solução:**
1. Verificar URL no painel Z-API
2. Testar manualmente:
   ```bash
   curl -X POST https://webhook-zapi.onrender.com/webhook \
     -H "Content-Type: application/json" \
     -d '{"test": "message"}'
   ```

### Problema: Timeout Z-API
**Solução:** Aumentar timeout Z-API para 90s ou usar keep-alive

## 📞 SUPORTE
- Render Docs: https://render.com/docs
- Render Community: https://community.render.com
- Z-API Support: https://panel.z-api.io/support

---

## ✅ CHECKLIST FINAL

- [ ] Repositório GitHub criado
- [ ] Código pushed para GitHub
- [ ] Conta Render criada
- [ ] Web Service criado no Render
- [ ] Variáveis de ambiente configuradas
- [ ] URL do Render copiada
- [ ] Webhook configurado na Z-API
- [ ] Teste de mensagem realizado
- [ ] Logs verificados
- [ ] Keep-alive configurado (UptimeRobot ou código)
- [ ] Sistema funcionando 24/7

**Tempo estimado:** 15-30 minutos
**Custo:** $0 (free tier)
**Estabilidade:** Alta (comparado ao ngrok free)