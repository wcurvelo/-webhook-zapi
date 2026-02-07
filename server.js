require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao PostgreSQL:', err.stack);
  } else {
    console.log('✅ Conectado ao PostgreSQL com sucesso!');
    release();
  }
});

// ============================================
// DATABASE INITIALIZATION
// ============================================

async function initDatabase() {
  const client = await pool.connect();
  try {
    // Criar tabela de mensagens se não existir
    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        mensagem TEXT NOT NULL,
        resposta_ia TEXT,
        service VARCHAR(50),
        respondida BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Criar tabela de mensagens treinadas
    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens_treinadas (
        id SERIAL PRIMARY KEY,
        mensagem_id INTEGER,
        phone VARCHAR(20),
        mensagem_cliente TEXT NOT NULL,
        resposta_ia TEXT NOT NULL,
        resposta_corrigida TEXT,
        tipo VARCHAR(20) CHECK (tipo IN ('aprovada', 'corrigida')),
        service VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Criar índices para performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mensagens_respondida 
      ON mensagens(respondida)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mensagens_treinadas_tipo 
      ON mensagens_treinadas(tipo)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mensagens_treinadas_service 
      ON mensagens_treinadas(service)
    `);

    console.log('✅ Tabelas criadas/verificadas com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error);
  } finally {
    client.release();
  }
}

// ============================================
// API ENDPOINTS - MENSAGENS PENDENTES
// ============================================

// GET /api/mensagens-pendentes
// Retorna todas as mensagens que ainda não foram treinadas
app.get('/api/mensagens-pendentes', async (req, res) => {
  try {
    const { service, limit = 50 } = req.query;
    
    let query = `
      SELECT 
        m.id,
        m.phone,
        m.mensagem as "originalMessage",
        m.resposta_ia as "aiSuggestion",
        m.service,
        m.created_at as date,
        CASE 
          WHEN mt.id IS NOT NULL THEN 
            CASE 
              WHEN mt.tipo = 'aprovada' THEN 'approved'
              WHEN mt.tipo = 'corrigida' THEN 'corrected'
            END
          ELSE 'pending'
        END as status,
        mt.resposta_corrigida as "correctedResponse"
      FROM mensagens m
      LEFT JOIN mensagens_treinadas mt ON m.id = mt.mensagem_id
      WHERE m.respondida = false OR mt.id IS NULL
    `;

    const params = [];
    
    if (service && service !== 'all') {
      query += ` AND m.service = $1`;
      params.push(service);
      query += ` ORDER BY m.created_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      query += ` ORDER BY m.created_at DESC LIMIT $1`;
      params.push(limit);
    }

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      messages: result.rows
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens pendentes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar mensagens pendentes',
      details: error.message
    });
  }
});

// ============================================
// API ENDPOINTS - MENSAGENS TREINADAS
// ============================================

// GET /api/mensagens-treinadas
// Retorna todas as mensagens que já foram treinadas (aprovadas ou corrigidas)
app.get('/api/mensagens-treinadas', async (req, res) => {
  try {
    const { service, tipo, limit = 100 } = req.query;
    
    let query = `
      SELECT 
        mt.id,
        mt.mensagem_id,
        mt.phone,
        mt.mensagem_cliente as "customerMessage",
        mt.resposta_ia as "aiResponse",
        mt.resposta_corrigida as "correctedResponse",
        mt.tipo as type,
        mt.service,
        mt.created_at as date
      FROM mensagens_treinadas mt
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (service && service !== 'all') {
      query += ` AND mt.service = $${paramCount}`;
      params.push(service);
      paramCount++;
    }

    if (tipo && tipo !== 'all') {
      query += ` AND mt.tipo = $${paramCount}`;
      params.push(tipo);
      paramCount++;
    }

    query += ` ORDER BY mt.created_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      training: result.rows
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens treinadas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar mensagens treinadas',
      details: error.message
    });
  }
});

// ============================================
// API ENDPOINTS - APROVAR RESPOSTA
// ============================================

// POST /api/aprovar/:id
// Aprova a resposta sugerida pela IA
app.post('/api/aprovar/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    
    await client.query('BEGIN');

    // Buscar a mensagem original
    const msgResult = await client.query(
      'SELECT * FROM mensagens WHERE id = $1',
      [id]
    );

    if (msgResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Mensagem não encontrada'
      });
    }

    const mensagem = msgResult.rows[0];

    // Verificar se já foi treinada
    const existingTraining = await client.query(
      'SELECT id FROM mensagens_treinadas WHERE mensagem_id = $1',
      [id]
    );

    if (existingTraining.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Esta mensagem já foi treinada'
      });
    }

    // Inserir no banco de treinamento
    await client.query(
      `INSERT INTO mensagens_treinadas 
       (mensagem_id, phone, mensagem_cliente, resposta_ia, tipo, service) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, mensagem.phone, mensagem.mensagem, mensagem.resposta_ia, 'aprovada', mensagem.service]
    );

    // Marcar como respondida
    await client.query(
      'UPDATE mensagens SET respondida = true WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Resposta aprovada com sucesso! IA aprendeu com este exemplo.',
      data: {
        id,
        tipo: 'aprovada'
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao aprovar resposta:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao aprovar resposta',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// ============================================
// API ENDPOINTS - CORRIGIR RESPOSTA
// ============================================

// POST /api/corrigir/:id
// Salva a correção feita pelo usuário
app.post('/api/corrigir/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { correctedResponse } = req.body;

    if (!correctedResponse || correctedResponse.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Resposta corrigida não pode estar vazia'
      });
    }

    await client.query('BEGIN');

    // Buscar a mensagem original
    const msgResult = await client.query(
      'SELECT * FROM mensagens WHERE id = $1',
      [id]
    );

    if (msgResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Mensagem não encontrada'
      });
    }

    const mensagem = msgResult.rows[0];

    // Verificar se já foi treinada
    const existingTraining = await client.query(
      'SELECT id FROM mensagens_treinadas WHERE mensagem_id = $1',
      [id]
    );

    if (existingTraining.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Esta mensagem já foi treinada'
      });
    }

    // Inserir no banco de treinamento com correção
    await client.query(
      `INSERT INTO mensagens_treinadas 
       (mensagem_id, phone, mensagem_cliente, resposta_ia, resposta_corrigida, tipo, service) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id, 
        mensagem.phone, 
        mensagem.mensagem, 
        mensagem.resposta_ia, 
        correctedResponse,
        'corrigida', 
        mensagem.service
      ]
    );

    // Marcar como respondida
    await client.query(
      'UPDATE mensagens SET respondida = true WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Correção salva com sucesso! IA aprendeu com sua expertise.',
      data: {
        id,
        tipo: 'corrigida',
        correctedResponse
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar correção:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao salvar correção',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// ============================================
// API ENDPOINTS - IGNORAR MENSAGEM
// ============================================

// DELETE /api/mensagem/:id
// Marca mensagem como respondida sem treinar
app.delete('/api/mensagem/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE mensagens SET respondida = true WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Mensagem não encontrada'
      });
    }

    res.json({
      success: true,
      message: 'Mensagem ignorada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao ignorar mensagem:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao ignorar mensagem',
      details: error.message
    });
  }
});

// ============================================
// API ENDPOINTS - ESTATÍSTICAS
// ============================================

// GET /api/estatisticas
// Retorna estatísticas de treinamento
app.get('/api/estatisticas', async (req, res) => {
  try {
    // Total de mensagens treinadas
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM mensagens_treinadas'
    );

    // Aprovadas
    const aprovadasResult = await pool.query(
      "SELECT COUNT(*) as aprovadas FROM mensagens_treinadas WHERE tipo = 'aprovada'"
    );

    // Corrigidas
    const corridasResult = await pool.query(
      "SELECT COUNT(*) as corrigidas FROM mensagens_treinadas WHERE tipo = 'corrigida'"
    );

    // Por serviço
    const porServicoResult = await pool.query(
      `SELECT service, COUNT(*) as count 
       FROM mensagens_treinadas 
       GROUP BY service 
       ORDER BY count DESC`
    );

    // Hoje
    const hojeResult = await pool.query(
      `SELECT COUNT(*) as hoje 
       FROM mensagens_treinadas 
       WHERE DATE(created_at) = CURRENT_DATE`
    );

    const total = parseInt(totalResult.rows[0].total);
    const aprovadas = parseInt(aprovadasResult.rows[0].aprovadas);
    const corrigidas = parseInt(corridasResult.rows[0].corrigidas);
    const hoje = parseInt(hojeResult.rows[0].hoje);

    const taxaAprovacao = total > 0 ? Math.round((aprovadas / total) * 100) : 0;

    res.json({
      success: true,
      stats: {
        total,
        aprovadas,
        corrigidas,
        hoje,
        taxaAprovacao,
        porServico: porServicoResult.rows
      }
    });

  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar estatísticas',
      details: error.message
    });
  }
});

// ============================================
// API ENDPOINTS - ADICIONAR MENSAGEM (PARA TESTES)
// ============================================

// POST /api/mensagem
// Adiciona nova mensagem para treinamento (webhook ou manual)
app.post('/api/mensagem', async (req, res) => {
  try {
    const { phone, mensagem, resposta_ia, service } = req.body;

    if (!phone || !mensagem || !resposta_ia) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: phone, mensagem, resposta_ia'
      });
    }

    const result = await pool.query(
      `INSERT INTO mensagens (phone, mensagem, resposta_ia, service) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [phone, mensagem, resposta_ia, service || 'geral']
    );

    res.json({
      success: true,
      message: 'Mensagem adicionada com sucesso',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao adicionar mensagem:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao adicionar mensagem',
      details: error.message
    });
  }
});

// ============================================
// SERVE DASHBOARD
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║   🚗 WDespachante Training API            ║
║   ✅ Servidor rodando na porta ${PORT}      ║
║   📊 Dashboard: http://localhost:${PORT}   ║
║   🔗 API: http://localhost:${PORT}/api     ║
╚════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  await pool.end();
  process.exit(0);
});
