import net from 'node:net';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from 'winston';
import { NetworkMonitor } from './NetworkMonitor.js';

/**
 * Pomocná funkce pro vyhledání souboru účtu podle čísla (prefixu).
 * Vrací celou cestu k souboru nebo null.
 */
async function findAccountFile(accountsDir: string, accNum: string): Promise<string | null> {
    try {
        const files = await fs.readdir(accountsDir);
        const found = files.find(f => f.startsWith(`${accNum}_`));
        return found ? path.join(accountsDir, found) : null;
    } catch {
        return null;
    }
}

/**
 * Pomocná funkce pro přeposlání příkazu jiné bance (proxy).
 */
async function proxyCommand(targetIp: string, targetPort: number, commandLine: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: targetIp, port: targetPort }, () => {
            socket.write(commandLine + "\r\n");
        });

        socket.on('data', (data) => {
            resolve(data.toString().trim());
            socket.end();
        });

        socket.on('error', (err) => {
            reject(err);
        });

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => {
            socket.destroy();
            reject(new Error("TIMEOUT"));
        });
    });
}

export interface CommandContext {
    socket: net.Socket;
    args: string[];
    bankCode: string;
    getPath: (acc: string) => string; // Ponecháno pro kompatibilitu, ale doporučeno findAccountFile
    remoteInfo: string;
    logger: Logger;
    networkMonitor: NetworkMonitor;
    CONFIG: any;
}

export interface Command {
    execute(ctx: CommandContext): Promise<void>;
}

export class BankCodeCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        ctx.socket.write(`BC ${ctx.bankCode}\r\n`);
    }
}

/**
 * AC: Vytvoří účet ve formátu <číslo>_<IP>.txt
 */
export class AccountCreateCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, bankCode, remoteInfo, logger, CONFIG } = ctx;

        // Získání čisté IP adresy klienta
        const clientIp = socket.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';

        let accNum: number;
        let fPath: string;
        let fileName: string;

        do {
            accNum = Math.floor(Math.random() * 90000) + 10000;
            fileName = `${accNum}_${clientIp}.txt`;
            fPath = path.join(CONFIG.ACCOUNTS_DIR, fileName);
        } while (existsSync(fPath));

        await fs.writeFile(fPath, "0");
        socket.write(`AC ${accNum}/${bankCode}\r\n`);
        logger.info(`Vytvořen účet ${accNum} pro IP ${clientIp} (${remoteInfo})`);
    }
}

/**
 * AD/AW: Transakce s podporou proxy a vyhledáváním souborů.
 */
export class TransactionCommand implements Command {
    constructor(private type: 'AD' | 'AW') {}

    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, bankCode, logger, CONFIG } = ctx;
        const [target, amountStr] = args;
        const [acc, ip] = (target || "").split('/');

        // Proxy logika pro cizí banky
        if (ip && ip !== bankCode) {
            try {
                const response = await proxyCommand(ip, CONFIG.PORT, `${this.type} ${target} ${amountStr}`, CONFIG.RESPONSE_TIMEOUT);
                socket.write(`${response}\r\n`);
            } catch (err: any) {
                socket.write(`ER Chyba při komunikaci s cizí bankou: ${err.message}\r\n`);
                logger.error(`Proxy error (${ip}): ${err.message}`);
            }
            return;
        }

        // Lokální zpracování - vyhledání souboru s IP v názvu
        const f = await findAccountFile(CONFIG.ACCOUNTS_DIR, acc);

        if (!f || !/^\d+$/.test(amountStr)) {
            socket.write(`ER Špatný formát nebo účet neexistuje.\r\n`);
        } else {
            const balance = BigInt(await fs.readFile(f, 'utf8'));
            const amount = BigInt(amountStr);
            let newBalance: bigint;

            if (this.type === 'AD') {
                newBalance = balance + amount;
            } else {
                if (balance < amount) throw new Error("LOW_FUNDS");
                newBalance = balance - amount;
            }

            await fs.writeFile(f, newBalance.toString());
            socket.write(`${this.type}\r\n`);
            logger.info(`${this.type === 'AD' ? 'Vklad' : 'Výběr'} na účtu ${acc}: ${amount}`);
        }
    }
}

/**
 * AB: Získání zůstatku s vyhledáváním podle prefixu.
 */
export class BalanceCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, bankCode, CONFIG, logger } = ctx;
        const [target] = args;
        const [acc, ip] = (target || "").split('/');

        if (ip && ip !== bankCode) {
            try {
                const response = await proxyCommand(ip, CONFIG.PORT, `AB ${target}`, CONFIG.RESPONSE_TIMEOUT);
                socket.write(`${response}\r\n`);
            } catch (err: any) {
                socket.write(`ER Chyba při komunikaci s cizí bankou: ${err.message}\r\n`);
                logger.error(`Proxy error (${ip}): ${err.message}`);
            }
            return;
        }

        const f = await findAccountFile(CONFIG.ACCOUNTS_DIR, acc);
        if (!f) {
            socket.write(`ER Účet neexistuje.\r\n`);
        } else {
            const balance = await fs.readFile(f, 'utf8');
            socket.write(`AB ${balance}\r\n`);
        }
    }
}

/**
 * AR: Odstranění účtu (pouze pokud je zůstatek 0 a IP se shoduje).
 */
export class RemoveCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, CONFIG, logger } = ctx;
        const [target] = args;
        const acc = (target || "").split('/')[0];
        const clientIp = socket.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';

        const f = await findAccountFile(CONFIG.ACCOUNTS_DIR, acc);

        if (f) {
            // Kontrola, zda účet patří této IP adrese (soubor obsahuje IP v názvu)
            const ownerIp = path.basename(f).replace('.txt', '').split('_')[1];

            if (ownerIp !== clientIp) {
                socket.write(`ER Účet může smazat pouze jeho zakladatel z původní IP adresy.\r\n`);
                return;
            }

            const balance = await fs.readFile(f, 'utf8');
            if (balance === "0") {
                await fs.unlink(f);
                socket.write(`AR\r\n`);
                logger.info(`Účet ${acc} smazán.`);
            } else {
                socket.write(`ER Nelze smazat bankovní účet na kterém jsou finance.\r\n`);
            }
        } else {
            socket.write(`ER Účet neexistuje.\r\n`);
        }
    }
}

/**
 * BA: Celková suma všech financí v bance.
 */
export class BankAmountCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, CONFIG } = ctx;
        const files = await fs.readdir(CONFIG.ACCOUNTS_DIR);
        let total = 0n;
        for (const file of files) {
            total += BigInt(await fs.readFile(path.join(CONFIG.ACCOUNTS_DIR, file), 'utf8'));
        }
        socket.write(`BA ${total.toString()}\r\n`);
    }
}

/**
 * BN: Počet unikátních IP adres (klientů).
 */
export class BankClientsCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, CONFIG } = ctx;
        const files = await fs.readdir(CONFIG.ACCOUNTS_DIR);

        const uniqueIps = new Set<string>();
        for (const file of files) {
            const parts = file.replace('.txt', '').split('_');
            if (parts.length > 1) {
                uniqueIps.add(parts[1]);
            }
        }
        socket.write(`BN ${uniqueIps.size}\r\n`);
    }
}

export class ExitCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, logger, remoteInfo } = ctx;
        socket.write(`OK Goodbye\r\n`);
        logger.info(`Klient ${remoteInfo} ukončil spojení.`);
        socket.end();
    }
}

export const commandRegistry: Map<string, Command> = new Map([
    ['BC', new BankCodeCommand()],
    ['AC', new AccountCreateCommand()],
    ['AD', new TransactionCommand('AD')],
    ['AW', new TransactionCommand('AW')],
    ['AB', new BalanceCommand()],
    ['AR', new RemoveCommand()],
    ['BA', new BankAmountCommand()],
    ['BN', new BankClientsCommand()],
    ['exit', new ExitCommand()],
]);