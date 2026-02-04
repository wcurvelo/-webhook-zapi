const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3003;

app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging detalhado
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
};

// Endpoint para debug do formato Z-API
app.post('/webhook-debug', (req, res) => {
  const { body } = req;
  
  log('=== PAYLOAD COMPLETO DA Z-API ===');
  log('Body completo:', body);
  log('Tipo:', body?.type);
  log('Instance:', body?.instance);
  log('Data:', body?.data);
  
  if (body?.data) {
    log('From:', body.data.from);
    log('Text:', body.data.text || body.data.body);
    log('Message ID:', body.data.messageId || body.data.id);
    log('Timestamp:', body.data.timestamp);
  }
  
  // Extrair dados de diferentes formatos
  let from = 'unknown';
  let text = '(sem texto)';
  
  // Formato 1: body.data.from e body.data.text
  if (body?.data?.from && body?.data?.text) {
    from = body.data.from;
    text = body.data.text;
  }
  // Formato 2: body.data.from e body.data.body  
  else if (body?.data?.from && body?.data?.body) {
    from = body.data.from;
    text = body.data.body;
  }
  // Formato 3: body.from e body.body
  else if (body?.from && body?.body) {
    from = body.from;
    text = body.body;
  }
  // Formato 4: body.text
  else if (body?.text) {
    text = body.text;
    from = body.from || body.phone || 'unknown';
  }
  
  log('=== DADOS EXTRAÍDOS ===');
  log('From:', from);
  log('Text:', text);
  
  res.status(200).json({
    status: 'success',
    message: 'Payload recebido e logado',
    extracted: { from, text },
    raw: body
  });
});

// Endpoint raiz
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Debug Z-API Webhook</h1>
        <p>Envie payloads para POST /webhook-debug</p>
        <p>Ver logs no console</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Debug server rodando na porta ${PORT}`);
  console.log(`Envie payloads para: http://localhost:${PORT}/webhook-debug`);
});
