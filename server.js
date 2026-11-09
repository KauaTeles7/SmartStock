const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORTA = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, 'smartstock.db');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('ERRO AO CONECTAR AO BANCO:', err.message);
  else console.log('Banco de dados conectado:', DB_PATH);
});

db.configure('busyTimeout', 5000);

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
  }));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function normalizeUid(value) { return clean(value).toUpperCase().replace(/[^0-9A-F]/g, '').match(/.{1,2}/g)?.join(' ') || ''; }
function validId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function fail(res, err, status = 500) { console.error(err); return res.status(status).json({ erro: status === 500 ? 'Erro interno do servidor.' : err.message }); }

let usuarioAtivo = null;

async function initialize() {
  await run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    matricula TEXT NOT NULL UNIQUE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS ferramentas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    uid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Disponível'
  )`);
  await run(`CREATE TABLE IF NOT EXISTS movimentacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ferramenta_id INTEGER NOT NULL,
    acao TEXT NOT NULL,
    data_hora TEXT NOT NULL,
    usuario_id INTEGER
  )`);
  const cols = await all('PRAGMA table_info(movimentacoes)');
  if (!cols.some(c => c.name === 'usuario_id')) await run('ALTER TABLE movimentacoes ADD COLUMN usuario_id INTEGER');
  await run('CREATE INDEX IF NOT EXISTS idx_movimentacoes_data ON movimentacoes(id DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_ferramentas_uid ON ferramentas(uid)');
}

app.get('/api/health', async (req, res) => {
  try { await get('SELECT 1 AS ok'); res.json({ ok: true, servidor: 'online', banco: 'conectado' }); }
  catch (err) { fail(res, err); }
});

app.get('/api/resumo', async (req, res) => {
  try {
    const [ferramentas, usuarios, disponiveis, retiradas, recentes] = await Promise.all([
      get('SELECT COUNT(*) AS total FROM ferramentas'),
      get('SELECT COUNT(*) AS total FROM usuarios'),
      get("SELECT COUNT(*) AS total FROM ferramentas WHERE lower(status) = 'disponível'"),
      get("SELECT COUNT(*) AS total FROM ferramentas WHERE lower(status) <> 'disponível'"),
      all(`SELECT m.id, f.nome, f.uid, u.nome AS usuario, u.matricula, m.acao, m.data_hora
           FROM movimentacoes m JOIN ferramentas f ON f.id=m.ferramenta_id
           LEFT JOIN usuarios u ON u.id=m.usuario_id ORDER BY m.id DESC LIMIT 8`)
    ]);
    res.json({ totalFerramentas: ferramentas.total, totalUsuarios: usuarios.total,
      disponiveis: disponiveis.total, retiradas: retiradas.total, recentes });
  } catch (err) { fail(res, err); }
});

// USUÁRIOS
app.get('/api/usuarios', async (req, res) => {
  try { res.json(await all('SELECT id,nome,matricula FROM usuarios ORDER BY nome COLLATE NOCASE')); }
  catch (err) { fail(res, err); }
});
app.post('/api/usuarios', async (req, res) => {
  const nome = clean(req.body?.nome), matricula = clean(req.body?.matricula);
  if (!nome || !matricula) return res.status(400).json({ erro: 'Nome e matrícula são obrigatórios.' });
  try {
    const result = await run('INSERT INTO usuarios (nome,matricula) VALUES (?,?)', [nome, matricula]);
    res.status(201).json({ sucesso: true, id: result.id, nome, matricula });
  } catch (err) { fail(res, err.message.includes('UNIQUE') ? new Error('Essa matrícula já está cadastrada.') : err, err.message.includes('UNIQUE') ? 400 : 500); }
});
app.put('/api/usuarios/:id', async (req, res) => {
  const id = validId(req.params.id), nome = clean(req.body?.nome), matricula = clean(req.body?.matricula);
  if (!id || !nome || !matricula) return res.status(400).json({ erro: 'Informe nome e matrícula válidos.' });
  try {
    const r = await run('UPDATE usuarios SET nome=?, matricula=? WHERE id=?', [nome, matricula, id]);
    if (!r.changes) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuarioAtivo?.id === id) usuarioAtivo = { id, nome, matricula };
    res.json({ sucesso: true });
  } catch (err) { fail(res, err.message.includes('UNIQUE') ? new Error('Essa matrícula já está cadastrada.') : err, err.message.includes('UNIQUE') ? 400 : 500); }
});
app.delete('/api/usuarios/:id', async (req, res) => {
  const id = validId(req.params.id); if (!id) return res.status(400).json({ erro: 'ID inválido.' });
  try {
    await run('UPDATE movimentacoes SET usuario_id=NULL WHERE usuario_id=?', [id]);
    const r = await run('DELETE FROM usuarios WHERE id=?', [id]);
    if (!r.changes) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (usuarioAtivo?.id === id) usuarioAtivo = null;
    res.json({ sucesso: true });
  } catch (err) { fail(res, err); }
});

// USUÁRIO ATIVO (memória do servidor durante a execução)
app.post('/api/usuario-ativo', async (req, res) => {
  const id = validId(req.body?.usuario_id);
  if (!id) return res.status(400).json({ erro: 'Selecione um usuário válido.' });
  try {
    const usuario = await get('SELECT id,nome,matricula FROM usuarios WHERE id=?', [id]);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    usuarioAtivo = usuario;
    console.log(`Usuário ativo: ${usuario.nome} (${usuario.matricula})`);
    res.json({ sucesso: true, usuario });
  } catch (err) { fail(res, err); }
});
app.get('/api/usuario-ativo', (req, res) => res.json({ usuario: usuarioAtivo }));

// FERRAMENTAS
app.get('/api/ferramentas', async (req, res) => {
  const busca = clean(req.query.busca);
  try {
    const rows = busca
      ? await all('SELECT id,nome,uid,status FROM ferramentas WHERE nome LIKE ? OR uid LIKE ? ORDER BY nome COLLATE NOCASE', [`%${busca}%`, `%${busca}%`])
      : await all('SELECT id,nome,uid,status FROM ferramentas ORDER BY nome COLLATE NOCASE');
    res.json(rows);
  } catch (err) { fail(res, err); }
});
app.post('/api/ferramentas', async (req, res) => {
  const nome = clean(req.body?.nome), uid = normalizeUid(req.body?.uid);
  if (!nome || !uid || ![8, 14, 20].includes(uid.replace(/\s/g, '').length))
    return res.status(400).json({ erro: 'Informe um nome e um UID RFID válido (4, 7 ou 10 bytes).' });
  try {
    const r = await run("INSERT INTO ferramentas (nome,uid,status) VALUES (?,?,'Disponível')", [nome, uid]);
    res.status(201).json({ sucesso: true, id: r.id, nome, uid, status: 'Disponível' });
  } catch (err) { fail(res, err.message.includes('UNIQUE') ? new Error('Esse UID RFID já está cadastrado.') : err, err.message.includes('UNIQUE') ? 400 : 500); }
});
app.put('/api/ferramentas/:id', async (req, res) => {
  const id = validId(req.params.id), nome = clean(req.body?.nome);
  if (!id || !nome) return res.status(400).json({ erro: 'Informe um nome válido.' });
  try {
    const r = await run('UPDATE ferramentas SET nome=? WHERE id=?', [nome, id]);
    if (!r.changes) return res.status(404).json({ erro: 'Ferramenta não encontrada.' });
    res.json({ sucesso: true });
  } catch (err) { fail(res, err); }
});
app.delete('/api/ferramentas/:id', async (req, res) => {
  const id = validId(req.params.id); if (!id) return res.status(400).json({ erro: 'ID inválido.' });
  try {
    const count = await get('SELECT COUNT(*) AS total FROM movimentacoes WHERE ferramenta_id=?', [id]);
    if (count.total) return res.status(409).json({ erro: 'Esta ferramenta possui histórico. Altere o status ou mantenha o cadastro para preservar as movimentações.' });
    const r = await run('DELETE FROM ferramentas WHERE id=?', [id]);
    if (!r.changes) return res.status(404).json({ erro: 'Ferramenta não encontrada.' });
    res.json({ sucesso: true });
  } catch (err) { fail(res, err); }
});

// HISTÓRICO
app.get('/api/historico', async (req, res) => {
  try {
    res.json(await all(`SELECT m.id, f.nome, f.uid, u.nome AS usuario, u.matricula,
      m.acao, m.data_hora FROM movimentacoes m
      LEFT JOIN ferramentas f ON f.id=m.ferramenta_id
      LEFT JOIN usuarios u ON u.id=m.usuario_id ORDER BY m.id DESC`));
  } catch (err) { fail(res, err); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

initialize().then(() => {
  app.listen(PORTA, () => {
    console.log('\n================================');
    console.log('          SMART STOCK');
    console.log('================================');
    console.log(`Servidor iniciado: http://localhost:${PORTA}`);
    console.log('Banco de dados pronto.\n');
  });
}).catch(err => { console.error('Falha ao preparar banco de dados:', err); process.exit(1); });

process.on('SIGINT', () => {
  console.log('\nEncerrando servidor...');
  db.close(() => process.exit(0));
});
