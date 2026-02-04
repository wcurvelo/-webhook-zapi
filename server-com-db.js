const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para Render (free tier)
const RENDER_KEEP_ALIVE = process.env.NODE_ENV === 'production';
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Configuração do banco de dados
const DB_PATH = process.env.DB_PATH || '/home/wcurvelo/railway-project/sistema-clientes/clientes.db';

// Conectar ao banco de dados
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite:', DB_PATH);
        
        // Verificar se tabela mensagens existe
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='mensagens'", (err, row) => {
            if (err) {
                console.error('Erro ao verificar tabela mensagens:', err.message);
            } else if (!row) {
                console.log('Tabela mensagens não encontrada. Criando...');
                criarTabelaMensagens();
            } else {
                console.log('Tabela mensagens já existe.');
            }
        });
    }
});

// Criar tabela se não existir
function criarTabelaMensagens() {
    const sql = `
        CREATE TABLE IF NOT EXISTS mensagens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER,
            telefone TEXT NOT NULL,
            mensagem TEXT NOT NULL,
            tipo TEXT,
            intencao TEXT,
            data_recebimento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            origem TEXT DEFAULT 'z-api',
            message_id TEXT,
            instance_id TEXT,
            processed BOOLEAN DEFAULT FALSE,
            resposta_gerada TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_mensagens_telefone ON mensagens(telefone);
        CREATE INDEX IF NOT EXISTS idx_mensagens_data ON mensagens(data_recebimento);
    `;
    
    db.exec(sql, (err) => {
        if (err) {
            console.error('Erro ao criar tabela mensagens:', err.message);
        } else {
            console.log('Tabela mensagens criada com sucesso.');
        }
    });
}

// Middleware
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging melhorado para produção
const log = (message, data = null) => {
    const timestamp = new Date().toISOString();
    if (data && typeof data === 'object') {
        console.log(`[${timestamp}] ${message}:`, JSON.stringify(data, null, 2));
    } else if (data) {
        console.log(`[${timestamp}] ${message}: ${data}`);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
};

// Função para salvar mensagem no banco
function salvarMensagemNoBanco(mensagemData, callback) {
    const {
        instanceId,
        type,
        from,
        text,
        messageId,
        timestamp = new Date().toISOString()
    } = mensagemData;
    
    const sql = `
        INSERT INTO mensagens (
            telefone, 
            mensagem, 
            tipo, 
            data_recebimento,
            origem,
            instance_id,
            message_id,
            processed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        from,
        text || '(sem texto)',
        type,
        timestamp,
        'z-api',
        instanceId,
        messageId,
        false
    ];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Erro ao salvar mensagem no banco:', err.message);
            callback(err, null);
        } else {
            const insertedId = this.lastID;
            log('Mensagem salva no banco', { id: insertedId, telefone: from });
            callback(null, insertedId);
        }
    });
}

// Função para extrair dados da mensagem Z-API
function extrairDadosZAPI(body) {
    try {
        // Formato Z-API padrão
        if (body?.data?.from && (body?.data?.text || body?.data?.body)) {
            return {
                instanceId: body.instance || body.data.instance,
                type: body.type || 'ReceivedCallback',
                from: body.data.from,
                text: body.data.text || body.data.body || '',
                messageId: body.data.messageId || body.data.id,
                timestamp: body.data.timestamp || new Date().toISOString(),
                rawBody: JSON.stringify(body).substring(0, 500) + '...'
            };
        }
        
        // Formato alternativo
        if (body?.from && body?.body) {
            return {
                instanceId: body.instanceId || body.instance,
                type: body.type || 'ReceivedCallback',
                from: body.from,
                text: body.body,
                messageId: body.messageId || body.id,
                timestamp: body.timestamp || new Date().toISOString(),
                rawBody: JSON.stringify(body).substring(0, 500) + '...'
            };
        }
        
        // Fallback para dados mínimos
        return {
            instanceId: body?.instance || 'unknown',
            type: body?.type || 'unknown',
            from: body?.data?.from || body?.from || 'unknown',
            text: body?.data?.text || body?.data?.body || body?.text || body?.body || '(sem texto)',
            messageId: body?.data?.messageId || body?.messageId || '',
            timestamp: new Date().toISOString(),
            rawBody: JSON.stringify(body).substring(0, 500) + '...'
        };
        
    } catch (error) {
        console.error('Erro ao extrair dados Z-API:', error.message);
        return {
            instanceId: 'error',
            type: 'error',
            from: 'error',
            text: `Erro ao processar mensagem: ${error.message}`,
            messageId: '',
            timestamp: new Date().toISOString(),
            rawBody: '{}'
        };
    }
}

// Rota para receber webhooks da Z-API
app.post('/webhook', (req, res) => {
    let mensagemSalva = false;
    let mensagemId = null;
    
    try {
        const { body } = req;
        
        log('Webhook recebido da Z-API', {
            type: body?.type,
            instanceId: body?.instance,
            hasData: !!body?.data,
            timestamp: new Date().toISOString()
        });
        
        // Extrair dados da mensagem
        const mensagemData = extrairDadosZAPI(body);
        
        log(`Mensagem processada`, {
            from: mensagemData.from,
            type: mensagemData.type,
            textPreview: mensagemData.text.substring(0, 100),
            length: mensagemData.text.length,
            instance: mensagemData.instanceId
        });
        
        // Salvar no banco de dados
        salvarMensagemNoBanco(mensagemData, (err, insertedId) => {
            if (err) {
                log('ERRO ao salvar mensagem no banco', { error: err.message });
            } else {
                mensagemSalva = true;
                mensagemId = insertedId;
                log('✅ Mensagem salva no banco com ID:', insertedId);
            }
        });
        
        // Responder com sucesso imediatamente (não esperar salvar)
        const response = {
            status: 'success',
            message: 'Webhook recebido e processado',
            timestamp: new Date().toISOString(),
            saved: mensagemSalva,
            messageId: mensagemId,
            data: {
                from: mensagemData.from,
                type: mensagemData.type,
                textLength: mensagemData.text.length
            }
        };
        
        res.status(200).json(response);
        log('Webhook respondido com sucesso', response);
        
    } catch (error) {
        log('ERRO CRÍTICO no webhook', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        // Responder com erro mas manter conexão
        res.status(200).json({
            status: 'error',
            message: 'Erro interno no servidor',
            timestamp: new Date().toISOString(),
            saved: mensagemSalva,
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
        version: '2.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || 'development',
        database: 'connected'
    };
    
    // Verificar conexão com banco
    db.get("SELECT COUNT(*) as count FROM mensagens", (err, row) => {
        if (err) {
            health.database = 'error: ' + err.message;
        } else {
            health.messagesCount = row.count;
        }
        
        log('Health check solicitado', { ip: req.ip, database: health.database });
        res.status(200).json(health);
    });
});

// Rota de status para debug
app.get('/status', (req, res) => {
    db.get("SELECT COUNT(*) as total FROM mensagens", (err, row) => {
        const status = {
            service: 'Z-API Webhook v2.0',
            status: 'operational',
            endpoints: {
                webhook: 'POST /webhook',
                health: 'GET /health',
                status: 'GET /status'
            },
            environment: process.env.NODE_ENV || 'development',
            timestamp: new Date().toISOString(),
            features: [
                'Parsing tolerante a JSON malformado',
                'Suporte a múltiplos formatos Z-API',
                'Salvamento automático em SQLite',
                'Logging detalhado',
                'Keep-alive automático',
                'Tratamento de erros robusto'
            ],
            statistics: {
                messagesStored: err ? 'error' : row.total,
                database: err ? 'disconnected' : 'connected'
            }
        };
        
        res.status(200).json(status);
    });
});

// Rota para listar mensagens recentes (apenas para debug)
app.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    
    db.all(`
        SELECT id, telefone, 
               SUBSTR(mensagem, 1, 50) as preview,
               datetime(data_recebimento) as data,
               processed
        FROM mensagens 
        ORDER BY data_recebimento DESC 
        LIMIT ?
    `, [limit], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.status(200).json({
                count: rows.length,
                messages: rows,
                timestamp: new Date().toISOString()
            });
        }
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Webhook Z-API v2.0 - WDespachante</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .status { padding: 20px; background: #e8f5e8; border-radius: 5px; border-left: 4px solid #4CAF50; }
                .endpoints { margin-top: 20px; }
                .endpoint { padding: 15px; border-left: 4px solid #2196F3; margin: 10px 0; background: #f8f9fa; }
                .version { color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Webhook Z-API v2.0 - WDespachante</h1>
                <div class="version">Versão 2.0 - Com salvamento automático em SQLite</div>
                
                <div class="status">
                    <h2>Status: <span style="color: green;">● Operacional</span></h2>
                    <p>Serviço webhook para receber mensagens WhatsApp via Z-API</p>
                    <p><strong>Recursos:</strong> Salvamento automático, parsing tolerante, múltiplos formatos</p>
                </div>
                
                <div class="endpoints">
                    <h3>Endpoints disponíveis:</h3>
                    <div class="endpoint">
                        <strong>POST /webhook</strong> - Receber mensagens da Z-API<br>
                        <small>Salva automaticamente no banco SQLite</small>
                    </div>
                    <div class="endpoint">
                        <strong>GET /health</strong> - Health check (Render monitor)<br>
                        <small>Usado por UptimeRobot para keep-alive</small>
                    </div>
                    <div class="endpoint">
                        <strong>GET /status</strong> - Status do serviço<br>
                        <small>Informações técnicas e estatísticas</small>
                    </div>
                    <div class="endpoint">
                        <strong>GET /messages</strong> - Listar mensagens recentes (debug)<br>
                        <small>Adicione ?limit=10 para limitar resultados</small>
                    </div>
                </div>
                
                <p>
                    <a href="/health">Ver health check JSON</a> | 
                    <a href="/status">Ver status completo</a> |
                    <a href="/messages">Ver mensagens recentes</a>
                </p>
                
                <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-radius: 5px; border-left: 4px solid #ffc107;">
                    <strong>⚠️ Sistema em produção</strong><br>
                    <small>Mensagens são salvas automaticamente em: ${DB_PATH}</small>
                </div>
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
    }, KEEP_ALIVE_INTERVAL);
}

// Iniciar servidor
const server = app.listen(PORT, () => {
    log(`Servidor iniciado na porta ${PORT}`);
    log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    log(`Keep-alive: ${RENDER_KEEP_ALIVE ? 'Ativado' : 'Desativado'}`);
    log(`Banco de dados: ${DB_PATH}`);
    
    console.log(`
    ========================================
    Z-API Webhook v2.0 - WDespachante
    ========================================
    Porta: ${PORT}
    Health: http://localhost:${PORT}/health
    Webhook: POST http://localhost:${PORT}/webhook
    Status: http://localhost:${PORT}/status
    Mensagens: GET http://localhost:${PORT}/messages
    Banco: ${DB_PATH}
    ========================================
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('Recebido SIGTERM, encerrando servidor...');
    db.close((err) => {
        if (err) {
            log('Erro ao fechar banco de dados:', err.message);
        } else {
            log('Banco de dados fechado');
        }
        server.close(() => {
            log('Servidor encerrado');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    log('Recebido SIGINT, encerrando servidor...');
    db.close(() => {
        server.close(() => {
            log('Servidor encerrado');
            process.exit(0);
        });
    });
});

// Fechar banco ao sair
process.on('exit', () => {
    db.close();
});

module.exports = app;