#!/bin/bash
# Script de deploy local/teste para webhook Z-API
# Útil para testar antes de enviar para Render

set -e

echo "🚀 DEPLOY LOCAL/TESTE WEBHOOK Z-API"
echo ""

PROJECT_DIR="/home/wcurvelo/railway-project/webhook-zapi"
cd "$PROJECT_DIR"

# Verificar Node.js
echo "📋 Verificando ambiente..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado!"
    exit 1
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo "✅ Node.js $NODE_VERSION, npm $NPM_VERSION"

# Instalar dependências
echo "📦 Instalando dependências..."
npm install

# Substituir server.js pelo enhanced (opcional)
echo "🔄 Atualizando server.js para versão enhanced..."
if [ -f "server-enhanced.js" ]; then
    cp server-enhanced.js server.js
    echo "✅ server.js atualizado com keep-alive e logging melhorado"
else
    echo "⚠️  server-enhanced.js não encontrado, mantendo original"
fi

# Testar servidor
echo "🧪 Testando servidor..."
if node -c server.js; then
    echo "✅ Sintaxe do server.js OK"
else
    echo "❌ Erro de sintaxe no server.js"
    exit 1
fi

# Verificar se porta 3000 está livre
echo "🔌 Verificando porta 3000..."
if lsof -ti:3000 &> /dev/null; then
    echo "⚠️  Porta 3000 em uso. Matando processo..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Iniciar servidor em background
echo "🚀 Iniciando servidor na porta 3000..."
nohup npm start > server.log 2>&1 &
SERVER_PID=$!

echo "⏳ Aguardando servidor iniciar..."
sleep 3

# Verificar se está rodando
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ Servidor iniciado (PID: $SERVER_PID)"
else
    echo "❌ Falha ao iniciar servidor"
    cat server.log 2>/dev/null || echo "Log não disponível"
    exit 1
fi

# Testar health check
echo "🏥 Testando health check..."
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health || echo "FAIL")
if [[ "$HEALTH_RESPONSE" == *"healthy"* ]] || [[ "$HEALTH_RESPONSE" == *"OK"* ]]; then
    echo "✅ Health check OK"
else
    echo "❌ Health check falhou: $HEALTH_RESPONSE"
fi

# Testar webhook endpoint
echo "📨 Testando endpoint webhook..."
WEBHOOK_TEST=$(curl -s -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "message", "type": "test"}' || echo "FAIL")

if [[ "$WEBHOOK_TEST" == *"success"* ]] || [[ "$WEBHOOK_TEST" == *"recebido"* ]]; then
    echo "✅ Webhook endpoint OK"
else
    echo "⚠️  Webhook response: $WEBHOOK_TEST"
fi

# Mostrar URLs
echo ""
echo "🌐 URLs disponíveis:"
echo "   Local:    http://localhost:3000"
echo "   Health:   http://localhost:3000/health"
echo "   Status:   http://localhost:3000/status"
echo "   Webhook:  POST http://localhost:3000/webhook"
echo ""
echo "📊 Logs:"
echo "   tail -f $PROJECT_DIR/server.log"
echo ""
echo "🛑 Para parar servidor:"
echo "   kill $SERVER_PID"
echo ""
echo "✅ DEPLOY LOCAL CONCLUÍDO!"
echo ""
echo "📋 Próximos passos para Render:"
echo "1. Execute: ./prepare-github-push.sh"
echo "2. Crie repositório no GitHub"
echo "3. git push origin main"
echo "4. Siga GUIDE-RENDER-DEPLOY.md"
echo ""
echo "Servidor rodando em background. Logs em: server.log"