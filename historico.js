const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'smartstock.db'));

console.log('\n================================');
console.log('       SMART STOCK - HISTÓRICO');
console.log('================================\n');

const sql = `
    SELECT
        movimentacoes.id,
        ferramentas.nome AS ferramenta,
        ferramentas.uid,
        usuarios.nome AS usuario,
        usuarios.matricula,
        movimentacoes.acao,
        movimentacoes.data_hora
    FROM movimentacoes
    INNER JOIN ferramentas
        ON movimentacoes.ferramenta_id = ferramentas.id
    LEFT JOIN usuarios
        ON movimentacoes.usuario_id = usuarios.id
    ORDER BY movimentacoes.id DESC
`;

db.all(sql, [], (erro, registros) => {
    if (erro) {
        console.error('Erro ao consultar histórico:', erro.message);
        db.close();
        return;
    }

    if (registros.length === 0) {
        console.log('Nenhuma movimentação registrada.');
    } else {
        registros.forEach(registro => {
            console.log('--------------------------------');
            console.log('ID:', registro.id);
            console.log('Ferramenta:', registro.ferramenta);
            console.log('UID:', registro.uid);
            console.log('Usuário:', registro.usuario || '-');
            console.log('Matrícula:', registro.matricula || '-');
            console.log('Ação:', registro.acao);
            console.log('Data/Hora:', registro.data_hora);
        });
        console.log('--------------------------------');
    }

    console.log('\nTotal de movimentações:', registros.length, '\n');
    db.close();
});
