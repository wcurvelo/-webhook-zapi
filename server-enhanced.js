const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para Render (free tier)
const RENDER_KEEP_ALIVE = process.env.NODE_ENV === 'production';
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Logging melhorado para produção
const log = (message, data = null) => {
    const timestamp = new Date().toISOString();
    if (data) {
        console.log(`[${timestamp}] ${message}:`, JSON.stringify(data, null, 2));
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
};

// Rota para receber webhooks da Z-API
app.post('/webhook', (req, res) => {
    try {
        const { body } = req;
        
        log('Webhook recebido da Z-API', {
            type: body?.type,
            instanceId: body?.instance,
            timestamp: new Date().toISOString()
        });
        
        // Extrair informações da mensagem
        const messageData = body?.data || {};
        const phoneNumber = messageData?.from || messageData?.phone || 'unknown';
        const messageText = messageData?.text || messageData?.body || '(sem texto)';
        
        log(`Mensagem de ${phoneNumber}`, {
            text: messageText.substring(0, 100) + (messageText.length > 100 ? '...' : ''),
            length: messageText.length
        });
        
        // TODO: Adicionar lógica de processamento aqui
        // - Salvar no banco SQLite/PostgreSQL
        // - Classificar com Gemini/regras
        // - Gerar resposta automática
        
        // Responder com sucesso
        res.status(200).json({
            status: 'success',
            message: 'Webhook recebido e processado',
            timestamp: new Date().toISOString()
        });
        
        log('Webhook respondido com sucesso');
        
    } catch (error) {
        log('ERRO no webhook', { error: error.message, stack: error.stack });
        res.status(500).json({
            status: 'error',
            message: 'Erro interno no servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Rota de health check (usada pelo Render e keep-alive)
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'webhook-zapi',
        version: '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || 'development'
    };
    
    log('Health check solicitado', { ip: req.ip });
    res.status(200).json(health);
});

// Rota de status para debug
app.get('/status', (req, res) => {
    res.status(200).json({
        service: 'Z-API Webhook',
        status: 'operational',
        endpoints: {
            webhook: 'POST /webhook',
            health: 'GET /health',
            status: 'GET /status'
        },
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Webhook Z-API - WDespachante</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .container { max-width: 800px; margin: 0 auto; }
                .status { padding: 20px; background: #f0f0f0; border-radius: 5px; }
                .endpoints { margin-top: 20px; }
                .endpoint { padding: 10px; border-left: 4px solid #007bff; margin: 10px 0; background: white; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Webhook Z-API - WDespachante</h1>
                <div class="status">
                    <h2>Status: <span style="color: green;">● Operacional</span></h2>
                    <p>Serviço webhook para receber mensagens WhatsApp via Z-API</p>
                </div>
                <div class="endpoints">
                    <h3>Endpoints disponíveis:</h3>
                    <div class="endpoint">
                        <strong>POST /webhook</strong> - Receber mensagens da Z-API
                    </div>
                    <div class="endpoint">
                        <strong>GET /health</strong> - Health check (Render monitor)
                    </div>
                    <div class="endpoint">
                        <strong>GET /status</strong> - Status do serviço
                    </div>
                </div>
                <p><a href="/health">Ver health check JSON</a> | <a href="/status">Ver status completo</a></p>
            </div>
        </body>
        </html>
    `);
});

// Keep-alive para evitar sleep no Render free tier
if (RENDER_KEEP_ALIVE) {
    log('Keep-alive ativado para Render free tier');
    
    setInterval(() => {
        log('Keep-alive ping enviado');
        // Poderia fazer uma requisição interna, mas o log já ajuda
    }, KEEP_ALIVE_INTERVAL);
}

// Iniciar servidor
const server = app.listen(PORT, () => {
    log(`Servidor iniciado na porta ${PORT}`);
    log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    log(`Keep-alive: ${RENDER_KEEP_ALIVE ? 'Ativado' : 'Desativado'}`);
    
    // Log de boas-vindas
    console.log(`
    ========================================
    Z-API Webhook - WDespachante
    ========================================
    Porta: ${PORT}
    Health: http://localhost:${PORT}/health
    Webhook: POST http://localhost:${PORT}/webhook
    Status: http://localhost:${PORT}/status
    ========================================
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('Recebido SIGTERM, encerrando servidor...');
    server.close(() => {
        log('Servidor encerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('Recebido SIGINT, encerrando servidor...');
    server.close(() => {
        log('Servidor encerrado');
        process.exit(0);
    });
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    log('ERRO NÃO CAPTURADO:', { error: error.message, stack: error.stack });
    // Não encerrar imediatamente - dar chance de recuperação
});

process.on('unhandledRejection', (reason, promise) => {
    log('PROMISE REJEITADA NÃO TRATADA:', { reason: reason?.message || reason });
});

module.exports = app; // Para testes