// Script de Teste - Adiciona mensagens de exemplo
const API_URL = 'http://localhost:3000';

const mensagensExemplo = [
    {
        phone: '11999999999',
        text: 'Oi! Preciso renovar minha CNH. Quais documentos preciso?',
        category: 'cnh'
    },
    {
        phone: '11988888888',
        text: 'Recebi uma multa por velocidade. Como faço para recorrer?',
        category: 'multa'
    },
    {
        phone: '11977777777',
        text: 'Comprei um carro usado. Como faço a transferência?',
        category: 'transferencia'
    },
    {
        phone: '11966666666',
        text: 'Meu licenciamento venceu mês passado. Tem multa?',
        category: 'licenciamento'
    },
    {
        phone: '11955555555',
        text: 'Preciso fazer vistoria do meu carro. Onde fica?',
        category: 'veiculo'
    }
];

async function adicionarMensagens() {
    console.log('🚀 Adicionando mensagens de teste...\n');

    for (let i = 0; i < mensagensExemplo.length; i++) {
        const msg = mensagensExemplo[i];
        
        try {
            const response = await fetch(`${API_URL}/api/mensagem`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(msg)
            });

            const data = await response.json();

            if (data.success) {
                console.log(`✅ [${i + 1}/${mensagensExemplo.length}] ${msg.category} - ${msg.phone}`);
            } else {
                console.log(`❌ [${i + 1}/${mensagensExemplo.length}] Erro: ${data.error}`);
            }
        } catch (error) {
            console.log(`❌ [${i + 1}/${mensagensExemplo.length}] Erro: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n✅ Mensagens adicionadas!');
    console.log('🌐 Acesse: http://localhost:3000\n');
}

adicionarMensagens();
