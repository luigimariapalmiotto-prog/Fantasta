"""Estrae nome / squadra / ruolo dal PDF del listone e genera players.json"""
import json, sys, pdfplumber

PDF = sys.argv[1] if len(sys.argv) > 1 else "fantacampionato_listone_26-27-2.pdf"
ROLES = {"Portieri": "POR", "Difensori": "DIF", "Centrocampisti": "CEN", "Attaccanti": "ATT", "Allenatori": None}
TEAMS = {"ATA","BOL","CAG","COM","FIO","FRO","GEN","INT","JUV","LAZ","LEC","MIL","MON","NAP","PAR","ROM","SAS","TOR","UDI","VEN"}

players, role = [], None
with pdfplumber.open(PDF) as pdf:
    for page in pdf.pages:
        words = page.extract_words(keep_blank_chars=True, x_tolerance=2)
        mid = page.width / 2
        # ordina per colonna (sx/dx) poi per riga
        words.sort(key=lambda w: (w["x0"] > mid, round(w["top"])))
        rows = {}
        for w in words:
            rows.setdefault((w["x0"] > mid, round(w["top"])), []).append(w)
        for key in sorted(rows):
            r = sorted(rows[key], key=lambda w: w["x0"])
            texts = [w["text"].strip() for w in r]
            if texts[0] in ROLES:
                role = ROLES[texts[0]]; continue
            if len(texts) >= 3 and texts[1] in TEAMS and role:
                players.append({"name": texts[0], "team": texts[1], "role": role, "cost": int(texts[2])})

json.dump(players, open("players.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print(len(players), Counter(p["role"] for p in players))
