#!/bin/bash
# Script para fazer push do webhook-zapi para GitHub
# USO: ./github-push.sh SEU_TOKEN_GITHUB

set -e

TOKEN="$1"
REPO="wcurvelo/-webhook-zapi"

if [ -z "$TOKEN" ]; then
    echo "❌ ERRO: Forneça o token GitHub como argumento"
    echo ""
    echo "📋 COMO OBTER TOKEN:"
    echo "1. Acesse: https://github.com/settings/tokens"
    echo "2. Clique 'Generate new token' → 'classic'"
    echo "3. Permissões: repo (todas)"
    echo "4. Copie o token"
    echo ""
    echo "📤 USO:"
    echo "   ./github-push.sh seu_token_aqui"
    echo ""
    echo "🔐 O token será usado apenas nesta operação"
    exit 1
fi

echo "🚀 Preparando push para GitHub..."
echo "Repositório: $REPO"
echo ""

cd /home/wcurvelo/railway-project/webhook-zapi

# Verificar se há alterações não commitadas
if ! git diff-index --quiet HEAD --; then
    echo "📝 Há alterações não commitadas. Commitando..."
    git add .
    git commit -m "Auto-commit antes do push"
fi

# Configurar URL com token
REMOTE_URL="https://${TOKEN}@github.com/${REPO}.git"
echo "🔗 Configurando remote: ${REMOTE_URL:0:20}...${REMOTE_URL: -20}"
git remote set-url origin "$REMOTE_URL"

# Fazer push
echo "📤 Fazendo push para GitHub..."
if git push -u origin main; then
    echo ""
    echo "✅ PUSH BEM-SUCEDIDO!"
    echo ""
    echo "🌐 Repositório: https://github.com/$REPO"
    echo ""
    echo "🚀 PRÓXIMOS PASSOS:"
    echo "1. Acesse: https://render.com"
    echo "2. Sign up with GitHub"
    echo "3. Siga o guia: cat GUIDE-RENDER-DEPLOY.md | head -40"
    echo ""
    echo "⚠️  IMPORTANTE:"
    echo "   - O token foi usado apenas para esta operação"
    echo "   - Para segurança, delete o token depois se quiser"
    echo "   - Ou mantenha para futuros pushes"
else
    echo "❌ ERRO no push. Verifique:"
    echo "   - Token tem permissões 'repo'"
    echo "   - Repositório existe: https://github.com/$REPO"
    echo "   - Internet conectada"
    exit 1
fi