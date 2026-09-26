# Meta customer list format

Format for uploading the centre parent database to Meta (Facebook) Ads as a Custom Audience customer list.

## Columns (A–S, exact header row)

| Col | Header | Content |
|---|---|---|
| A–C | `email` ×3 | Parent emails: main, father, mother. Lowercase, no duplicates in a row, invalid ones dropped |
| D–F | `phone` ×3 | Father, mother, primary (or guardian/emergency) phone, formatted `+60XXXXXXXXX` |
| G | `madid` | Empty |
| H | `fn` | Parent first name (part before BIN/BINTI/BT/A/L/A/P, else first word) |
| I | `ln` | Parent last name (part after BIN/BINTI, else remaining words) |
| J | `zip` | 5-digit postcode from address |
| K | `ct` | Town (Kuala Lumpur / Putrajaya use the state name) |
| L | `st` | State, derived from postcode |
| M | `country` | `MY` |
| N | `dob` | Parent birth date from MyKad, `YYYY-MM-DD` |
| O | `doby` | Birth year |
| P | `gen` | `m` / `f` (MyKad last digit, else father/mother) |
| Q | `age` | Age today, from MyKad |
| R | `uid` | Empty |
| S | `value` | Empty |

## Rules

- One output tab per centre tab, same tab name.
- Name / MyKad come from the parent who owns the main email or phone; otherwise the father.
- Rows with no email and no phone are removed; identical rows (siblings) are de-duplicated.
- Everything else (child name, IC numbers, salary, address text…) is not exported.
- On Meta upload: choose date format `YYYY-MM-DD`; set `madid`, `uid`, `value` to "Do not upload".

## Usage

```bash
pip install pandas openpyxl
python convert_to_meta.py DATABASE_FULL.xlsx DATABASE_META_UPLOAD.xlsx
```

Do not commit the input or output spreadsheets — they contain personal data.
