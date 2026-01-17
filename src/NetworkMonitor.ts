
import { Logger } from 'winston';
import {execSync} from "node:child_process";

/**
 * Třída pro monitorování síťového připojení.
 * Pokud není detekováno žádné aktivní síťové rozhraní kromě localhost,
 * vyvolá varování do logu a blokuje příkazy v main..
 */
export class NetworkMonitor {
    private logger: Logger;
    private checkInterval: number;
    private timer: NodeJS.Timeout | null = null;
    private isConnected: boolean = true;

    constructor(logger: Logger, checkIntervalMs: number = 30000) {
        this.logger = logger;
        this.checkInterval = checkIntervalMs;
    }

    /**
     * Zkontroluje síťová rozhraní.
     * Pokud nenajde žádné aktivní rozhraní kromě localhost, vyvolá varování.
     */
    public checkConnection(): boolean {
        try {

            const stdout = execSync('route print -4 0.0.0.0').toString();

            const found = stdout.includes('0.0.0.0');

            if (!found && this.isConnected) {
                this.logger.error("SÍŤOVÁ CHYBA: Výchozí brána nebyla nalezena! Kabel je pravděpodobně odpojen.");
                this.isConnected = false;
            } else if (found && !this.isConnected) {
                this.logger.info("SÍŤ OBNOVENA: Výchozí brána je opět dostupná.");
                this.isConnected = true;
            }

            return found;
        } catch (error) {
            if (this.isConnected) {
                this.logger.error("SÍŤOVÁ CHYBA: Nelze zjistit stav směrovací tabulky.");
                this.isConnected = false;
            }
            return false;
        }
    }

    /**
     * Spustí automatickou periodickou kontrolu.
     */
    public startMonitoring() {
        this.checkConnection(); // První kontrola hned při startu
        this.timer = setInterval(() => this.checkConnection(), this.checkInterval);
        this.logger.info(`Sledování sítě spuštěno (interval ${this.checkInterval / 1000}s).`);
    }

    /**
     * Zastaví automatickou periodickou kontrolu.
     */
    public stopMonitoring() {
        if (this.timer) {
            this.logger.info(`Sledování sítě zastaveno.`);
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}