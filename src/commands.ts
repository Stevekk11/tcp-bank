import net from 'node:net';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from 'winston';
import { NetworkMonitor } from './NetworkMonitor.js';

/**
 * Kontext příkazu obsahující potřebné informace pro jeho vykonání.
 */
export interface CommandContext {
    socket: net.Socket;
    args: string[];
    bankCode: string;
    getPath: (acc: string) => string;
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
 * Příkaz pro vytvoření nového bankovního účtu.
 * Generuje náhodné pětimístné číslo účtu a ukládá ho do souboru.
 */
export class AccountCreateCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, bankCode, getPath, remoteInfo, logger } = ctx;
        let accNum: number;
        let fPath: string;
        do {
            accNum = Math.floor(Math.random() * 90000) + 10000;
            fPath = getPath(accNum.toString());
        } while (existsSync(fPath));
        await fs.writeFile(fPath, "0");
        socket.write(`AC ${accNum}/${bankCode}\r\n`);
        logger.info(`Vytvořen účet ${accNum} pro ${remoteInfo}`);
    }
}

/**
 * Příkaz pro provedení transakce (vklad nebo výběr).
 */
export class TransactionCommand implements Command {
    constructor(private type: 'AD' | 'AW') {}

    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, bankCode, getPath, logger } = ctx;
        const [target, amountStr] = args;
        const [acc, ip] = (target || "").split('/');
        const f = getPath(acc);

        if (ip !== bankCode || !existsSync(f) || !/^\d+$/.test(amountStr)) {
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
 * Příkaz pro získání zůstatku na účtu.
 */
export class BalanceCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, getPath } = ctx;
        const [target] = args;
        const acc = (target || "").split('/')[0];
        const f = getPath(acc);
        if (!existsSync(f)) {
            socket.write(`ER Formát čísla účtu není správný.\r\n`);
        } else {
            const balance = await fs.readFile(f, 'utf8');
            socket.write(`AB ${balance}\r\n`);
        }
    }
}

/**
 * Příkaz pro odstranění bankovního účtu.
 * Účet může být odstraněn pouze pokud je jeho zůstatek nulový.
 */
export class RemoveCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, args, getPath, logger } = ctx;
        const [target] = args;
        const acc = (target || "").split('/')[0];
        const f = getPath(acc);
        if (existsSync(f)) {
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
 * Příkaz pro získání celkové částky ve všech bankovních účtech.
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
 * Příkaz pro získání počtu klientů banky.
 */
export class BankClientsCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, CONFIG } = ctx;
        const files = await fs.readdir(CONFIG.ACCOUNTS_DIR);
        socket.write(`BN ${files.length}\r\n`);
    }
}

/**
 * Příkaz pro ukončení spojení klienta.
 */
export class ExitCommand implements Command {
    async execute(ctx: CommandContext): Promise<void> {
        const { socket, logger, remoteInfo } = ctx;
        socket.write(`OK Goodbye\r\n`);
        //networkMonitor.stopMonitoring();
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
