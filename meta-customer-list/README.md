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

- Each input file becomes its own output file (`META_<CENTRE>.xlsx`) with a single tab; all tabs of that file are compiled into it.
- Two input layouts are recognised automatically:
  - **Full database**: one tab per centre, header in row 1 (`E-mail`, `E-mail Father`, `E-mail Mother`, `Phone Father`, `Phone Mother`, …).
  - **2024 class database** (`HH_DATABASE_<CENTRE>.xlsx`): one tab per class (6YO … QURANIC), title block on top, then
    `NAME | MY KID NO | ADDRESS | FATHER'S NAME | EMAIL | PHONE NO | I/C NO | MOTHER'S NAME | PHONE NO | I/C NO | EMAIL`.
    Columns are matched by header name, so other orders work too (repeated PHONE NO / I/C NO / EMAIL = father first,
    mother second). A tab may repeat its header row part-way down. With a single EMAIL column the email is given to the
    parent whose name it resembles (default father).
- Name / MyKad come from the parent who owns the main email or phone (2024 layout: father if he has an email, else mother); otherwise the father.
- Rows with no email and no phone are removed; rows sharing any email or phone (siblings, same family in two tabs) are merged, keeping the most complete row.
- If the name says BIN/BINTI and the MyKad gender does not match, the MyKad is ignored (it belongs to the other parent) and `gen` follows the name.
- Everything else (child name, IC numbers, salary, address text…) is not exported.
- On Meta upload: choose date format `YYYY-MM-DD`; set `madid`, `uid`, `value` to "Do not upload".

## Usage

```bash
pip install pandas openpyxl
python convert_to_meta.py FILE1.xlsx [FILE2.xlsx ...] -o OUTPUT_FOLDER
```

Do not commit the input or output spreadsheets — they contain personal data.
