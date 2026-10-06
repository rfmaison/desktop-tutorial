# Red Panda Inventory

A self-hosted inventory system for Red Panda. It keeps stock up to date as you scan, and every screen updates live.

- **Auto key-in.** Scan a barcode with a USB or Bluetooth scanner, or with a phone camera, and the stock updates straight away. You don't need to type anything.
  - **Stock in**: deliveries (+qty)
  - **Stock out**: usage, sales or waste (−qty)
  - **Set qty**: sets the exact on-hand amount
  - **Unknown barcode**: the "new item" form opens with the barcode already filled in
- **Live counting.** Every phone, tablet and PC sees the same numbers in real time, with a "N devices" indicator. The **Live count** tab is for stocktake: several people scan at the same time into one shared count, you see the difference against the system, then **Apply count** updates the stock.
- **Low-stock alerts.** Set a minimum per item. Items at or below it are flagged in red, with a pop-up when stock drops.
- **Full history.** Every change is logged with time, amount, result and source (scanner, camera, app, POS, stocktake).
- **CSV import and export.** Load your existing item list (see `deploy/sample-items.csv`) or back it up to Excel.
- **POS / automation API.** Your cash register or another script can deduct stock automatically on each sale.

There are no npm dependencies. It needs Node.js 22.13 or newer and keeps its data in one SQLite file (`data/inventory.db`).

## Run it on your server

### Option A: Docker (easiest)

```bash
git clone <this repo> red-panda-inventory && cd red-panda-inventory
# edit ACCESS_PIN and API_KEY in docker-compose.yml
docker compose up -d
```

Then open `http://YOUR-SERVER-IP:3000`.

### Option B: Plain Node.js

```bash
ACCESS_PIN=1234 API_KEY=secret-pos-key npm start
```

To keep it running after a reboot, use `deploy/red-panda-inventory.service` (systemd).

### HTTPS (needed for the phone camera)

Browsers only allow camera access over HTTPS. Point a domain at your server and use `deploy/Caddyfile`, which gets a free certificate automatically. A USB or Bluetooth scanner works without HTTPS.

| Env var      | Default               | Meaning                                                        |
|--------------|-----------------------|----------------------------------------------------------------|
| `PORT`       | `3000`                | Port to listen on                                              |
| `ACCESS_PIN` | *(none)*              | PIN staff enter in the web app. **Set this.**                  |
| `API_KEY`    | *(none)*              | Key your POS or scripts send as the `x-api-key` header         |
| `DB_FILE`    | `data/inventory.db`   | Database location. To back up, copy this file.                 |

## Daily use

1. Open the site on the counter PC or a phone, then enter the PIN once.
2. **Scan** tab: choose *Stock in* or *Stock out*, set the qty if it isn't 1, then scan.
3. **Stock** tab: search, use the +/− buttons, edit items, and see low stock.
4. **Live count** tab: at closing or month end, everyone scans the shelves. Check the Diff column, then press **Apply count**.
5. **History** tab: see who changed what and when.

## Connect your POS (auto-deduct on sale)

```bash
curl -X POST https://inventory.example.com/api/movements \
  -H "x-api-key: secret-pos-key" -H "content-type: application/json" \
  -d '{"source":"pos","movements":[
        {"barcode":"8850000000042","type":"out","qty":2},
        {"sku":"ST-01","type":"out","qty":2}
      ]}'
```

Each line returns the new quantity. Lines with unknown barcodes come back in `errors`, and the other lines are still applied. Every open screen updates instantly.

### API reference

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/items` | all items |
| POST | `/api/items` | `{name, barcode, sku, category, unit, qty, min_qty}` |
| PATCH | `/api/items/:id` | any of the fields above (changing `qty` is logged) |
| DELETE | `/api/items/:id` | |
| GET | `/api/lookup?code=…` | find an item by barcode or SKU |
| POST | `/api/movements` | `{barcode \| sku \| item_id, type: in\|out\|adjust\|count, qty, note, source}` or `{movements:[…]}` |
| GET | `/api/movements?limit=100&item_id=` | history |
| GET/POST | `/api/count` | live stocktake: `{barcode, qty}` adds, `{item_id, set}` overwrites |
| POST | `/api/count/commit` · `/api/count/clear` | apply the count to stock, or discard it |
| GET | `/api/export.csv` · POST `/api/import` | CSV (columns: `name,barcode,sku,category,unit,qty,min_qty`) |
| GET | `/api/events` | live Server-Sent Events stream |

Authenticate with the `x-pin` or `x-api-key` header (or `?pin=` for `/api/events`).

## Development

```bash
npm test     # unit + API tests
npm start
```
