import os from 'node:os';
import { Logger } from 'winston';

/**
 * Třída pro monitorování síťového připojení.
 * Pokud není detekováno žádné aktivní síťové rozhraní kromě localhost,
 * vyvolá varování do logu a blokuje příkazy v main..
 */
export class NetworkMonitor {
    private logger: Logger;
    private checkInterval: number;
    private timer: NodeJS.Timeout | null = null;

    constructor(logger: Logger, checkIntervalMs: number = 30000) {
        this.logger = logger;
        this.checkInterval = checkIntervalMs;
    }

    /**
     * Zkontroluje síťová rozhraní.
     * Pokud nenajde žádné aktivní rozhraní kromě localhost, vyvolá varování.
     */
    public checkConnection(): boolean {
        const interfaces = os.networkInterfaces();
        let isConnected = false;

        for (const name of Object.keys(interfaces)) {
            const networkInterface = interfaces[name];
            if (!networkInterface) continue;

            for (const iface of networkInterface) {
                // Hledáme IPv4 rozhraní, které není interní (loopback/127.0.0.1)
                // a je "up" (pokud to OS podporuje)
                if (iface.family === 'IPv4' && !iface.internal) {
                    isConnected = true;
                    break;
                }
            }
            if (isConnected) break;
        }

        if (!isConnected) {
            this.logger.warn("VAROVÁNÍ: Není detekováno žádné síťové připojení! (Zkontrolujte síťový kabel)");
        }

        return isConnected;
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