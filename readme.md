# Bankovní TCP server

Tento projekt implementuje bankovní server v Node.js pomocí TypeScriptu využívající TCP protokol pro komunikaci.

## Instalace

1. Naklonujte repozitář do lokálního adresáře.
2. Nainstalujte potřebné závislosti - spusťte v kořenovém adresáři projektu následující příkaz:

```bash
npm install
```

## Spuštění

### Produkční režim

Pro zkompilování TypeScriptu a následné spuštění aplikace:

```bash
npm run build
npm start
```

### Vývojový režim

Pro spuštění v režimu sledování změn (automatický restart při změně kódu):

```bash
npm run dev
```

# Připojení k serveru

Server naslouchá na IP adrese 0.0.0.0 a port si nastavíte v konfiguraci. Výchozí port je 65525. Nezapomeňte ho změnit na
školní port pokud bude potřeba.

Pro připojení k serveru můžete použít libovolného TCP klienta, například `putty` nebo `netcat` na Linuxu. Telnet raději
nepoužívejte, protože nemusí správně zpracovávat české znaky.

## Konfigurační soubor

Jméno konfiguračního souboru je `app_config.json` a nachází se v kořenovém adresáři projektu. Příklad obsahu:

```json
{
  "PORT": 65525,
  "HOST": "0.0.0.0",
  "RESPONSE_TIMEOUT": 5000,
  "CLIENT_IDLE_TIMEOUT": 60000,
  "ACCOUNTS_DIR": "./accounts",
  "LOG_FILE": "./logs/bank.log",
  "LOG_MAX_SIZE": "15m",
  "LOG_MAX_FILES": 10,
  "DATE_FORMAT": "YYYY-MM-DD",
  "NETWORK_CHECK_INTERVAL": 25000
}
```

## Seznam příkazů

Server přijímá textové příkazy zakončené znaky `\r\n`.

| Příkaz | Popis                                                 | Příklad                 |
|:-------|:------------------------------------------------------|:------------------------|
| `BC`   | Vrátí kód banky (IP adresu serveru).                  | `BC`                    |
| `AC`   | Vytvoří nový účet s náhodným číslem.                  | `AC`                    |
| `AD`   | Vklad peněz na účet (formát `číslo/kód částka`).      | `AD 1001/127.0.0.1 500` |
| `AW`   | Výběr peněz z účtu.                                   | `AW 1001/127.0.0.1 200` |
| `AB`   | Zjištění aktuálního zůstatku na účtu.                 | `AB 1001/127.0.0.1`     |
| `AR`   | Zrušení účtu (pouze pokud je zůstatek 0).             | `AR 1001/127.0.0.1`     |
| `BA`   | Celková částka spravovaná bankou (součet všech účtů). | `BA`                    |
| `BN`   | Celkový počet vedených účtů v bance.                  | `BN`                    |
| `exit` | Ukončí aktuální spojení se serverem.                  | `exit`                  | - navíc

## Umístění dat

* **Účty**: Data jednotlivých účtů jsou uložena v adresáři `accounts/`. Každý soubor je pojmenován podle čísla účtu a
  obsahuje číselnou hodnotu zůstatku.
* **Logy**: Záznamy o běhu serveru, připojených klientech a chybách se ukládají do adresáře `logs/` a vypisují se do
  konzole.

### Proč jsem sáhl po hotových balíčcích (Winston logování)

### Pro:

Šetřím si čas: Nechtěl jsem ztrácet hodiny programováním toho, jak má soubor s logy rotovat a zapisovat, když je moc
velký. Balíček to vyřeší za mě.
Věřím jim: Používají je tisíce lidí, takže vím, že mi server jen tak nespadne kvůli chybě při zápisu na disk.

### Proti:

Zbytečná váha: Tahám do projektu stovky řádků kódu, ze kterých reálně využiju jen zlomek.
Závislost: Pokud autor balíček smaže nebo v něm nechá chybu, musím to řešit i já.

2. Proč jsem si zbytek napsal sám (např. Logika banky, Proxy)

### Pro:

Mám to pod kontrolou: Zadání je hodně specifické (přesné kódy). Žádný balíček na „školní TCP banku“
neexistuje, takže si to musím ohýbat podle svého.
Vím, co se uvnitř děje: Každému řádku v kódu rozumím. Když se při testování se spolužáky něco rozbije, hned vím, kam
sáhnout. Navíc jsem se tím nejvíc naučil.

### Proti:

Vlastní chyby: Jelikož jsem to psal „na koleni“, je tam větší šance, že jsem přehlédl nějaký detail, který se projeví až
v ostrém provozu.
Dalo to víc práce: Každou drobnost, jako je parsování lomítek v adresách, jsem musel vymyslet, napsat a otestovat úplně
sám.