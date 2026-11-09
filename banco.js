const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const caminhoBanco = path.join(__dirname, 'smartstock.db');

const db = new sqlite3.Database(caminhoBanco, (erro) => {
    if (erro) {
        console.error('Erro ao abrir banco:', erro.message);
        process.exitCode = 1;
        return;
    }

    console.log('Banco de dados conectado!');
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS ferramentas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            uid TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'Disponível'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            matricula TEXT NOT NULL UNIQUE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS movimentacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ferramenta_id INTEGER NOT NULL,
            usuario_id INTEGER,
            acao TEXT NOT NULL,
            data_hora TEXT NOT NULL,
            FOREIGN KEY (ferramenta_id) REFERENCES ferramentas(id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    // Migração segura para bancos antigos que ainda não possuem usuario_id.
    db.all('PRAGMA table_info(movimentacoes)', [], (erro, colunas) => {
        if (erro) {
            console.error('Erro verificando tabela movimentacoes:', erro.message);
            return;
        }

        const possuiUsuarioId = colunas.some(coluna => coluna.name === 'usuario_id');

        if (!possuiUsuarioId) {
            db.run(
                'ALTER TABLE movimentacoes ADD COLUMN usuario_id INTEGER',
                (erroAlteracao) => {
                    if (erroAlteracao) {
                        console.error('Erro adicionando usuario_id:', erroAlteracao.message);
                    } else {
                        console.log('Coluna usuario_id adicionada!');
                    }
                }
            );
        }
    });

    const inserirFerramenta = db.prepare(`
        INSERT OR IGNORE INTO ferramentas (nome, uid, status)
        VALUES (?, ?, 'Disponível')
    `);

    inserirFerramenta.run('Chaveiro Azul', '17 58 E5 00');
    inserirFerramenta.run('Cartão RFID', 'E9 4F 15 05');
    inserirFerramenta.finalize();

    const inserirUsuario = db.prepare(`
        INSERT OR IGNORE INTO usuarios (nome, matricula)
        VALUES (?, ?)
    `);

    inserirUsuario.run('Kauã Teles', '001');
    inserirUsuario.run('Lucas Gabriel', '002');
    inserirUsuario.finalize();
});

db.close((erro) => {
    if (erro) {
        console.error('Erro ao fechar banco:', erro.message);
        process.exitCode = 1;
        return;
    }

    console.log('Banco inicializado. Os registros já existentes foram preservados.');
});
