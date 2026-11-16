# Kalendář akcí ve Valašské Bystřici

Akce z více zdrojů na jednom místě. Statický web (GitHub Pages), data 3× denně přegeneruje GitHub Action.

```
zdroje → scripts/collect.mjs (Node, GitHub Action) → public/data/events.json + akce.ics → web public/
```

| Zdroj | Adaptér | Jak se čte |
|---|---|---|
| Společenský dům U Pernických | `ical` | veřejný Google kalendář; soukromé akce vyřazuje `exclude` v `config/sources.json` (nikam se neukládají) |
| Farnost | `tribe` | REST API The Events Calendar (farnostvb.cz) |
| Divadlo CHAOS | `ai-html` | bloky úvodní stránky, akce a plakát vybere AI |
| Troják | `ai-wp` | články WordPressu, plakát = náhledový obrázek |
| Zpravodaj obce | `zpravodaj` | PDF z archivu zpravodaje, akce vybere AI (každé vydání jen jednou) |
| Ručně přidané | `wp-manual` | plugin `wp-plugin/kalendar-akci` na kalendar-bystrice.cz (Kalendář akcí → Přidat akci), JSON `/wp-json/kalendar-vb/v1/akce` |
| Fotbal (TJ Sokol) | `static` | ruční rozpis `config/manual/fotbal.json` (fotbal.cz blokuje roboty) |
| Státní svátky | `holidays` | výpočet |

- **AI**: Groq (`GROQ_API_KEY` v Settings → Secrets → Actions). Výsledky se ukládají do `cache/ai.json`,
  stejný text se znovu neposílá. AI musí ke každé akci uvést doslovný úryvek ze zdroje – co ve zdroji není, se zahodí.
- **Duplicity** (`scripts/dedupe.mjs`): stejný den + podobný název = jedna akce; sporné páry posoudí AI.
  Údaje se doplní ze všech zdrojů, název podle priority zdroje (`priority`).
- **Kategorie a štítky**: `config/categories.json` (klíčová slova bez diakritiky) + kategorie od AI.
  Do popisu události v Google kalendáři lze psát `#deti #kultura`.
- **Pořadatelé**: `config/organizers.json` (zdroj, název akce, místo); `noOrganizer` = záměrně bez pořadatele.
- **Opravy názvů**: `titleFixes` v `config/sources.json`; ruční spojení vícedenních akcí `mergeRules`.
- **Historie**: od `historyFrom` v `config/sources.json`.
- **Vložení do jiného webu**: `<iframe src=".../?embed">`, stránka posílá výšku přes `postMessage` (`kalendar-vb-height`).

Místní spuštění: `npm ci && node scripts/collect.mjs`, náhled `cd public && python3 -m http.server`.
