# Meta customer list format

Format for uploading the centre parent database to Meta (Facebook) Ads as a Custom Audience customer list.

## Columns (A–S, exact header row)

| Col | Header | Content |
|---|---|---|
| A–C | `email` ×3 | That parent's email(s). Lowercase, invalid ones dropped |
| D–F | `phone` ×3 | That parent's phone(s), formatted `+60XXXXXXXXX` |
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

- **One row per parent (v2):** father and mother each get their own row with only their own email, phone, name
  and MyKad details. Guardian / emergency contact is used only when neither parent has an email or phone.
- Each input file becomes its own output file (`META_<CENTRE>.xlsx`) with a single tab; all tabs of that file are compiled into it.
- Three input layouts are recognised automatically:
  - **Full database**: one tab per centre, header in row 1 (`E-mail`, `E-mail Father`, `E-mail Mother`, `Phone Father`, `Phone Mother`, …).
  - **2024 class database** (`HH_DATABASE_<CENTRE>.xlsx`): one tab per class (6YO … QURANIC), title block on top, then
    `NAME | MY KID NO | ADDRESS | FATHER'S NAME | EMAIL | PHONE NO | I/C NO | MOTHER'S NAME | PHONE NO | I/C NO | EMAIL`.
    Columns are matched by header name, so other orders work too (repeated PHONE NO / I/C NO / EMAIL = father first,
    mother second). A tab may repeat its header row part-way down. With a single EMAIL column the email is given to the
    parent whose name it resembles (default father).
  - **2024 student-list layout** (e.g. Skyawani): header `Bil | Student Name | Student IC No. | Class Names | Address |
    Parents 1: Mobile | Parents 1: Name | Parents 1: IC No. | Parents 1: Email | Parents 2: …`. Parent 1 / Parent 2 are
    treated as the two parents; `gen` then comes only from the MyKad or BIN/BINTI in the name, never from the slot.
- Rows with no email and no phone are removed. The same person listed for several children/tabs is merged into one row
  (shared email, phone or full name), but rows with different names or genders are never merged.
- An email both parents share goes to the parent it resembles; a phone typed for both parents is kept only on the row
  that has no other contact.
- If the name says BIN/BINTI and the MyKad gender does not match, the MyKad is ignored (it belongs to the other parent) and `gen` follows the name.
- Everything else (child name, IC numbers, salary, address text…) is not exported.
- On Meta upload: choose date format `YYYY-MM-DD`; set `madid`, `uid`, `value` to "Do not upload".

## Usage

```bash
pip install pandas openpyxl
python convert_to_meta.py FILE1.xlsx [FILE2.xlsx ...] -o OUTPUT_FOLDER --suffix _v2
```

Do not commit the input or output spreadsheets — they contain personal data.
