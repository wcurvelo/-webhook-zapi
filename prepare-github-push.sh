#!/bin/bash
# Script para preparar e fazer push do projeto webhook-zapi para GitHub
# Execute este script antes de seguir o guia Render

set -e

echo "🚀 Preparando projeto webhook-zapi para GitHub + Render"
echo ""

# Configurações
PROJECT_DIR="/home/wcurvelo/railway-project/webhook-zapi"
GITHUB_USER=""  # COLOQUE SEU USUÁRIO GITHUB AQUI
REPO_NAME="webhook-zapi"

# Verificar se .git já existe
if [ -d "$PROJECT_DIR/.git" ]; then
    echo "⚠️  Repositório git já existe em $PROJECT_DIR"
    echo "   Executando git status:"
    cd "$PROJECT_DIR" && git status
    echo ""
    read -p "Continuar? (s/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo "❌ Cancelado pelo usuário"
        exit 0
    fi
fi

# Verificar usuário GitHub
if [ -z "$GITHUB_USER" ]; then
    echo "❌ ERRO: Configure seu usuário GitHub no script"
    echo "   Edite o arquivo e coloque: GITHUB_USER=\"seu-usuario\""
    exit 1
fi

echo "📋 Verificando estrutura do projeto..."
cd "$PROJECT_DIR"

# Verificar arquivos essenciais
if [ ! -f "package.json" ]; then
    echo "❌ package.json não encontrado!"
    exit 1
fi

if [ ! -f "server.js" ]; then
    echo "❌ server.js não encontrado!"
    exit 1
fi

if [ ! -f "render.yaml" ]; then
    echo "❌ render.yaml não encontrado!"
    exit 1
fi

echo "✅ Estrutura OK: package.json, server.js, render.yaml"

# Criar .gitignore se não existir
if [ ! -f ".gitignore" ]; then
    echo "📝 Criando .gitignore..."
    cat > .gitignore << 'EOF'
# Dependências
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Ambiente
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
*.log
logs/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory
coverage/
.nyc_output

# Grunt middle
.grunt

# IDEs
.vscode/
.idea/
*.swp
*.swo

# Sistema
.DS_Store
Thumbs.db

# Arquivos de backup
*.bak
*.backup
*.tar.gz
*.zip

# Ngrok
ngrok.log
EOF
    echo "✅ .gitignore criado"
fi

# Remover arquivos sensíveis do commit
echo "🔒 Removendo arquivos sensíveis do git..."
if [ -f ".env" ]; then
    echo "   Mantendo .env local (não será commitado)"
    if ! grep -q ".env" .gitignore; then
        echo ".env" >> .gitignore
    fi
fi

# Inicializar git (se não existir)
if [ ! -d ".git" ]; then
    echo "🔄 Inicializando repositório git..."
    git init
    git branch -M main
fi

# Adicionar arquivos
echo "📁 Adicionando arquivos ao git..."
git add .

# Commit inicial
echo "💾 Criando commit inicial..."
git commit -m "Initial commit: Webhook Z-API para WDespachante

- Servidor Express para receber webhooks
- Configuração Render.yaml para deploy automático
- Health check endpoint
- Pronto para produção"

# Configurar remote
echo "🔗 Configurando remote GitHub..."
GIT_REMOTE="https://github.com/$GITHUB_USER/$REPO_NAME.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$GIT_REMOTE"

echo ""
echo "✅ PREPARAÇÃO COMPLETA!"
echo ""
echo "📋 PRÓXIMOS PASSOS MANUAIS:"
echo ""
echo "1. Crie repositório no GitHub:"
echo "   https://github.com/new"
echo "   Nome: $REPO_NAME"
echo "   NÃO adicione README, .gitignore, license"
echo ""
echo "2. Execute o push:"
echo "   cd $PROJECT_DIR"
echo "   git push -u origin main"
echo ""
echo "3. Siga o guia Render:"
echo "   Leia GUIDE-RENDER-DEPLOY.md"
echo "   Ou execute: cat GUIDE-RENDER-DEPLOY.md | head -30"
echo ""
echo "⚠️  IMPORTANTE: Antes do push, verifique:"
echo "   - .env NÃO está no git (está no .gitignore)"
echo "   - Nenhum token/senha está commitado"
echo ""
echo "Para verificar:"
echo "   git status"
echo "   git log --oneline"

# Mostrar status final
echo ""
echo "📊 STATUS FINAL:"
git status --short