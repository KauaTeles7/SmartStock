const { SerialPort } = require('serialport');
const PORTA = process.env.RFID_PORTA || 'COM8';
const port = new SerialPort({ path: PORTA, baudRate: 115200, autoOpen: false });
port.on('open', () => console.log(`PORTA ABERTA: ${PORTA} @ 115200 baud — aproxime uma tag.`));
port.on('data', data => console.log('DADOS:', data.toString('utf8')));
port.on('error', err => console.error('ERRO SERIAL:', err.message));
port.on('close', () => console.log('PORTA FECHADA'));
port.open(err => { if (err) console.error(`Não foi possível abrir ${PORTA}:`, err.message); });
process.on('SIGINT', () => { if (port.isOpen) port.close(() => process.exit(0)); else process.exit(0); });
