const { SerialPort } = require('serialport');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const path = require('path');

const PORTA_SERIAL = process.env.RFID_PORTA || 'COM8';
const BAUD_RATE = 115200;
const PORTA_SERVIDOR = Number(process.env.PORT || 3000);
const db = new sqlite3.Database(path.join(__dirname, 'smartstock.db'));
db.configure('busyTimeout', 5000);

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
  }));
}
function normalizarUID(valor) { return String(valor || '').replace(/[^0-9a-f]/gi, '').toUpperCase(); }
function formatarUID(uid) { return uid.match(/.{2}/g)?.join(' ') || uid; }

const porta = new SerialPort({ path: PORTA_SERIAL, baudRate: BAUD_RATE, autoOpen: false });
let buffer = '';
let ultimoUID = '';
let ultimaLeitura = 0;
let processando = false;

porta.on('open', () => {
  console.log('\n================================');
  console.log('          SMART STOCK');
  console.log('================================');
  console.log(`Leitor conectado em ${PORTA_SERIAL}`);
  console.log(`Velocidade: ${BAUD_RATE} baud`);
  console.log('Aguardando sinal do ESP8266...\n');
});
porta.on('error', err => {
  console.error('\nERRO NA PORTA SERIAL:', err.message);
  if (/access denied|permission/i.test(err.message)) console.error('Feche o Monitor Serial da Arduino IDE.');
});
porta.on('close', () => console.log('Porta serial fechada.'));

// O firmware envia linhas SMARTSTOCK|READY, SMARTSTOCK|ALIVE e SMARTSTOCK|RFID|UID.
// Também aceita o formato antigo: TAG DETECTADA! UID: E9 4F 15 05
porta.on('data', dados => {
  buffer += dados.toString('utf8');
  const linhas = buffer.split(/\r\n|\n|\r/);
  buffer = linhas.pop() || '';

  // Evita acumular indefinidamente caso haja ruído ou uma linha corrompida.
  if (buffer.length > 512) buffer = buffer.slice(-128);

  for (const original of linhas) {
    const linha = original.trim();
    if (!linha) continue;
    console.log('SERIAL:', linha);

    if (linha === 'SMARTSTOCK|READY') {
      console.log('LEITOR RFID PRONTO. Aproxime uma tag.');
      continue;
    }
    if (linha === 'SMARTSTOCK|ALIVE') continue;
    if (linha.startsWith('SMARTSTOCK|ERROR|')) {
      console.error('DIAGNÓSTICO DO ESP8266:', linha.split('|').slice(2).join('|'));
      continue;
    }

    let bruto = '';
    if (linha.startsWith('SMARTSTOCK|RFID|')) bruto = linha.substring('SMARTSTOCK|RFID|'.length);
    else {
      const match = linha.match(/UID\s*:\s*(.*)$/i);
      if (match) bruto = match[1];
    }
    if (!bruto) continue;

    const uid = normalizarUID(bruto);
    if (![8, 14, 20].includes(uid.length)) {
      console.log('UID inválido recebido:', bruto);
      continue;
    }
    console.log('UID IDENTIFICADO:', formatarUID(uid));
    processarRFID(uid);
  }
});

porta.open(err => {
  if (err) {
    console.error(`Não foi possível abrir ${PORTA_SERIAL}:`, err.message);
    console.error('Confira a porta no Gerenciador de Dispositivos e feche o Monitor Serial.');
  }
});

function buscarUsuarioAtivo() {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: PORTA_SERVIDOR, path: '/api/usuario-ativo', timeout: 5000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Servidor HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body).usuario || null); }
        catch { reject(new Error('Resposta inválida do servidor ao consultar usuário ativo.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao consultar servidor.')));
    req.on('error', reject);
  });
}

async function processarRFID(uid) {
  const agora = Date.now();
  if (processando) { console.log('Movimentação anterior ainda está sendo processada.'); return; }
  if (uid === ultimoUID && agora - ultimaLeitura < 2500) { console.log('Leitura duplicada ignorada.'); return; }
  ultimoUID = uid;
  ultimaLeitura = agora;
  processando = true;

  try {
    const usuario = await buscarUsuarioAtivo();
    if (!usuario?.id) {
      console.log('\nNENHUM USUÁRIO SELECIONADO. Selecione um usuário no site antes de aproximar a tag.\n');
      return;
    }

    await dbRun('BEGIN IMMEDIATE TRANSACTION');
    try {
      const ferramenta = await dbGet("SELECT * FROM ferramentas WHERE REPLACE(UPPER(uid), ' ', '') = ?", [uid]);
      if (!ferramenta) {
        await dbRun('ROLLBACK');
        console.log('FERRAMENTA NÃO CADASTRADA. UID:', formatarUID(uid));
        return;
      }

      const disponivel = ferramenta.status.trim().toLocaleLowerCase('pt-BR') === 'disponível';
      const acao = disponivel ? 'Retirada' : 'Devolução';
      const novoStatus = disponivel ? 'Retirada' : 'Disponível';
      await dbRun('UPDATE ferramentas SET status=? WHERE id=?', [novoStatus, ferramenta.id]);
      const registro = await dbRun(`INSERT INTO movimentacoes (ferramenta_id, usuario_id, acao, data_hora)
        VALUES (?, ?, ?, datetime('now','localtime'))`, [ferramenta.id, usuario.id, acao]);
      await dbRun('COMMIT');

      console.log('\n================================');
      console.log('MOVIMENTAÇÃO REGISTRADA!');
      console.log('Ferramenta:', ferramenta.nome);
      console.log('UID:', ferramenta.uid);
      console.log('Usuário:', usuario.nome, '| Matrícula:', usuario.matricula);
      console.log('Ação:', acao, '| Novo status:', novoStatus);
      console.log('Registro:', registro.lastID);
      console.log('================================\n');
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('ERRO AO PROCESSAR RFID:', err.message);
  } finally {
    processando = false;
  }
}

process.on('SIGINT', () => {
  console.log('\nEncerrando leitor RFID...');
  const closeDb = () => db.close(() => process.exit(0));
  if (porta.isOpen) porta.close(closeDb); else closeDb();
});
