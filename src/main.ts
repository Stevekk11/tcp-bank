import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import winston from 'winston'; // not cigarettes⚠️
import DailyRotateFile from 'winston-daily-rotate-file';
import { NetworkMonitor } from './NetworkMonitor.js';
import { commandRegistry, CommandContext } from './commands.js';

// Loading the config
const configPath = path.resolve('./app_config.json');
if (!existsSync(configPath)) {
    console.error("Chybí app_config.json!");
    process.exit(1);
}
const CONFIG = JSON.parse(readFileSync(configPath, 'utf-8'));

{
    const logDir = path.dirname(CONFIG.LOG_FILE);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    if (!existsSync(CONFIG.LOG_FILE)) {
        try {
            writeFileSync(CONFIG.LOG_FILE, '');
        } catch { }
    }
}

// Make date pattern safe for filenames on Windows (':' not allowed) and avoid spaces
const rawDatePattern = (CONFIG.DATE_FORMAT || 'YYYY-MM-DD');
const safeDatePattern = rawDatePattern.replace(/:/g, '-').replace(/\s+/g, '_');

// Build a filename pattern for rotation that places %DATE% before the extension
let rotateFilename: string;
if (CONFIG.LOG_FILE.includes('%DATE%')) {
    rotateFilename = CONFIG.LOG_FILE;
} else {
    const ext = path.extname(CONFIG.LOG_FILE) || '.log';
    const base = CONFIG.LOG_FILE.slice(0, -ext.length);
    rotateFilename = `${base}-%DATE%${ext}`;
}

// Logging configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({
            filename: rotateFilename,
            datePattern: safeDatePattern,
            maxSize: CONFIG.LOG_MAX_SIZE || '20m',
            maxFiles: CONFIG.LOG_MAX_FILES || '14',
            zippedArchive: true
        })
    ]
});


function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
    ]);
}

async function startServer() {
    if (!existsSync(CONFIG.ACCOUNTS_DIR)) mkdirSync(CONFIG.ACCOUNTS_DIR);

    const networkMonitor = new NetworkMonitor(logger, CONFIG.NETWORK_CHECK_INTERVAL || 30000);
    networkMonitor.startMonitoring();
    const server = net.createServer((socket) => {
        const remoteInfo = `${socket.remoteAddress}:${socket.remotePort}`;
        logger.info(`Připojen klient: ${remoteInfo}`);
        socket.setTimeout(CONFIG.CLIENT_IDLE_TIMEOUT);
        socket.on('timeout', () => {
            logger.warn(`Klient ${remoteInfo} odpojen pro neaktivitu.`);
            socket.end();
        });

        socket.on('data', async (data) => {

            const input = data.toString().trim();
            if (!input) return;

            if (!networkMonitor.checkConnection()) {
                const errorMsg = "ER Není připojen síťový kabel (příkazy jsou blokovány)\r\n";
                socket.write(errorMsg);
                logger.error(`Příkaz zablokován pro ${socket.remoteAddress}: Žádná síť`);
                return; // Ukončí zpracování
            }

            const [command, ...args] = input.split(/\s+/);
            const bankCode = socket.localAddress.replace('::ffff:', '');
            const getPath = (acc: string) => path.join(CONFIG.ACCOUNTS_DIR, `${acc}.txt`);

            try {
                await withTimeout((async () => {
                    const handler = commandRegistry.get(command);
                    if (handler) {
                        const ctx: CommandContext = {
                            socket,
                            args,
                            bankCode,
                            getPath,
                            remoteInfo,
                            logger,
                            networkMonitor,
                            CONFIG
                        };
                        await handler.execute(ctx);
                    } else {
                        socket.write(`ER Neznámý příkaz\r\n`);
                    }
                })(), CONFIG.RESPONSE_TIMEOUT);

            } catch (err: any) {
                let errMsg = "ER Chyba na serveru";
                if (err.message === 'TIMEOUT') errMsg = "ER Operace trvala příliš dlouho!";
                if (err.message === 'LOW_FUNDS') errMsg = "ER Není dostatek finančních prostředků!";

                socket.write(`${errMsg}\r\n`);
                logger.error(`Chyba (${remoteInfo}): ${err.message}`);
            }
        });

        socket.on('error', (err) => logger.error(`Socket error: ${err.message}`));
    });

    server.listen(CONFIG.PORT, CONFIG.HOST, () => {
        logger.info(`bankovní SERVER spuštěn na ${CONFIG.HOST}:${CONFIG.PORT}`);
    });
}

startServer().catch(err => logger.error(`FATAL: ${err.message}`));