#!/usr/bin/env python3
"""Visitor statistics workbook -> public/data/tourism_stats.json (values copied as published).

Source: data/raw/documents/Kyoto_Tourism_Data_EN.xlsx. Nothing is estimated or allocated:
municipal totals stay municipal, blank cells stay null, and site tables are not joined to map records.
Usage: python3 scripts/prepare_tourism_stats.py
"""
import json
import os
import time

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'raw', 'documents', 'Kyoto_Tourism_Data_EN.xlsx')
OUT = os.path.join(ROOT, 'public', 'data', 'tourism_stats.json')


def num(v):
    if v is None or v == '':
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return None


def sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    meta = [str(r[6]) for r in rows if len(r) > 6 and r[6] and r[6] != 'SOURCE AND DEFINITIONS']
    head = [str(c).strip() for c in rows[5][:4] if c]
    body, notes = [], []
    for r in rows[6:]:
        cells = r[:len(head)]
        if not any(c not in (None, '') for c in cells):
            continue
        if all(c in (None, '') for c in cells[1:]):
            notes.append(str(cells[0]).strip())      # footnotes sit in column A under the table
        else:
            body.append([str(cells[0]).strip()] + list(cells[1:]))
    return {
        'title': str(rows[1][0]).strip(), 'scope': str(rows[2][0]).strip(), 'columns': head,
        'source_url': next((m for m in meta if m.startswith('http')), None),
        'accessed': next((m for m in meta if m.startswith('Accessed')), None),
        'notes': notes, 'rows': body,
    }


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    s = {ws.title: sheet(ws) for ws in wb}
    muni = s['Municipalities 2025']
    out = {
        'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'source_file': 'data/raw/documents/Kyoto_Tourism_Data_EN.xlsx',
        'municipalities': {
            **{k: muni[k] for k in ('title', 'scope', 'source_url', 'accessed', 'notes')},
            'unit': 'reported tourism count (persons, published old-standard series)',
            'years': [2025, 2024],
            # keyed by the English municipality name used in the workbook
            'counts': {r[0]: {'2025': num(r[1]), '2024': num(r[2])} for r in muni['rows']},
        },
        'reference_tables': [
            {**s['Sites 2015'], 'unit': 'visits per year', 'rows': [[r[0], r[1], num(r[2]), num(r[3])] for r in s['Sites 2015']['rows']]},
            {**s['Visit shares 2023'], 'unit': 'share of survey respondents (multiple answers)', 'rows': [[r[0], num(r[1]), r[2]] for r in s['Visit shares 2023']['rows']]},
            {**s['Nijo Castle'], 'unit': 'admissions per fiscal year', 'rows': [[r[0], r[1], num(r[2])] for r in s['Nijo Castle']['rows']]},
        ],
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('municipalities', len(out['municipalities']['counts']), [(t['title'], len(t['rows'])) for t in out['reference_tables']])


if __name__ == '__main__':
    main()
