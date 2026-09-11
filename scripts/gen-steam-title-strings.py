#!/usr/bin/env python3
"""Regenerate scripts/steam_assets_titles.json for Melodan Steam store section headers.

Steam asset upload forms match language from filename suffixes
(_schinese, _koreana, _brazilian…), not ISO codes. English has no suffix.

Store copy (EN source of truth):

  ASSEMBLE MYTHICAL LEGIONS
  OUTTHINK, DON'T OUTCLICK
  MASTER YOUR MAGICAL ARMORY
  MULTIPLE PATHS TO GLORY

After running with --embed, refresh scripts/steam_assets.html.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = Path(__file__).resolve().parent / "steam_assets_titles.json"
OUT_HTML = Path(__file__).resolve().parent / "steam_assets.html"

# section id → accent color + per-Steam-language title
# Keep titles short enough for a ~600px header bar; ALL CAPS in EN matches store.
SECTIONS: list[dict] = [
    {
        "section": "assemble_legions",
        "color": "#d4b878",
        "text": {
            "english": "ASSEMBLE MYTHICAL LEGIONS",
            "german": "MYTHISCHE LEGIONEN AUFSTELLEN",
            "french": "ASSEMBLEZ DES LÉGIONS MYTHIQUES",
            "italian": "ASSEMBLA LEGIONI MITICHE",
            "spanish": "REÚNE LEGIONES MÍTICAS",
            "latam": "REÚNE LEGIONES MÍTICAS",
            "brazilian": "REÚNA LEGIÕES MÍTICAS",
            "portuguese": "REÚNE LEGIÕES MÍTICAS",
            "dutch": "VERZAMEL MYTHISCHE LEGIOENEN",
            "danish": "SAML MYTISKE LEGIONER",
            "norwegian": "SAML MYTISKE LEGIONER",
            "swedish": "SAML MYTISKA LEGIONER",
            "finnish": "KOKOA MYYttisiä LEGIOONIA",
            "czech": "SESTAV MYTICKÉ LEGIE",
            "polish": "ZBIERZ MITYCZNE LEGIONY",
            "hungarian": "ÁLLÍTSD FEL A MITIKUS LÉGIÓKAT",
            "romanian": "ADUNĂ LEGIUNI MITICE",
            "turkish": "EFSANEVİ LEJYONLARI TOPLA",
            "indonesian": "KUMPULKAN LEGIUN MITIS",
            "malay": "HIMPUN LEGION MITOS",
            "vietnamese": "TẬP HỢP BINH ĐOÀN HUYỀN THOẠI",
            "greek": "ΣΥΓΚΕΝΤΡΩΣΕ ΜΥΘΙΚΕΣ ΛΕΓΕΩΝΕΣ",
            "bulgarian": "СЪБЕРИ МИТИЧНИ ЛЕГИОНИ",
            "russian": "СОБЕРИ МИФИЧЕСКИЕ ЛЕГИОНЫ",
            "ukrainian": "ЗБЕРИ МІФІЧНІ ЛЕГІОНИ",
            "japanese": "神話の軍団を編制せよ",
            "koreana": "신화의 군단을 소집하라",
            "schinese": "组建神话军团",
            "tchinese": "組建神話軍團",
            "arabic": "جمّع الجيوش الأسطورية",
            "thai": "รวบรวมกองทัพในตำนาน",
        },
    },
    {
        "section": "outthink",
        "color": "#6eb0e8",
        "text": {
            "english": "OUTTHINK, DON'T OUTCLICK",
            "german": "ÜBERDENKE, NICHT ÜBERKLICKE",
            "french": "RÉFLÉCHIS, NE CLIQUE PAS PLUS VITE",
            "italian": "RAGIONA, NON CLICCARE PIÙ VELOCE",
            "spanish": "PIENSA MEJOR, NO HAGAS MÁS CLICS",
            "latam": "PIENSA MEJOR, NO HAGAS MÁS CLICS",
            "brazilian": "PENSE MELHOR, NÃO CLIQUE MAIS RÁPIDO",
            "portuguese": "PENSA MELHOR, NÃO CLIQUES MAIS RÁPIDO",
            "dutch": "DENK SLIMMER, KLIK NIET SNELLER",
            "danish": "TÆNK BEDRE, IKKE KLIK HURTIGERE",
            "norwegian": "TENK BEDRE, IKKE KLIKK RASKERE",
            "swedish": "TÄNK BÄTTRE, KLICKA INTE SNABBARE",
            "finnish": "AJATTELE TERÄVÄMMIN, ÄLÄ KLIKKAA NOPEAMMIN",
            "czech": "PŘEDEHRAJ ROZUMEM, NE KLIKÁNÍM",
            "polish": "PRZEŚCIGNIJ MYŚLENIEM, NIE KLIKANIEM",
            "hungarian": "GONDOLKODJ, NE KATTINTS GYORSABBAN",
            "romanian": "GÂNDEȘTE MAI BINE, NU DA MAI MULTE CLICURI",
            "turkish": "DAHA HIZLI TIKLAMA, DAHA İYİ DÜŞÜN",
            "indonesian": "PIKIR LEBIH TAJAM, JANGAN KLIK LEBIH CEPAT",
            "malay": "FIKIR LEBIH TAJAM, JANGAN KLIK LEBIH LAJU",
            "vietnamese": "SUY NGHĨ SÂU, ĐỪNG BẤM NHANH",
            "greek": "ΣΚΕΨΟΥ ΚΑΛΥΤΕΡΑ, ΜΗΝ ΚΑΝΕΙΣ ΠΙΟ ΓΡΗΓΟΡΑ ΚΛΙΚ",
            "bulgarian": "МИСЛИ ПО-ДОБРЕ, НЕ КЛИКАЙ ПО-БЪРЗО",
            "russian": "ДУМАЙ ОСТРЕЕ, А НЕ КЛИКАЙ БЫСТРЕЕ",
            "ukrainian": "ДУМАЙ ГОСТРІШЕ, А НЕ КЛІКАЙ ШВИДШЕ",
            "japanese": "速さではなく、知略で勝つ",
            "koreana": "클릭이 아니라 전략으로 이겨라",
            "schinese": "靠谋略取胜，而非手速",
            "tchinese": "靠謀略取勝，而非手速",
            "arabic": "فَكِّر أذكى، لا تنقر أسرع",
            "thai": "คิดให้คม อย่าคลิกให้ไว",
        },
    },
    {
        "section": "magical_armory",
        "color": "#e87840",
        "text": {
            "english": "MASTER YOUR MAGICAL ARMORY",
            "german": "MEISTERE DEIN MAGISCHES ARSENAL",
            "french": "MAÎTRISE TON ARSENAL MAGIQUE",
            "italian": "PADRONEGGIA IL TUO ARSENALE MAGICO",
            "spanish": "DOMINA TU ARSENAL MÁGICO",
            "latam": "DOMINA TU ARSENAL MÁGICO",
            "brazilian": "DOMINE SEU ARSENAL MÁGICO",
            "portuguese": "DOMINA O TEU ARSENAL MÁGICO",
            "dutch": "BEHEERS JE MAGISCHE ARSENAAL",
            "danish": "MESTRE DIT MAGISKE ARSENAL",
            "norwegian": "MESTRE DITT MAGISKE ARSENAL",
            "swedish": "BEMÄSTRA DITT MAGISKA ARSENAL",
            "finnish": "HALLITSE TAIOKAS ASEISTUKSESI",
            "czech": "OVLÁDNI SVŮJ MAGICKÝ ARZENÁL",
            "polish": "OPANUJ SWÓJ MAGICZNY ARSENAŁ",
            "hungarian": "URALD MÁGIÁS FEGYVERTÁRADAT",
            "romanian": "STĂPÂNEȘTE-ȚI ARSENALUL MAGIC",
            "turkish": "BÜYÜLÜ CEPHANELİĞİNİ USTALAŞTIR",
            "indonesian": "KUASAI GUDANG SENJATA GAIBMU",
            "malay": "KUASAI ARSENAL SIHIR ANDA",
            "vietnamese": "LÀM CHỦ KHO VŨ KHÍ PHÉP THUẬT",
            "greek": "ΚΥΡΙΑΡΧΗΣΕ ΤΟ ΜΑΓΙΚΟ ΣΟΥ ΟΠΛΟΣΤΑΣΙΟ",
            "bulgarian": "ОВЛАДЕЙ МАГИЧЕСКИЯ СИ АРСЕНАЛ",
            "russian": "ОВЛАДЕЙ СВОИМ МАГИЧЕСКИМ АРСЕНАЛОМ",
            "ukrainian": "ОПАНУЙ СВІЙ МАГІЧНИЙ АРСЕНАЛ",
            "japanese": "魔法の武器庫を使いこなせ",
            "koreana": "마법 무기고를 완벽히 다뤄라",
            "schinese": "掌控你的魔法武库",
            "tchinese": "掌控你的魔法武庫",
            "arabic": "أتقن ترسانتك السحرية",
            "thai": "เชี่ยวชาญคลังอาวุธเวทมนตร์ของคุณ",
        },
    },
    {
        "section": "paths_to_glory",
        "color": "#78c848",
        "text": {
            "english": "MULTIPLE PATHS TO GLORY",
            "german": "VIELE WEGE ZUM RUHM",
            "french": "PLUSIEURS CHEMINS VERS LA GLOIRE",
            "italian": "MOLTI SENTIERI VERSO LA GLORIA",
            "spanish": "MÚLTIPLES CAMINOS HACIA LA GLORIA",
            "latam": "MÚLTIPLES CAMINOS HACIA LA GLORIA",
            "brazilian": "MÚLTIPLOS CAMINHOS PARA A GLÓRIA",
            "portuguese": "MÚLTIPLOS CAMINHOS PARA A GLÓRIA",
            "dutch": "MEERDERE PADEN NAAR GLORIE",
            "danish": "FLERE VEJE TIL ÆRE",
            "norwegian": "FLERE VEIER TIL ÆRE",
            "swedish": "FLERA VÄGAR TILL ÄRA",
            "finnish": "MONIA TEITÄ KUNNIAAN",
            "czech": "VÍCE CEST KE SLÁVĚ",
            "polish": "WIELE DRÓG DO CHWAŁY",
            "hungarian": "TÖBB ÚT A DICSŐSÉGHEZ",
            "romanian": "MAI MULTE CĂI SPRE GLORIE",
            "turkish": "ŞANA GİDEN BİRDEN FAZLA YOL",
            "indonesian": "BANYAK JALAN MENUJU KEMULIAAN",
            "malay": "PELBAGAI JALAN KE KEMULIAAN",
            "vietnamese": "NHIỀU CON ĐƯỜNG ĐẾN VINH QUANG",
            "greek": "ΠΟΛΛΟΙ ΔΡΟΜΟΙ ΠΡΟΣ ΤΗ ΔΟΞΑ",
            "bulgarian": "МНОГО ПЪТИЩА КЪМ СЛАВАТА",
            "russian": "МНОГО ПУТЕЙ К СЛАВЕ",
            "ukrainian": "БАГАТО ШЛЯХІВ ДО СЛАВИ",
            "japanese": "栄光へのいくつもの道",
            "koreana": "영광으로 가는 여러 길",
            "schinese": "通往荣耀的多条道路",
            "tchinese": "通往榮耀的多條道路",
            "arabic": "مسارات متعددة إلى المجد",
            "thai": "หลายหนทางสู่เกียรติยศ",
        },
    },
]

# Fix Finnish typo from drafting
SECTIONS[0]["text"]["finnish"] = "KOKOA MYYTTISIÄ LEGIOONIA"


def embed_into_html(titles: list[dict]) -> None:
    if not OUT_HTML.exists():
        raise SystemExit(f"Missing {OUT_HTML} — cannot embed")
    html = OUT_HTML.read_text(encoding="utf-8")
    blob = json.dumps(titles, ensure_ascii=False, indent=2)
    pattern = r"const TITLE_SECTIONS = .*?;\n\n    const TITLE_LANGUAGES"
    repl = f"const TITLE_SECTIONS = {blob};\n\n    const TITLE_LANGUAGES"
    new_html, n = re.subn(pattern, repl, html, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("Could not find TITLE_SECTIONS block in steam_assets.html")
    OUT_HTML.write_text(new_html, encoding="utf-8")
    print(f"embedded titles into {OUT_HTML.relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--embed",
        action="store_true",
        help="Also rewrite TITLE_SECTIONS inside steam_assets.html",
    )
    args = ap.parse_args()
    OUT_JSON.write_text(json.dumps(SECTIONS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({len(SECTIONS)} sections)")
    if args.embed:
        embed_into_html(SECTIONS)


if __name__ == "__main__":
    main()
